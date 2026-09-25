import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { openDatabase, seedIfEmpty, type Db } from "./db/database.js";
import { createApp } from "./server.js";

let db: Db;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  db = openDatabase(":memory:");
  seedIfEmpty(db);
  server = createApp(db);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  db.close();
});

beforeEach(() => {
  db.exec("DELETE FROM employees");
});

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const deptId = (company: string, name: string) =>
  (
    db
      .prepare("SELECT d.id FROM departments d JOIN companies c ON c.id = d.company_id WHERE c.code = ? AND d.name = ?")
      .get(company, name) as { id: number }
  ).id;

const newEmployee = (overrides: Record<string, unknown> = {}) => ({
  emp_code: "T0001",
  department_id: deptId("MGC", "จัดซื้อ"),
  first_name_th: "สมชาย",
  last_name_th: "ใจดี",
  position_title: "Purchasing Officer",
  hire_date: "2024-01-15",
  ...overrides,
});

describe("app shell", () => {
  it("returns health status", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("serves the web app with security headers", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await res.text()).toContain("HRM System");
  });

  it("does not serve files outside public/", async () => {
    const res = await fetch(`${baseUrl}/..%2Fpackage.json`);
    expect(await res.text()).not.toContain('"devDependencies"');
  });

  it("returns 404 JSON for unknown API routes", async () => {
    expect((await api("GET", "/api/nope")).status).toBe(404);
    expect((await api("GET", "/api/companies/abc")).status).toBe(404);
  });
});

describe("org structure", () => {
  it("loads the seeded structure as a tree", async () => {
    const { status, body } = await api("GET", "/api/org/tree");
    expect(status).toBe(200);
    expect(body).toHaveLength(7);
    const companies = body.flatMap((g: { companies: unknown[] }) => g.companies);
    expect(companies).toHaveLength(21);
    const depts = companies.flatMap((c: { departments: unknown[] }) => c.departments);
    expect(depts).toHaveLength(419);
  });

  it("creates, renames and deletes a business group", async () => {
    const created = await api("POST", "/api/business-groups", { code: "NEW", name: "New Group", sort_order: 99 });
    expect(created.status).toBe(201);
    const updated = await api("PATCH", `/api/business-groups/${created.body.id}`, { name: "Renamed" });
    expect(updated.body.name).toBe("Renamed");
    expect((await api("DELETE", `/api/business-groups/${created.body.id}`)).status).toBe(204);
    const log = db.prepare("SELECT action FROM audit_log WHERE entity = 'business_groups' AND entity_id = ?").all(created.body.id);
    expect(log.map((r) => (r as { action: string }).action)).toEqual(["create", "update", "delete"]);
  });

  it("moves a company to another business group", async () => {
    const groups = (await api("GET", "/api/business-groups")).body;
    const company = (await api("GET", "/api/companies")).body.find((c: { code: string }) => c.code === "V2D");
    const target = groups.find((g: { code: string }) => g.code === "CORP");
    const res = await api("PATCH", `/api/companies/${company.id}`, { business_group_id: target.id });
    expect(res.body.business_group_id).toBe(target.id);
  });

  it("rejects duplicate codes and bad references", async () => {
    const dup = await api("POST", "/api/companies", { code: "MGC", name: "x", business_group_id: 1 });
    expect(dup.status).toBe(409);
    const badRef = await api("POST", "/api/companies", { code: "ZZZ", name: "x", business_group_id: 9999 });
    expect(badRef.status).toBe(400);
    expect(badRef.body.details.business_group_id).toBeDefined();
  });

  it("reports every missing required field", async () => {
    const res = await api("POST", "/api/departments", {});
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details).sort()).toEqual(["company_id", "function_id", "name"]);
  });

  it("refuses to delete a group that still has companies", async () => {
    const corp = (await api("GET", "/api/business-groups")).body.find((g: { code: string }) => g.code === "CORP");
    const res = await api("DELETE", `/api/business-groups/${corp.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("ปิดใช้งาน");
  });

  it("requires a JSON content type for writes", async () => {
    const res = await fetch(`${baseUrl}/api/business-groups`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=X&name=Y",
    });
    expect(res.status).toBe(415);
  });
});

describe("employees", () => {
  it("creates an employee and returns org details", async () => {
    const res = await api("POST", "/api/employees", newEmployee({ email: "Somchai@Example.com" }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      emp_code: "T0001",
      status: "active",
      company_code: "MGC",
      function_code: "F15",
      email: "somchai@example.com",
    });
  });

  it("rejects a duplicate employee code", async () => {
    await api("POST", "/api/employees", newEmployee());
    expect((await api("POST", "/api/employees", newEmployee())).status).toBe(409);
  });

  it("validates dates and cross-field rules", async () => {
    const res = await api(
      "POST",
      "/api/employees",
      newEmployee({ birth_date: "2030-01-01", probation_end_date: "2023-01-01", hire_date: "2024-02-30" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.details.hire_date).toBeDefined();

    const res2 = await api("POST", "/api/employees", newEmployee({ status: "resigned" }));
    expect(res2.body.details.resign_date).toBe("ต้องระบุวันพ้นสภาพ");
  });

  it("blocks circular reporting lines", async () => {
    const a = (await api("POST", "/api/employees", newEmployee({ emp_code: "A" }))).body;
    const b = (await api("POST", "/api/employees", newEmployee({ emp_code: "B", manager_id: a.id }))).body;
    expect(b.manager_name).toBe("สมชาย ใจดี");
    const res = await api("PATCH", `/api/employees/${a.id}`, { manager_id: b.id });
    expect(res.status).toBe(400);
    expect(res.body.details.manager_id).toContain("วนกลับ");
    expect((await api("PATCH", `/api/employees/${a.id}`, { manager_id: a.id })).status).toBe(400);
  });

  it("searches, filters and pages the list", async () => {
    for (let i = 1; i <= 30; i++) {
      await api("POST", "/api/employees", newEmployee({ emp_code: `E${String(i).padStart(3, "0")}`, first_name_th: i === 7 ? "วิไล" : "สมชาย" }));
    }
    const page2 = (await api("GET", "/api/employees?page=2&page_size=25")).body;
    expect(page2.total).toBe(30);
    expect(page2.items).toHaveLength(5);
    const found = (await api("GET", `/api/employees?q=${encodeURIComponent("วิไล")}`)).body;
    expect(found.items.map((e: { emp_code: string }) => e.emp_code)).toEqual(["E007"]);
    // LIKE wildcards in the search box are treated literally.
    expect((await api("GET", "/api/employees?q=%25")).body.total).toBe(0);
  });

  it("marks an employee resigned and clears the date when reactivated", async () => {
    const e = (await api("POST", "/api/employees", newEmployee())).body;
    const resigned = await api("PATCH", `/api/employees/${e.id}`, { status: "resigned", resign_date: "2026-08-31" });
    expect(resigned.body.status).toBe("resigned");
    const back = await api("PATCH", `/api/employees/${e.id}`, { status: "active" });
    expect(back.body.resign_date).toBeNull();
  });

  it("counts active employees in the org tree and blocks deleting their department", async () => {
    await api("POST", "/api/employees", newEmployee());
    const tree = (await api("GET", "/api/org/tree")).body;
    const mgc = tree.flatMap((g: { companies: { code: string; headcount: number }[] }) => g.companies).find((c: { code: string }) => c.code === "MGC");
    expect(mgc.headcount).toBe(1);
    expect((await api("DELETE", `/api/departments/${deptId("MGC", "จัดซื้อ")}`)).status).toBe(409);
  });
});
