import { badRequest } from "./errors.js";

export type FieldSpec =
  | { type: "string"; required?: boolean; max?: number; pattern?: RegExp; patternMessage?: string }
  | { type: "email"; required?: boolean }
  | { type: "date"; required?: boolean }
  | { type: "int"; required?: boolean; min?: number }
  | { type: "bool"; required?: boolean }
  | { type: "enum"; required?: boolean; values: readonly string[] };

export type Schema = Record<string, FieldSpec>;
export type Value = string | number | null;
export type Clean = Record<string, Value>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/**
 * Check `input` against `schema` and return only the known fields, trimmed and
 * converted. Empty strings become null. With `partial`, missing fields are
 * skipped instead of reported (for updates). Throws a 400 listing every
 * invalid field so the form can highlight them all at once.
 */
export function validate(input: unknown, schema: Schema, partial = false): Clean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw badRequest("ข้อมูลที่ส่งมาไม่ถูกต้อง");
  }
  const src = input as Record<string, unknown>;
  const out: Clean = {};
  const errors: Record<string, string> = {};

  for (const [key, spec] of Object.entries(schema)) {
    if (!(key in src)) {
      if (!partial && spec.required) errors[key] = "จำเป็นต้องกรอก";
      continue;
    }
    let raw = src[key];
    if (typeof raw === "string") raw = raw.trim();
    if (raw === "" || raw === null || raw === undefined) {
      if (spec.required) errors[key] = "จำเป็นต้องกรอก";
      else out[key] = null;
      continue;
    }

    switch (spec.type) {
      case "string":
        if (typeof raw !== "string") errors[key] = "ต้องเป็นข้อความ";
        else if (raw.length > (spec.max ?? 200)) errors[key] = `ยาวได้ไม่เกิน ${spec.max ?? 200} ตัวอักษร`;
        else if (spec.pattern && !spec.pattern.test(raw)) errors[key] = spec.patternMessage ?? "รูปแบบไม่ถูกต้อง";
        else out[key] = raw;
        break;
      case "email":
        if (typeof raw !== "string" || raw.length > 200 || !EMAIL.test(raw)) errors[key] = "อีเมลไม่ถูกต้อง";
        else out[key] = raw.toLowerCase();
        break;
      case "date":
        if (typeof raw !== "string" || !isValidDate(raw)) errors[key] = "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD (ค.ศ.)";
        else out[key] = raw;
        break;
      case "int": {
        const n = typeof raw === "string" ? Number(raw) : raw;
        if (typeof n !== "number" || !Number.isInteger(n) || n < (spec.min ?? 1)) errors[key] = "ค่าไม่ถูกต้อง";
        else out[key] = n;
        break;
      }
      case "bool":
        if (typeof raw !== "boolean") errors[key] = "ต้องเป็น true/false";
        else out[key] = raw ? 1 : 0;
        break;
      case "enum":
        if (typeof raw !== "string" || !spec.values.includes(raw)) errors[key] = "ค่าไม่อยู่ในตัวเลือก";
        else out[key] = raw;
        break;
    }
  }

  if (Object.keys(errors).length > 0) throw badRequest("กรุณาตรวจสอบข้อมูลที่กรอก", errors);
  return out;
}
