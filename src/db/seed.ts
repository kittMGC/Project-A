import { transaction, type Db } from "./core.js";

export interface SeedFile {
  businessGroups: { code: string; name: string; sortOrder: number }[];
  companies: { code: string; name: string; groupCode: string }[];
  functions: { code: string; name: string }[];
  jobLevels: { code: string; name: string; band: string; rank: number }[];
  departments: { companyCode: string; name: string; functionCode: string }[];
}

/** True if the org structure has not been loaded yet. */
export function isEmpty(db: Db): boolean {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM business_groups").get() as { n: number };
  return n === 0;
}

/** Insert the starting org structure in one transaction. */
export function loadSeed(db: Db, seed: SeedFile): void {
  transaction(db, () => {
    const groupId = new Map<string, number>();
    const insGroup = db.prepare(
      "INSERT INTO business_groups (code, name, sort_order) VALUES (?, ?, ?)",
    );
    for (const g of seed.businessGroups) {
      groupId.set(g.code, Number(insGroup.run(g.code, g.name, g.sortOrder).lastInsertRowid));
    }
    const companyId = new Map<string, number>();
    const insCompany = db.prepare(
      "INSERT INTO companies (code, name, business_group_id) VALUES (?, ?, ?)",
    );
    for (const c of seed.companies) {
      const id = insCompany.run(c.code, c.name, groupId.get(c.groupCode)!).lastInsertRowid;
      companyId.set(c.code, Number(id));
    }
    const functionId = new Map<string, number>();
    const insFunction = db.prepare("INSERT INTO functions (code, name) VALUES (?, ?)");
    for (const f of seed.functions) {
      functionId.set(f.code, Number(insFunction.run(f.code, f.name).lastInsertRowid));
    }
    const insLevel = db.prepare(
      "INSERT INTO job_levels (code, name, band, rank) VALUES (?, ?, ?, ?)",
    );
    for (const l of seed.jobLevels) insLevel.run(l.code, l.name, l.band, l.rank);
    const insDept = db.prepare(
      "INSERT INTO departments (company_id, function_id, name) VALUES (?, ?, ?)",
    );
    for (const d of seed.departments) {
      insDept.run(companyId.get(d.companyCode)!, functionId.get(d.functionCode)!, d.name);
    }
  });
}
