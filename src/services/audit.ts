import type { Db } from "../db/database.js";

export function audit(
  db: Db,
  entity: string,
  entityId: number,
  action: "create" | "update" | "delete",
  changes: unknown,
): void {
  db.prepare(
    "INSERT INTO audit_log (entity, entity_id, action, changes) VALUES (?, ?, ?, ?)",
  ).run(entity, entityId, action, JSON.stringify(changes));
}

/** Fields whose value differs between `before` and `after`, as {field: [old, new]}. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(after)) {
    if (before[k] !== v) out[k] = [before[k] ?? null, v];
  }
  return out;
}
