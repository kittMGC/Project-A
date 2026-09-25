import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "../db/database.js";
import { HttpError, notFound } from "../errors.js";
import { readJson, sendJson, toId } from "../http.js";
import {
  createEmployee,
  deleteEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from "../services/employee.service.js";
import {
  createEntity,
  deleteEntity,
  getEntity,
  isEntityName,
  listEntity,
  orgTree,
  updateEntity,
} from "../services/org.service.js";

const methodNotAllowed = () => new HttpError(405, "ไม่รองรับคำสั่งนี้");

/**
 * Routes:
 *   GET    /api/org/tree
 *   GET    /api/{entity}                 entity = business-groups | companies | functions | job-levels | departments
 *   POST   /api/{entity}
 *   GET    /api/{entity}/:id
 *   PATCH  /api/{entity}/:id
 *   DELETE /api/{entity}/:id
 *   GET    /api/employees?q=&company_id=&department_id=&business_group_id=&status=&page=&page_size=
 *   POST   /api/employees
 *   GET    /api/employees/:id
 *   PATCH  /api/employees/:id
 *   DELETE /api/employees/:id
 */
export async function handleApi(db: Db, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const [, , resource, rawId, ...rest] = url.pathname.split("/");
  const method = req.method ?? "GET";
  if (rest.length > 0) throw notFound("หน้าที่ต้องการ");

  if (resource === "org" && rawId === "tree") {
    if (method !== "GET") throw methodNotAllowed();
    return sendJson(res, 200, orgTree(db));
  }

  let id: number | undefined;
  if (rawId !== undefined) {
    id = toId(rawId);
    if (id === undefined) throw notFound("รายการ");
  }

  if (resource === "employees") {
    if (id === undefined) {
      if (method === "GET") {
        const p = url.searchParams;
        return sendJson(
          res,
          200,
          listEmployees(db, {
            q: p.get("q")?.trim() || undefined,
            company_id: toId(p.get("company_id")),
            department_id: toId(p.get("department_id")),
            business_group_id: toId(p.get("business_group_id")),
            status: p.get("status") ?? undefined,
            page: toId(p.get("page")),
            page_size: toId(p.get("page_size")),
          }),
        );
      }
      if (method === "POST") return sendJson(res, 201, createEmployee(db, await readJson(req)));
      throw methodNotAllowed();
    }
    if (method === "GET") return sendJson(res, 200, getEmployee(db, id));
    if (method === "PATCH") return sendJson(res, 200, updateEmployee(db, id, await readJson(req)));
    if (method === "DELETE") return (deleteEmployee(db, id), sendJson(res, 204, null));
    throw methodNotAllowed();
  }

  if (resource && isEntityName(resource)) {
    if (id === undefined) {
      if (method === "GET") {
        return sendJson(res, 200, listEntity(db, resource, { company_id: toId(url.searchParams.get("company_id")) }));
      }
      if (method === "POST") return sendJson(res, 201, createEntity(db, resource, await readJson(req)));
      throw methodNotAllowed();
    }
    if (method === "GET") return sendJson(res, 200, getEntity(db, resource, id));
    if (method === "PATCH") return sendJson(res, 200, updateEntity(db, resource, id, await readJson(req)));
    if (method === "DELETE") return (deleteEntity(db, resource, id), sendJson(res, 204, null));
    throw methodNotAllowed();
  }

  throw notFound("หน้าที่ต้องการ");
}
