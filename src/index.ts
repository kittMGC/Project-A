import { openDatabase, seedIfEmpty } from "./db/database.js";
import { createApp } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
// Employee data is personal data: listen on this machine only unless told otherwise.
const HOST = process.env.HOST ?? "127.0.0.1";
const DB_FILE = process.env.DB_FILE ?? "data/hrm.sqlite";

const db = openDatabase(DB_FILE);
if (seedIfEmpty(db)) console.log("Loaded starting org structure from db/seed/org-structure.json");

const server = createApp(db);

server.listen(PORT, HOST, () => {
  console.log(`HRM System running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
