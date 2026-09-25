import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.js";

export type Db = DatabaseSync;

/**
 * Open (or create) the SQLite database, enable foreign keys and bring the
 * schema up to date. Pass ":memory:" for an throwaway database in tests.
 */
export function openDatabase(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let v = current; v < migrations.length; v++) {
    transaction(db, () => {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Run `fn` atomically; roll back if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

interface SeedFile {
  businessGroups: { code: string; name: string; sortOrder: number }[];
  companies: { code: string; name: string; groupCode: string }[];
  functions: { code: string; name: string }[];
  jobLevels: { code: string; name: string; band: string; rank: number }[];
  departments: { companyCode: string; name: string; functionCode: string }[];
}

export const DEFAULT_SEED_FILE = new URL("../../db/seed/org-structure.json", import.meta.url);

/**
 * Load the starting org structure. Does nothing if any business group exists,
 * so it is safe to call on every start without overwriting user edits.
 */
export function seedIfEmpty(db: Db, seedFile: URL | string = DEFAULT_SEED_FILE): boolean {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM business_groups").get() as { n: number };
  if (n > 0) return false;
  const seed = JSON.parse(readFileSync(seedFile, "utf8")) as SeedFile;

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
  return true;
}
