import { transaction, type Db } from "../db/database.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { validate, type Clean, type Schema } from "../validation.js";
import { audit, diff } from "./audit.js";

const text = (max: number) => ({ type: "string", max }) as const;

export const employeeSchema: Schema = {
  emp_code: { type: "string", required: true, max: 30, pattern: /^[A-Za-z0-9._-]+$/, patternMessage: "ใช้ได้เฉพาะ A-Z, 0-9, . _ -" },
  department_id: { type: "int", required: true },
  job_level_id: { type: "int" },
  manager_id: { type: "int" },
  title_th: text(30),
  first_name_th: { type: "string", required: true, max: 100 },
  last_name_th: { type: "string", required: true, max: 100 },
  title_en: text(30),
  first_name_en: text(100),
  last_name_en: text(100),
  position_title: { type: "string", required: true, max: 150 },
  job_family: { type: "enum", values: ["Front", "Technical", "Support", "Management"] },
  branch: text(100),
  email: { type: "email" },
  gender: { type: "enum", values: ["male", "female", "other"] },
  birth_date: { type: "date" },
  hire_date: { type: "date", required: true },
  probation_end_date: { type: "date" },
  status: { type: "enum", values: ["active", "resigned"] },
  resign_date: { type: "date" },
};

const SELECT = `
  SELECT e.*,
         d.name AS department_name, d.company_id,
         c.code AS company_code, c.name AS company_name,
         g.id AS business_group_id, g.name AS business_group_name,
         f.code AS function_code, f.name AS function_name,
         l.name AS job_level_name, l.band AS job_level_band,
         m.emp_code AS manager_emp_code,
         m.first_name_th || ' ' || m.last_name_th AS manager_name
  FROM employees e
  JOIN departments d ON d.id = e.department_id
  JOIN companies c ON c.id = d.company_id
  JOIN business_groups g ON g.id = c.business_group_id
  JOIN functions f ON f.id = d.function_id
  LEFT JOIN job_levels l ON l.id = e.job_level_id
  LEFT JOIN employees m ON m.id = e.manager_id`;

type Row = Record<string, unknown>;

export interface EmployeeQuery {
  q?: string;
  company_id?: number;
  department_id?: number;
  business_group_id?: number;
  status?: string;
  page?: number;
  page_size?: number;
}

export function listEmployees(db: Db, query: EmployeeQuery) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push(
      `(e.emp_code LIKE ? ESCAPE '\\' OR e.first_name_th || ' ' || e.last_name_th LIKE ? ESCAPE '\\'
        OR coalesce(e.first_name_en, '') || ' ' || coalesce(e.last_name_en, '') LIKE ? ESCAPE '\\'
        OR e.position_title LIKE ? ESCAPE '\\')`,
    );
    params.push(like, like, like, like);
  }
  const filters: [string, string | number | undefined][] = [
    ["d.company_id = ?", query.company_id],
    ["e.department_id = ?", query.department_id],
    ["c.business_group_id = ?", query.business_group_id],
    ["e.status = ?", query.status === "active" || query.status === "resigned" ? query.status : undefined],
  ];
  for (const [clause, value] of filters) {
    if (value === undefined) continue;
    where.push(clause);
    params.push(value);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const pageSize = Math.min(Math.max(query.page_size ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const { total } = db
    .prepare(
      `SELECT COUNT(*) AS total FROM employees e
       JOIN departments d ON d.id = e.department_id
       JOIN companies c ON c.id = d.company_id ${whereSql}`,
    )
    .get(...params) as { total: number };
  const items = db
    .prepare(`${SELECT} ${whereSql} ORDER BY e.emp_code LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Row[];
  return { items, total, page, page_size: pageSize };
}

export function getEmployee(db: Db, id: number): Row {
  const row = db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as Row | undefined;
  if (!row) throw notFound("พนักงาน");
  return row;
}

/** Rules that span several fields or need the database. */
function checkRules(db: Db, data: Clean, id: number | null, departmentChanged = true): void {
  const errors: Record<string, string> = {};
  const hire = data.hire_date as string | null;

  if (data.department_id != null) {
    const dept = db.prepare("SELECT is_active FROM departments WHERE id = ?").get(data.department_id) as
      | { is_active: number }
      | undefined;
    if (!dept) errors.department_id = "ไม่พบแผนกที่เลือก";
    else if (!dept.is_active && departmentChanged) errors.department_id = "แผนกนี้ถูกปิดใช้งานแล้ว";
  }
  if (data.job_level_id != null && !db.prepare("SELECT 1 FROM job_levels WHERE id = ?").get(data.job_level_id)) {
    errors.job_level_id = "ไม่พบระดับที่เลือก";
  }
  if (data.manager_id != null) {
    if (data.manager_id === id) errors.manager_id = "เลือกตัวเองเป็นหัวหน้าไม่ได้";
    else if (!db.prepare("SELECT 1 FROM employees WHERE id = ?").get(data.manager_id)) {
      errors.manager_id = "ไม่พบหัวหน้าที่เลือก";
    } else if (id !== null && reportsTo(db, data.manager_id as number, id)) {
      errors.manager_id = "หัวหน้าคนนี้อยู่ใต้บังคับบัญชาของพนักงานคนนี้ (สายงานวนกลับ)";
    }
  }
  if (hire) {
    if (data.birth_date && (data.birth_date as string) >= hire) errors.birth_date = "วันเกิดต้องก่อนวันเริ่มงาน";
    if (data.probation_end_date && (data.probation_end_date as string) < hire) {
      errors.probation_end_date = "วันพ้นทดลองงานต้องไม่ก่อนวันเริ่มงาน";
    }
    if (data.resign_date && (data.resign_date as string) < hire) errors.resign_date = "วันพ้นสภาพต้องไม่ก่อนวันเริ่มงาน";
  }
  if (data.status === "resigned" && !data.resign_date) errors.resign_date = "ต้องระบุวันพ้นสภาพ";

  if (Object.keys(errors).length) throw badRequest("กรุณาตรวจสอบข้อมูลที่กรอก", errors);
}

/** True if `employeeId`'s chain of managers reaches `ancestorId`. */
function reportsTo(db: Db, employeeId: number, ancestorId: number): boolean {
  const stmt = db.prepare("SELECT manager_id FROM employees WHERE id = ?");
  const seen = new Set<number>();
  let current: number | null = employeeId;
  while (current !== null && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = ((stmt.get(current) as { manager_id: number | null } | undefined)?.manager_id) ?? null;
  }
  return false;
}

function normalise(data: Clean): Clean {
  // An active employee has no resignation date.
  if (data.status === "active") data.resign_date = null;
  return data;
}

function isDuplicateCode(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: employees\.emp_code/.test(err.message);
}

export function createEmployee(db: Db, input: unknown): Row {
  const data = normalise({ status: "active", ...validate(input, employeeSchema) });
  checkRules(db, data, null);
  const cols = Object.keys(data);
  try {
    return transaction(db, () => {
      const { lastInsertRowid } = db
        .prepare(`INSERT INTO employees (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .run(...cols.map((c) => data[c]));
      const id = Number(lastInsertRowid);
      audit(db, "employees", id, "create", data);
      return getEmployee(db, id);
    });
  } catch (err) {
    if (isDuplicateCode(err)) throw conflict("รหัสพนักงานนี้มีอยู่แล้ว");
    throw err;
  }
}

export function updateEmployee(db: Db, id: number, input: unknown): Row {
  const before = db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as Row | undefined;
  if (!before) throw notFound("พนักงาน");
  const changes = validate(input, employeeSchema, true);
  // Check the rules against the record as it will be after the update.
  const merged = normalise({ ...(before as Clean), ...changes });
  checkRules(db, merged, id, "department_id" in changes && changes.department_id !== before.department_id);
  if (changes.status === "active") changes.resign_date = null;
  const cols = Object.keys(changes);
  if (cols.length === 0) return getEmployee(db, id);
  try {
    return transaction(db, () => {
      db.prepare(
        `UPDATE employees SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
      ).run(...cols.map((c) => changes[c]), id);
      audit(db, "employees", id, "update", diff(before, changes));
      return getEmployee(db, id);
    });
  } catch (err) {
    if (isDuplicateCode(err)) throw conflict("รหัสพนักงานนี้มีอยู่แล้ว");
    throw err;
  }
}

/** For correcting data-entry mistakes; people who leave should be set to "resigned". */
export function deleteEmployee(db: Db, id: number): void {
  const before = db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as Row | undefined;
  if (!before) throw notFound("พนักงาน");
  transaction(db, () => {
    db.prepare("DELETE FROM employees WHERE id = ?").run(id);
    audit(db, "employees", id, "delete", before);
  });
}
