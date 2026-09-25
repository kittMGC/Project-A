import type { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.js";

/**
 * The subset of the node:sqlite API the services use. Kept free of Node-only
 * imports so the same services can run on another SQLite driver.
 */
export type Db = Pick<DatabaseSync, "exec" | "prepare">;

/** Bring the schema up to date. `PRAGMA user_version` records how many migrations have run. */
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
