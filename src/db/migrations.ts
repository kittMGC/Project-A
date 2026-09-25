/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many
 * have run, so each entry must never be edited once released — add a new one.
 */
export const migrations: string[] = [
  `
  CREATE TABLE business_groups (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE companies (
    id                 INTEGER PRIMARY KEY,
    code               TEXT    NOT NULL UNIQUE,
    name               TEXT    NOT NULL,
    business_group_id  INTEGER NOT NULL REFERENCES business_groups(id) ON DELETE RESTRICT,
    is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_companies_group ON companies(business_group_id);

  -- Standard job functions (F01 Executive Office, F03 Sales - New Vehicle, ...)
  CREATE TABLE functions (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE job_levels (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    band        TEXT    NOT NULL,
    rank        INTEGER NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE departments (
    id           INTEGER PRIMARY KEY,
    company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    function_id  INTEGER NOT NULL REFERENCES functions(id) ON DELETE RESTRICT,
    name         TEXT    NOT NULL,
    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (company_id, name)
  );
  CREATE INDEX idx_departments_function ON departments(function_id);

  CREATE TABLE employees (
    id                  INTEGER PRIMARY KEY,
    emp_code            TEXT    NOT NULL UNIQUE,
    -- The department determines the company, so moving a department moves its people.
    department_id       INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    job_level_id        INTEGER REFERENCES job_levels(id) ON DELETE RESTRICT,
    manager_id          INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    title_th            TEXT,
    first_name_th       TEXT    NOT NULL,
    last_name_th        TEXT    NOT NULL,
    title_en            TEXT,
    first_name_en       TEXT,
    last_name_en        TEXT,
    position_title      TEXT    NOT NULL,
    job_family          TEXT    CHECK (job_family IN ('Front', 'Technical', 'Support', 'Management')),
    branch              TEXT,
    email               TEXT,
    gender              TEXT    CHECK (gender IN ('male', 'female', 'other')),
    birth_date          TEXT,
    hire_date           TEXT    NOT NULL,
    probation_end_date  TEXT,
    status              TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resigned')),
    resign_date         TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (status = 'active' OR resign_date IS NOT NULL)
  );
  CREATE INDEX idx_employees_department_status ON employees(department_id, status);
  CREATE INDEX idx_employees_manager ON employees(manager_id);

  -- Who changed what, for HR traceability.
  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    entity     TEXT    NOT NULL,
    entity_id  INTEGER NOT NULL,
    action     TEXT    NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    changes    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
  `,
];
