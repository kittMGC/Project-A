// HRM System web app: org structure editor, employee records, master data.
// Plain ES module, no build step. All user data is inserted with textContent
// (via h()), never innerHTML, so names and notes cannot inject markup.

const main = document.getElementById("main");
const REQUEST_TIMEOUT_MS = 15000;

// ---------- helpers ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function api(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(path, {
      method,
      signal: ctrl.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(0, err.name === "AbortError" ? "เซิร์ฟเวอร์ตอบสนองช้าเกินไป ลองใหม่อีกครั้ง" : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || "เกิดข้อผิดพลาด", data.details);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 3500);
}

/** Disable `button` while `fn` runs so a double click cannot submit twice. */
async function busy(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    await fn();
  } finally {
    button.disabled = false;
  }
}

/** In-page confirmation (native confirm() is blocked in some embedded views). */
function confirmDialog(message, confirmLabel, note) {
  return new Promise((resolve) => {
    const yes = h("button", { type: "button", class: "danger", text: confirmLabel });
    const no = h("button", { type: "button", text: "ยกเลิก" });
    const dlg = h("dialog", { class: "confirm", "aria-labelledby": "confirm-title" },
      h("h2", { id: "confirm-title", text: message }),
      note ? h("p", { class: "sub", text: note }) : null,
      h("div", { class: "actions" }, no, yes));
    const close = (result) => {
      dlg.close();
      dlg.remove();
      resolve(result);
    };
    yes.addEventListener("click", () => close(true));
    no.addEventListener("click", () => close(false));
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(false);
    });
    document.body.append(dlg);
    dlg.showModal();
    no.focus();
  });
}

function stateMessage(text, isError = false) {
  return h("p", { class: `state${isError ? " error" : ""}`, text });
}

function parseHash() {
  const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
  return { parts: path.split("/").filter(Boolean), params: new URLSearchParams(query) };
}

const opt = (value, label) => ({ value: String(value), label });

// ---------- generic form ----------

/**
 * fields: [{ name, label, type: text|email|date|number|select|checkbox, required, options, hint }]
 * Returns { el, read(), setErrors(details), input(name) }.
 */
function buildForm(fields, values = {}) {
  const inputs = {};
  const wrappers = {};
  const els = fields.map((f) => {
    const id = `f-${f.name}`;
    let input;
    if (f.type === "select") {
      input = h("select", { id, name: f.name }, f.required ? null : h("option", { value: "", text: "— ไม่ระบุ —" }),
        (f.options || []).map((o) => h("option", { value: o.value, text: o.label })));
      input.value = values[f.name] == null ? "" : String(values[f.name]);
    } else if (f.type === "checkbox") {
      input = h("input", { id, name: f.name, type: "checkbox", checked: values[f.name] === undefined ? true : !!values[f.name] });
    } else {
      input = h("input", { id, name: f.name, type: f.type || "text", value: values[f.name] ?? "", autocomplete: "off" });
    }
    if (f.required) input.setAttribute("aria-required", "true");
    inputs[f.name] = input;
    const wrap = f.type === "checkbox"
      ? h("div", { class: "field check" }, input, h("label", { for: id, text: f.label }))
      : h("div", { class: "field" }, h("label", { for: id }, f.label, f.required ? h("span", { class: "req", text: " *" }) : null), input,
          f.hint ? h("div", { class: "sub", text: f.hint }) : null);
    wrappers[f.name] = wrap;
    return wrap;
  });
  return {
    el: els,
    input: (name) => inputs[name],
    wrapper: (name) => wrappers[name],
    read() {
      const out = {};
      for (const f of fields) {
        const i = inputs[f.name];
        if (f.type === "checkbox") out[f.name] = i.checked;
        else if (f.type === "number" || (f.type === "select" && f.numeric)) out[f.name] = i.value === "" ? null : Number(i.value);
        else out[f.name] = i.value;
      }
      return out;
    },
    setErrors(details = {}) {
      for (const [name, wrap] of Object.entries(wrappers)) {
        wrap.classList.toggle("invalid", !!details[name]);
        wrap.querySelector(".err")?.remove();
        inputs[name].removeAttribute("aria-invalid");
        if (details[name]) {
          inputs[name].setAttribute("aria-invalid", "true");
          wrap.append(h("div", { class: "err", text: details[name] }));
        }
      }
      const first = Object.keys(details).find((n) => inputs[n]);
      if (first) inputs[first].focus();
    },
  };
}

function showSaveError(form, err) {
  form?.setErrors(err.details || {});
  toast(err.message, true);
}

// ---------- entity definitions (org structure + master data) ----------

const ENTITY = {
  "business-groups": {
    label: "กลุ่มธุรกิจ",
    fields: () => [
      { name: "code", label: "รหัส", required: true },
      { name: "name", label: "ชื่อกลุ่มธุรกิจ", required: true },
      { name: "sort_order", label: "ลำดับการแสดง", type: "number" },
      { name: "is_active", label: "ใช้งานอยู่", type: "checkbox" },
    ],
  },
  companies: {
    label: "บริษัท",
    fields: (lk) => [
      { name: "code", label: "รหัสบริษัท", required: true },
      { name: "name", label: "ชื่อบริษัท", required: true },
      { name: "business_group_id", label: "กลุ่มธุรกิจ", type: "select", numeric: true, required: true,
        options: lk.groups.map((g) => opt(g.id, `${g.name}${g.is_active ? "" : " (ปิดใช้งาน)"}`)) },
      { name: "is_active", label: "ใช้งานอยู่", type: "checkbox" },
    ],
  },
  departments: {
    label: "แผนก",
    fields: (lk) => [
      { name: "name", label: "ชื่อแผนก", required: true },
      { name: "company_id", label: "บริษัท", type: "select", numeric: true, required: true,
        options: lk.companies.map((c) => opt(c.id, `${c.code} — ${c.name}`)),
        hint: "ย้ายแผนกไปบริษัทอื่น พนักงานในแผนกจะย้ายตามไปด้วย" },
      { name: "function_id", label: "กลุ่มงาน (Function)", type: "select", numeric: true, required: true,
        options: lk.functions.map((f) => opt(f.id, `${f.code} ${f.name}`)) },
      { name: "is_active", label: "ใช้งานอยู่", type: "checkbox" },
    ],
  },
  functions: {
    label: "กลุ่มงาน",
    fields: () => [
      { name: "code", label: "รหัส", required: true },
      { name: "name", label: "ชื่อกลุ่มงาน", required: true },
      { name: "is_active", label: "ใช้งานอยู่", type: "checkbox" },
    ],
  },
  "job-levels": {
    label: "ระดับพนักงาน",
    fields: () => [
      { name: "code", label: "รหัส", required: true },
      { name: "name", label: "ชื่อระดับ", required: true },
      { name: "band", label: "ชั้นบริหาร (Band)", required: true, hint: "เช่น Executive, Middle Management, Operational" },
      { name: "rank", label: "ลำดับ (น้อย = สูง)", type: "number", required: true },
      { name: "is_active", label: "ใช้งานอยู่", type: "checkbox" },
    ],
  },
};

async function loadLookups() {
  const [groups, companies, functions, levels] = await Promise.all([
    api("GET", "/api/business-groups"),
    api("GET", "/api/companies"),
    api("GET", "/api/functions"),
    api("GET", "/api/job-levels"),
  ]);
  return { groups, companies, functions, levels };
}

/** Create/edit form for one entity record, with save and delete. */
function entityEditor({ entity, record, defaults = {}, lookups, onSaved, onDeleted, extra }) {
  const def = ENTITY[entity];
  const isNew = !record;
  const form = buildForm(def.fields(lookups), record || defaults);
  const save = h("button", { class: "primary", type: "submit", text: isNew ? `เพิ่ม${def.label}` : "บันทึก" });
  const del = isNew ? null : h("button", { class: "danger", type: "button", text: "ลบ" });
  const el = h("form", { novalidate: true },
    h("h2", { text: isNew ? `เพิ่ม${def.label}ใหม่` : `แก้ไข${def.label}` }),
    form.el,
    h("div", { class: "actions" }, save, extra, h("span", { class: "spacer" }), del));

  el.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(save, async () => {
      try {
        const saved = await api(isNew ? "POST" : "PATCH", `/api/${entity}${isNew ? "" : `/${record.id}`}`, form.read());
        toast(isNew ? `เพิ่ม${def.label}แล้ว` : "บันทึกแล้ว");
        onSaved?.(saved);
      } catch (err) {
        showSaveError(form, err);
      }
    });
  });
  del?.addEventListener("click", async () => {
    if (!(await confirmDialog(`ลบ${def.label} "${record.name}" ถาวร?`, "ลบ"))) return;
    busy(del, async () => {
      try {
        await api("DELETE", `/api/${entity}/${record.id}`);
        toast(`ลบ${def.label}แล้ว`);
        onDeleted?.();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
  return el;
}

// ---------- screen: org structure ----------

const orgState = { expanded: new Set(), selected: null, filter: "" };

async function renderOrg() {
  main.replaceChildren(stateMessage("กำลังโหลดโครงสร้างองค์กร…"));
  let tree, lookups;
  try {
    [tree, lookups] = await Promise.all([api("GET", "/api/org/tree"), loadLookups()]);
  } catch (err) {
    main.replaceChildren(stateMessage(err.message, true));
    return;
  }

  const total = tree.reduce((s, g) => s + g.headcount, 0);
  const panel = h("div", { class: "card" });
  const treeBox = h("div", { class: "card" });
  const filter = h("input", { type: "search", placeholder: "ค้นหากลุ่ม บริษัท หรือแผนก…", value: orgState.filter, "aria-label": "ค้นหาในโครงสร้าง" });

  const reload = () => renderOrg();
  const select = (sel) => {
    orgState.selected = sel;
    drawTree();
    drawPanel();
  };

  function findSelected() {
    const s = orgState.selected;
    if (!s || s.new) return null;
    for (const g of tree) {
      if (s.kind === "business-groups" && g.id === s.id) return { record: g };
      for (const c of g.companies) {
        if (s.kind === "companies" && c.id === s.id) return { record: { ...c, business_group_id: g.id }, group: g };
        for (const d of c.departments) {
          if (s.kind === "departments" && d.id === s.id) return { record: { ...d, company_id: c.id }, company: c };
        }
      }
    }
    return null;
  }

  function drawPanel() {
    const s = orgState.selected;
    if (!s) {
      panel.replaceChildren(h("h2", { text: "แก้ไขโครงสร้าง" }),
        h("p", { class: "sub", text: "เลือกกลุ่มธุรกิจ บริษัท หรือแผนกจากผังด้านซ้ายเพื่อแก้ไข หรือกดปุ่ม \"+\" เพื่อเพิ่มรายการใหม่" }));
      return;
    }
    const found = findSelected();
    if (!s.new && !found) {
      orgState.selected = null;
      return drawPanel();
    }
    const viewStaff = !s.new && s.kind !== "business-groups"
      ? h("a", { class: "btn", href: `#/employees?${s.kind === "companies" ? "company_id" : "department_id"}=${s.id}`, text: "ดูพนักงาน" })
      : null;
    panel.replaceChildren(entityEditor({
      entity: s.kind,
      record: found?.record,
      defaults: s.defaults,
      lookups,
      extra: viewStaff,
      onSaved: (saved) => {
        orgState.selected = { kind: s.kind, id: saved.id };
        reload();
      },
      onDeleted: () => {
        orgState.selected = null;
        reload();
      },
    }));
  }

  function node(kind, item, label, meta) {
    const selected = orgState.selected && !orgState.selected.new && orgState.selected.kind === kind && orgState.selected.id === item.id;
    return h("button", {
      type: "button",
      class: `node${selected ? " selected" : ""}${item.is_active ? "" : " inactive"}`,
      "aria-current": selected ? "true" : null,
      onClick: () => select({ kind, id: item.id }),
    }, h("span", { class: "name", text: label }), meta, h("span", { class: "tag count", title: "พนักงานปัจจุบัน", text: item.headcount.toLocaleString("th-TH") }));
  }

  function toggle(key, open) {
    return h("button", {
      type: "button", class: "node twisty-btn", "aria-expanded": String(open), "aria-label": open ? "ยุบ" : "ขยาย",
      onClick: () => {
        if (open) orgState.expanded.delete(key);
        else orgState.expanded.add(key);
        drawTree();
      },
    }, h("span", { class: "twisty", text: open ? "▾" : "▸" }));
  }

  function drawTree() {
    const q = orgState.filter.trim().toLowerCase();
    const match = (...s) => !q || s.some((x) => x && x.toLowerCase().includes(q));
    const items = [];
    for (const g of tree) {
      const companies = g.companies
        .map((c) => ({ c, depts: c.departments.filter((d) => match(d.name, d.function_name, g.name, c.name, c.code)) }))
        .filter(({ c, depts }) => depts.length || match(g.name, c.name, c.code));
      if (q && !companies.length && !match(g.name)) continue;
      const gKey = `g${g.id}`;
      const gOpen = !!q || orgState.expanded.has(gKey);
      items.push(h("li", { class: "lvl-group" },
        h("div", { class: "row-flex" }, toggle(gKey, gOpen), node("business-groups", g, g.name, h("span", { class: "tag", text: `${g.companies.length} บริษัท` }))),
        gOpen ? h("ul", {}, companies.map(({ c, depts }) => {
          const cKey = `c${c.id}`;
          const cOpen = (!!q && depts.length > 0 && depts.length < c.departments.length) || orgState.expanded.has(cKey);
          return h("li", { class: "lvl-company" },
            h("div", { class: "row-flex" }, toggle(cKey, cOpen), node("companies", c, `${c.code} — ${c.name}`, null)),
            cOpen ? h("ul", {}, depts.map((d) => h("li", {},
              node("departments", d, d.name, h("span", { class: "tag", title: d.function_name, text: d.function_code }))))) : null);
        })) : null));
    }
    treeBox.replaceChildren(items.length ? h("ul", { class: "tree" }, items) : stateMessage("ไม่พบรายการที่ค้นหา"));
  }

  const selectedCompany = () => {
    const f = findSelected();
    return orgState.selected?.kind === "companies" ? orgState.selected.id : f?.company?.id ?? f?.record?.company_id;
  };
  const selectedGroup = () => {
    const f = findSelected();
    return orgState.selected?.kind === "business-groups" ? orgState.selected.id : f?.group?.id;
  };

  let filterTimer;
  filter.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      orgState.filter = filter.value;
      drawTree();
    }, 200);
  });

  main.replaceChildren(
    h("h1", { text: "โครงสร้างองค์กร" }),
    h("p", { class: "sub", text: `กลุ่มธุรกิจ › บริษัท › แผนก — พนักงานปัจจุบันรวม ${total.toLocaleString("th-TH")} คน` }),
    h("div", { class: "toolbar" },
      h("div", { class: "grow" }, filter),
      h("button", { type: "button", text: "+ กลุ่มธุรกิจ", onClick: () => select({ kind: "business-groups", new: true, defaults: { sort_order: tree.length + 1 } }) }),
      h("button", { type: "button", text: "+ บริษัท", onClick: () => select({ kind: "companies", new: true, defaults: { business_group_id: selectedGroup() } }) }),
      h("button", { type: "button", text: "+ แผนก", onClick: () => select({ kind: "departments", new: true, defaults: { company_id: selectedCompany() } }) })),
    h("div", { class: "split" }, treeBox, panel));
  drawTree();
  drawPanel();
}

// ---------- screen: employee list ----------

const STATUS_LABEL = { active: "ปฏิบัติงาน", resigned: "พ้นสภาพ" };

async function renderEmployees(params) {
  main.replaceChildren(stateMessage("กำลังโหลด…"));
  let lookups;
  try {
    lookups = await loadLookups();
  } catch (err) {
    main.replaceChildren(stateMessage(err.message, true));
    return;
  }
  const f = {
    q: params.get("q") || "",
    business_group_id: params.get("business_group_id") || "",
    company_id: params.get("company_id") || "",
    department_id: params.get("department_id") || "",
    status: params.has("status") ? params.get("status") : "active",
    page: Number(params.get("page")) || 1,
  };

  const q = h("input", { type: "search", value: f.q, placeholder: "รหัส ชื่อ หรือตำแหน่ง", id: "flt-q" });
  const group = h("select", { id: "flt-group" }, h("option", { value: "", text: "ทุกกลุ่มธุรกิจ" }),
    lookups.groups.map((g) => h("option", { value: g.id, text: g.name })));
  const company = h("select", { id: "flt-company" });
  const status = h("select", { id: "flt-status" },
    h("option", { value: "active", text: "ปฏิบัติงาน" }), h("option", { value: "resigned", text: "พ้นสภาพ" }), h("option", { value: "", text: "ทั้งหมด" }));
  group.value = f.business_group_id;
  status.value = f.status;
  const fillCompanies = () => {
    const list = lookups.companies.filter((c) => !group.value || String(c.business_group_id) === group.value);
    company.replaceChildren(h("option", { value: "", text: "ทุกบริษัท" }), ...list.map((c) => h("option", { value: c.id, text: `${c.code} — ${c.name}` })));
    company.value = list.some((c) => String(c.id) === f.company_id) ? f.company_id : "";
  };
  fillCompanies();

  const go = (page = 1) => {
    const p = new URLSearchParams();
    if (q.value.trim()) p.set("q", q.value.trim());
    if (group.value) p.set("business_group_id", group.value);
    if (company.value) p.set("company_id", company.value);
    if (f.department_id && company.value === f.company_id) p.set("department_id", f.department_id);
    p.set("status", status.value);
    if (page > 1) p.set("page", page);
    location.hash = `#/employees?${p}`;
  };
  let t;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => go(), 350);
  });
  group.addEventListener("change", () => go());
  company.addEventListener("change", () => go());
  status.addEventListener("change", () => go());

  const results = h("div", {}, stateMessage("กำลังค้นหา…"));
  const deptName = f.department_id
    ? (await api("GET", `/api/departments/${f.department_id}`).catch(() => null))?.name
    : null;

  main.replaceChildren(
    h("h1", { text: "พนักงาน" }),
    h("p", { class: "sub", text: deptName ? `แผนก: ${deptName}` : "ค้นหาและแก้ไขข้อมูลพนักงาน" }),
    h("div", { class: "toolbar" },
      h("div", { class: "grow" }, h("label", { for: "flt-q", text: "ค้นหา" }), q),
      h("div", {}, h("label", { for: "flt-group", text: "กลุ่มธุรกิจ" }), group),
      h("div", {}, h("label", { for: "flt-company", text: "บริษัท" }), company),
      h("div", {}, h("label", { for: "flt-status", text: "สถานะ" }), status),
      h("a", { class: "btn primary", href: "#/employees/new", text: "+ เพิ่มพนักงาน" })),
    results);
  if (f.q) {
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }

  const query = new URLSearchParams({ page: f.page, page_size: 25 });
  for (const k of ["q", "business_group_id", "company_id", "department_id", "status"]) if (f[k]) query.set(k, f[k]);
  let data;
  try {
    data = await api("GET", `/api/employees?${query}`);
  } catch (err) {
    results.replaceChildren(stateMessage(err.message, true));
    return;
  }
  if (!data.items.length) {
    results.replaceChildren(stateMessage(f.q || f.company_id || f.business_group_id
      ? "ไม่พบพนักงานตามเงื่อนไขที่เลือก"
      : "ยังไม่มีข้อมูลพนักงาน — กด \"+ เพิ่มพนักงาน\" เพื่อเริ่มบันทึก"));
    return;
  }
  const pages = Math.ceil(data.total / data.page_size);
  results.replaceChildren(
    h("div", { class: "table-wrap card" }, h("table", {},
      h("thead", {}, h("tr", {}, ["รหัส", "ชื่อ-สกุล", "ตำแหน่ง", "บริษัท", "แผนก", "ระดับ", "สถานะ", "วันเริ่มงาน"].map((c) => h("th", { scope: "col", text: c })))),
      h("tbody", {}, data.items.map((e) => h("tr", { class: "link", onClick: (ev) => { if (ev.target.tagName !== "A") location.hash = `#/employees/${e.id}`; } },
        h("td", {}, h("a", { href: `#/employees/${e.id}`, text: e.emp_code })),
        h("td", { text: `${e.title_th ?? ""}${e.first_name_th} ${e.last_name_th}` }),
        h("td", { text: e.position_title }),
        h("td", { text: e.company_code }),
        h("td", { text: e.department_name }),
        h("td", { text: e.job_level_name ?? "—" }),
        h("td", { class: `status-${e.status}`, text: STATUS_LABEL[e.status] }),
        h("td", { text: formatDate(e.hire_date) })))))),
    h("div", { class: "pager" },
      h("span", { class: "sub", text: `ทั้งหมด ${data.total.toLocaleString("th-TH")} คน · หน้า ${data.page}/${pages}` }),
      h("button", { type: "button", text: "‹ ก่อนหน้า", disabled: data.page <= 1, onClick: () => go(data.page - 1) }),
      h("button", { type: "button", text: "ถัดไป ›", disabled: data.page >= pages, onClick: () => go(data.page + 1) })));
}

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${Number(y) + 543}`;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- screen: employee form ----------

const PROBATION_DAYS = 119;

async function renderEmployeeForm(id) {
  main.replaceChildren(stateMessage("กำลังโหลด…"));
  let lookups, emp = null;
  try {
    [lookups, emp] = await Promise.all([loadLookups(), id ? api("GET", `/api/employees/${id}`) : null]);
  } catch (err) {
    main.replaceChildren(stateMessage(err.status === 404 ? "ไม่พบพนักงานคนนี้ อาจถูกลบไปแล้ว" : err.message, true));
    return;
  }
  const isNew = !emp;
  const values = emp || { status: "active" };
  const activeCompanies = lookups.companies.filter((c) => c.is_active || c.id === emp?.company_id);

  const personal = buildForm([
    { name: "emp_code", label: "รหัสพนักงาน", required: true },
    { name: "title_th", label: "คำนำหน้า (ไทย)", type: "select", options: ["นาย", "นาง", "นางสาว"].map((t) => opt(t, t)) },
    { name: "first_name_th", label: "ชื่อ (ไทย)", required: true },
    { name: "last_name_th", label: "นามสกุล (ไทย)", required: true },
    { name: "title_en", label: "Title (EN)", type: "select", options: ["Mr.", "Mrs.", "Miss", "Ms."].map((t) => opt(t, t)) },
    { name: "first_name_en", label: "First name (EN)" },
    { name: "last_name_en", label: "Last name (EN)" },
    { name: "gender", label: "เพศ", type: "select", options: [opt("male", "ชาย"), opt("female", "หญิง"), opt("other", "อื่น ๆ")] },
    { name: "birth_date", label: "วันเกิด", type: "date" },
    { name: "email", label: "อีเมลบริษัท", type: "email" },
  ], values);

  const companySel = h("select", { id: "f-company" },
    h("option", { value: "", text: "— เลือกบริษัท —" }),
    activeCompanies.map((c) => h("option", { value: c.id, text: `${c.code} — ${c.name}` })));
  companySel.value = emp ? String(emp.company_id) : "";

  const job = buildForm([
    { name: "department_id", label: "แผนก", type: "select", numeric: true, required: true, options: [] },
    { name: "position_title", label: "ตำแหน่ง", required: true },
    { name: "job_level_id", label: "ระดับ", type: "select", numeric: true,
      options: lookups.levels.filter((l) => l.is_active || l.id === emp?.job_level_id).map((l) => opt(l.id, `${l.name} (${l.band})`)) },
    { name: "job_family", label: "สถานะตำแหน่งงาน", type: "select",
      options: [opt("Front", "Front — งานหน้าร้าน/ลูกค้า"), opt("Technical", "Technical — งานเทคนิค"), opt("Support", "Support — งานสนับสนุน"), opt("Management", "Management — ผู้บริหาร")] },
    { name: "branch", label: "สาขา / สถานที่ทำงาน" },
  ], values);

  const deptSel = job.input("department_id");
  async function fillDepartments(keep) {
    if (!companySel.value) {
      deptSel.replaceChildren(h("option", { value: "", text: "— เลือกบริษัทก่อน —" }));
      return;
    }
    deptSel.replaceChildren(h("option", { value: "", text: "กำลังโหลด…" }));
    try {
      const depts = await api("GET", `/api/departments?company_id=${companySel.value}`);
      const list = depts.filter((d) => d.is_active || d.id === emp?.department_id);
      deptSel.replaceChildren(h("option", { value: "", text: list.length ? "— เลือกแผนก —" : "บริษัทนี้ยังไม่มีแผนก" }),
        ...list.map((d) => h("option", { value: d.id, text: d.name })));
      if (keep) deptSel.value = String(keep);
    } catch (err) {
      deptSel.replaceChildren(h("option", { value: "", text: "โหลดแผนกไม่สำเร็จ" }));
      toast(err.message, true);
    }
  }
  companySel.addEventListener("change", () => fillDepartments());
  await fillDepartments(emp?.department_id);

  // Manager picker: type to search, choose from the list.
  let managerId = emp?.manager_id ?? null;
  const mgrInput = h("input", { id: "f-manager", type: "search", autocomplete: "off", placeholder: "พิมพ์รหัสหรือชื่อเพื่อค้นหา",
    value: emp?.manager_id ? `${emp.manager_emp_code} ${emp.manager_name}` : "" });
  const mgrList = h("ul", { role: "listbox", hidden: true });
  const mgrWrap = h("div", { class: "field" }, h("label", { for: "f-manager", text: "หัวหน้างาน (รายงานตรงต่อ)" }), h("div", { class: "picker" }, mgrInput, mgrList));
  let mgrTimer;
  mgrInput.addEventListener("input", () => {
    managerId = null;
    clearTimeout(mgrTimer);
    const term = mgrInput.value.trim();
    if (term.length < 2) return (mgrList.hidden = true);
    mgrTimer = setTimeout(async () => {
      try {
        const res = await api("GET", `/api/employees?status=active&page_size=8&q=${encodeURIComponent(term)}`);
        const options = res.items.filter((m) => m.id !== emp?.id);
        mgrList.replaceChildren(...(options.length ? options.map((m) => h("li", {}, h("button", {
          type: "button", role: "option",
          text: `${m.emp_code} ${m.first_name_th} ${m.last_name_th} · ${m.position_title} (${m.company_code})`,
          onClick: () => {
            managerId = m.id;
            mgrInput.value = `${m.emp_code} ${m.first_name_th} ${m.last_name_th}`;
            mgrList.hidden = true;
          },
        }))) : [h("li", { class: "sub", text: "ไม่พบพนักงาน" })]));
        mgrList.hidden = false;
      } catch (err) {
        toast(err.message, true);
      }
    }, 300);
  });

  const dates = buildForm([
    { name: "hire_date", label: "วันที่เริ่มงาน", type: "date", required: true },
    { name: "probation_end_date", label: "วันพ้นทดลองงาน", type: "date", hint: `เว้นว่างไว้ ระบบจะคำนวณให้ ${PROBATION_DAYS} วันหลังวันเริ่มงาน` },
    { name: "status", label: "สถานะ", type: "select", required: true, options: [opt("active", "ปฏิบัติงาน"), opt("resigned", "พ้นสภาพ")] },
    { name: "resign_date", label: "วันที่พ้นสภาพ", type: "date", required: true },
  ], values);
  const syncResign = () => (dates.wrapper("resign_date").hidden = dates.input("status").value !== "resigned");
  dates.input("status").addEventListener("change", syncResign);
  syncResign();
  dates.input("hire_date").addEventListener("change", () => {
    const hire = dates.input("hire_date").value;
    if (hire && !dates.input("probation_end_date").value) dates.input("probation_end_date").value = addDays(hire, PROBATION_DAYS);
  });

  const save = h("button", { class: "primary", type: "submit", text: isNew ? "บันทึกพนักงานใหม่" : "บันทึกการแก้ไข" });
  const del = isNew ? null : h("button", { class: "danger", type: "button", text: "ลบข้อมูล" });
  const form = h("form", { novalidate: true },
    h("fieldset", {}, h("legend", { text: "ข้อมูลส่วนตัว" }), h("div", { class: "grid2" }, personal.el)),
    h("fieldset", {}, h("legend", { text: "สังกัดและตำแหน่ง" }), h("div", { class: "grid2" },
      h("div", { class: "field" }, h("label", { for: "f-company" }, "บริษัท", h("span", { class: "req", text: " *" })), companySel),
      job.el, mgrWrap)),
    h("fieldset", {}, h("legend", { text: "วันที่และสถานะ" }), h("div", { class: "grid2" }, dates.el)),
    h("div", { class: "actions" }, save, h("a", { class: "btn", href: "#/employees", text: "ยกเลิก" }), h("span", { class: "spacer" }), del));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(save, async () => {
      const body = { ...personal.read(), ...job.read(), ...dates.read(), manager_id: managerId };
      if (body.status !== "resigned") body.resign_date = null;
      if (!body.probation_end_date && body.hire_date) body.probation_end_date = addDays(body.hire_date, PROBATION_DAYS);
      if (mgrInput.value.trim() && managerId === null) {
        toast("กรุณาเลือกหัวหน้างานจากรายการที่ค้นหา หรือเว้นว่างไว้", true);
        mgrInput.focus();
        return;
      }
      try {
        const saved = await api(isNew ? "POST" : "PATCH", isNew ? "/api/employees" : `/api/employees/${emp.id}`, body);
        toast(isNew ? `เพิ่มพนักงาน ${saved.emp_code} แล้ว` : "บันทึกแล้ว");
        location.hash = `#/employees/${saved.id}`;
        if (!isNew) renderEmployeeForm(saved.id);
      } catch (err) {
        const details = err.details || {};
        for (const f of [personal, job, dates]) f.setErrors(details);
        toast(err.message, true);
      }
    });
  });
  del?.addEventListener("click", async () => {
    const ok = await confirmDialog(
      `ลบข้อมูล ${emp.emp_code} ${emp.first_name_th} ${emp.last_name_th} ถาวร?`,
      "ลบข้อมูล",
      "ถ้าพนักงานลาออก ให้เปลี่ยนสถานะเป็น \"พ้นสภาพ\" แทน เพื่อเก็บประวัติไว้",
    );
    if (!ok) return;
    busy(del, async () => {
      try {
        await api("DELETE", `/api/employees/${emp.id}`);
        toast("ลบข้อมูลแล้ว");
        location.hash = "#/employees";
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  main.replaceChildren(
    h("p", {}, h("a", { href: "#/employees", text: "‹ รายชื่อพนักงาน" })),
    h("h1", { text: isNew ? "เพิ่มพนักงานใหม่" : `${emp.emp_code} · ${emp.first_name_th} ${emp.last_name_th}` }),
    h("p", { class: "sub", text: isNew ? "ช่องที่มี * ต้องกรอก" : `${emp.company_name} › ${emp.department_name} · ${emp.function_code} ${emp.function_name}` }),
    h("div", { class: "card" }, form));
  personal.input("emp_code").focus();
}

// ---------- screen: master data ----------

async function renderMaster() {
  main.replaceChildren(stateMessage("กำลังโหลด…"));
  let lookups;
  try {
    lookups = await loadLookups();
  } catch (err) {
    main.replaceChildren(stateMessage(err.message, true));
    return;
  }
  const panel = h("div", { class: "card" }, h("h2", { text: "แก้ไขข้อมูลหลัก" }), h("p", { class: "sub", text: "เลือกรายการจากตารางเพื่อแก้ไข" }));
  const edit = (entity, record) => {
    panel.replaceChildren(entityEditor({ entity, record, lookups, onSaved: renderMaster, onDeleted: renderMaster }));
    panel.querySelector("input")?.focus();
  };
  const table = (entity, rows, cols) => h("div", { class: "card" },
    h("div", { class: "toolbar" }, h("h2", { class: "grow", text: ENTITY[entity].label }),
      h("button", { type: "button", text: `+ เพิ่ม${ENTITY[entity].label}`, onClick: () => edit(entity, null) })),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, cols.map(([label]) => h("th", { scope: "col", text: label })), h("th", { scope: "col", text: "สถานะ" }))),
      h("tbody", {}, rows.map((r) => h("tr", {},
        cols.map(([, key], i) => h("td", {}, i === 0
          ? h("button", { type: "button", class: "node", text: r[key], onClick: () => edit(entity, r) })
          : r[key])),
        h("td", { class: r.is_active ? "status-active" : "status-resigned", text: r.is_active ? "ใช้งาน" : "ปิดใช้งาน" })))))));

  main.replaceChildren(
    h("h1", { text: "ข้อมูลหลัก" }),
    h("p", { class: "sub", text: "กลุ่มงานมาตรฐานและระดับพนักงานที่ใช้ทั้งกลุ่มบริษัท" }),
    h("div", { class: "split" },
      h("div", {}, table("functions", lookups.functions, [["รหัส", "code"], ["ชื่อกลุ่มงาน", "name"]]),
        h("br"), table("job-levels", lookups.levels, [["รหัส", "code"], ["ชื่อระดับ", "name"], ["Band", "band"], ["ลำดับ", "rank"]])),
      panel));
}

// ---------- router ----------

async function route() {
  const { parts, params } = parseHash();
  const section = parts[0] || "org";
  for (const a of document.querySelectorAll("[data-nav]")) {
    if (a.dataset.nav === section) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (section === "employees" && parts[1] === "new") return renderEmployeeForm(null);
  if (section === "employees" && /^\d+$/.test(parts[1] || "")) return renderEmployeeForm(Number(parts[1]));
  if (section === "employees") return renderEmployees(params);
  if (section === "master") return renderMaster();
  return renderOrg();
}

window.addEventListener("hashchange", route);
route();
