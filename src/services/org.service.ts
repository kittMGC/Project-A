import { transaction, type Db } from "../db/database.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { validate, type Clean, type Schema } from "../validation.js";
import { audit, diff } from "./audit.js";

const CODE = { type: "string", required: true, max: 30, pattern: /^[A-Za-z0-9._-]+$/, patternMessage: "ใช้ได้เฉพาะ A-Z, 0-9, . _ -" } as const;
const NAME = { type: "string", required: true, max: 200 } as const;
const ACTIVE = { type: "bool" } as const;

interface EntityDef {
  table: string;
  label: string;
  schema: Schema;
  orderBy: string;
  /** Columns that reference another table: checked before writing. */
  refs: { column: string; table: string; label: string }[];
  /** Rows elsewhere that block deletion. */
  dependents: { table: string; column: string; label: string }[];
}

export const ENTITIES = {
  "business-groups": {
    table: "business_groups",
    label: "กลุ่มธุรกิจ",
    schema: { code: CODE, name: NAME, sort_order: { type: "int", min: 0 }, is_active: ACTIVE },
    orderBy: "sort_order, code",
    refs: [],
    dependents: [{ table: "companies", column: "business_group_id", label: "บริษัท" }],
  },
  companies: {
    table: "companies",
    label: "บริษัท",
    schema: { code: CODE, name: NAME, business_group_id: { type: "int", required: true }, is_active: ACTIVE },
    orderBy: "code",
    refs: [{ column: "business_group_id", table: "business_groups", label: "กลุ่มธุรกิจ" }],
    dependents: [{ table: "departments", column: "company_id", label: "แผนก" }],
  },
  functions: {
    table: "functions",
    label: "กลุ่มงาน",
    schema: { code: CODE, name: NAME, is_active: ACTIVE },
    orderBy: "code",
    refs: [],
    dependents: [{ table: "departments", column: "function_id", label: "แผนก" }],
  },
  "job-levels": {
    table: "job_levels",
    label: "ระดับพนักงาน",
    schema: {
      code: CODE,
      name: NAME,
      band: { type: "string", required: true, max: 60 },
      rank: { type: "int", required: true, min: 0 },
      is_active: ACTIVE,
    },
    orderBy: "rank, code",
    refs: [],
    dependents: [{ table: "employees", column: "job_level_id", label: "พนักงาน" }],
  },
  departments: {
    table: "departments",
    label: "แผนก",
    schema: {
      name: NAME,
      company_id: { type: "int", required: true },
      function_id: { type: "int", required: true },
      is_active: ACTIVE,
    },
    orderBy: "company_id, name",
    refs: [
      { column: "company_id", table: "companies", label: "บริษัท" },
      { column: "function_id", table: "functions", label: "กลุ่มงาน" },
    ],
    dependents: [{ table: "employees", column: "department_id", label: "พนักงาน" }],
  },
} satisfies Record<string, EntityDef>;

export type EntityName = keyof typeof ENTITIES;
export const isEntityName = (s: string): s is EntityName => Object.hasOwn(ENTITIES, s);

type Row = Record<string, unknown>;

export function listEntity(db: Db, name: EntityName, filters: { company_id?: number } = {}): Row[] {
  const def: EntityDef = ENTITIES[name];
  if (name === "departments" && filters.company_id) {
    return db
      .prepare(`SELECT * FROM departments WHERE company_id = ? ORDER BY name`)
      .all(filters.company_id) as Row[];
  }
  return db.prepare(`SELECT * FROM ${def.table} ORDER BY ${def.orderBy}`).all() as Row[];
}

export function getEntity(db: Db, name: EntityName, id: number): Row {
  const def: EntityDef = ENTITIES[name];
  const row = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(id) as Row | undefined;
  if (!row) throw notFound(def.label);
  return row;
}

function checkRefs(db: Db, def: EntityDef, data: Clean): void {
  const errors: Record<string, string> = {};
  for (const ref of def.refs) {
    const id = data[ref.column];
    if (id == null) continue;
    if (!db.prepare(`SELECT 1 FROM ${ref.table} WHERE id = ?`).get(id)) {
      errors[ref.column] = `ไม่พบ${ref.label}ที่เลือก`;
    }
  }
  if (Object.keys(errors).length) throw badRequest("กรุณาตรวจสอบข้อมูลที่กรอก", errors);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}

function duplicateMessage(def: EntityDef): string {
  return def.table === "departments" ? "บริษัทนี้มีแผนกชื่อนี้อยู่แล้ว" : `รหัส${def.label}นี้มีอยู่แล้ว`;
}

export function createEntity(db: Db, name: EntityName, input: unknown): Row {
  const def: EntityDef = ENTITIES[name];
  const data = validate(input, def.schema);
  checkRefs(db, def, data);
  const cols = Object.keys(data);
  try {
    return transaction(db, () => {
      const { lastInsertRowid } = db
        .prepare(`INSERT INTO ${def.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .run(...cols.map((c) => data[c]));
      const id = Number(lastInsertRowid);
      audit(db, def.table, id, "create", data);
      return getEntity(db, name, id);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(duplicateMessage(def));
    throw err;
  }
}

export function updateEntity(db: Db, name: EntityName, id: number, input: unknown): Row {
  const def: EntityDef = ENTITIES[name];
  const before = getEntity(db, name, id);
  const data = validate(input, def.schema, true);
  checkRefs(db, def, data);
  const cols = Object.keys(data);
  if (cols.length === 0) return before;
  try {
    return transaction(db, () => {
      db.prepare(
        `UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
      ).run(...cols.map((c) => data[c]), id);
      audit(db, def.table, id, "update", diff(before, data));
      return getEntity(db, name, id);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(duplicateMessage(def));
    throw err;
  }
}

/** Delete only unused rows; anything in use should be deactivated instead. */
export function deleteEntity(db: Db, name: EntityName, id: number): void {
  const def: EntityDef = ENTITIES[name];
  const before = getEntity(db, name, id);
  for (const dep of def.dependents) {
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM ${dep.table} WHERE ${dep.column} = ?`)
      .get(id) as { n: number };
    if (n > 0) {
      throw conflict(`ลบไม่ได้ เพราะยังมี${dep.label}อยู่ ${n} รายการ — ให้ย้ายออกก่อน หรือใช้ "ปิดใช้งาน" แทน`);
    }
  }
  transaction(db, () => {
    db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(id);
    audit(db, def.table, id, "delete", before);
  });
}

export interface OrgTreeGroup {
  id: number;
  code: string;
  name: string;
  is_active: number;
  headcount: number;
  companies: {
    id: number;
    code: string;
    name: string;
    is_active: number;
    headcount: number;
    departments: {
      id: number;
      name: string;
      is_active: number;
      function_id: number;
      function_code: string;
      function_name: string;
      headcount: number;
    }[];
  }[];
}

/** Business group › company › department, with active headcount at each level. */
export function orgTree(db: Db): OrgTreeGroup[] {
  const groups = db
    .prepare("SELECT id, code, name, is_active FROM business_groups ORDER BY sort_order, code")
    .all() as Omit<OrgTreeGroup, "companies" | "headcount">[];
  const companies = db
    .prepare("SELECT id, code, name, is_active, business_group_id FROM companies ORDER BY code")
    .all() as (Omit<OrgTreeGroup["companies"][number], "departments" | "headcount"> & {
    business_group_id: number;
  })[];
  const depts = db
    .prepare(
      `SELECT d.id, d.name, d.is_active, d.company_id, d.function_id,
              f.code AS function_code, f.name AS function_name,
              (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status = 'active') AS headcount
       FROM departments d JOIN functions f ON f.id = d.function_id
       ORDER BY f.code, d.name`,
    )
    .all() as (OrgTreeGroup["companies"][number]["departments"][number] & { company_id: number })[];

  return groups.map((g) => {
    const cs = companies
      .filter((c) => c.business_group_id === g.id)
      .map(({ business_group_id, ...c }) => {
        const ds = depts.filter((d) => d.company_id === c.id).map(({ company_id, ...d }) => d);
        return { ...c, headcount: ds.reduce((s, d) => s + d.headcount, 0), departments: ds };
      });
    return { ...g, headcount: cs.reduce((s, c) => s + c.headcount, 0), companies: cs };
  });
}
