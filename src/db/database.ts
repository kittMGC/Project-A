import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./core.js";
import { isEmpty, loadSeed, type SeedFile } from "./seed.js";

export { transaction, type Db } from "./core.js";

/**
 * Open (or create) the SQLite database, enable foreign keys and bring the
 * schema up to date. Pass ":memory:" for an throwaway database in tests.
 */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

export const DEFAULT_SEED_FILE = new URL("../../db/seed/org-structure.json", import.meta.url);

/**
 * Load the starting org structure. Does nothing if any business group exists,
 * so it is safe to call on every start without overwriting user edits.
 */
export function seedIfEmpty(db: DatabaseSync, seedFile: URL | string = DEFAULT_SEED_FILE): boolean {
  if (!isEmpty(db)) return false;
  loadSeed(db, JSON.parse(readFileSync(seedFile, "utf8")) as SeedFile);
  return true;
}
