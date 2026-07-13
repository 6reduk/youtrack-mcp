import type {
  FieldAtom,
  ReadableFieldValue,
  SafeJsonValue,
} from "../../domain/field-values.js";
import type { FieldValueShape } from "../../domain/project-schema.js";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeJson(value: unknown, depth = 0): SafeJsonValue {
  if (depth > 12) return "[depth-limit]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => safeJson(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, SafeJsonValue> = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) output[key] = safeJson(item, depth + 1);
    return output;
  }
  return typeof value === "symbol" ? value.description ?? "[symbol]" : "[unsupported-value]";
}

export function valueShapeFor(valueType: string | null): FieldValueShape {
  switch (valueType?.toLowerCase()) {
    case "string":
    case "integer":
    case "float":
    case "boolean":
    case "text":
      return "scalar";
    case "date":
    case "date and time":
      return "date";
    case "period":
      return "period";
    case "user":
      return "user";
    case "enum":
    case "state":
    case "version":
    case "ownedfield":
    case "build":
    case "group":
      return "entity";
    default:
      return "unknown";
  }
}

function decodeAtom(value: unknown, shape: FieldValueShape): FieldAtom | null {
  if (shape === "scalar" && ["string", "number", "boolean"].includes(typeof value)) {
    return { kind: "scalar", value: value as string | number | boolean };
  }
  if (shape === "date" && typeof value === "number" && Number.isSafeInteger(value)) {
    return { kind: "date", epochMillis: value };
  }
  if (shape === "period" && typeof value === "object" && value !== null) {
    const presentation = stringValue((value as Record<string, unknown>).presentation);
    if (presentation !== null) return { kind: "period", iso8601: presentation };
  }
  if ((shape === "entity" || shape === "user") && typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const id = stringValue(record.id);
    if (id === null) return null;
    return shape === "user"
      ? { kind: "user", selector: { id } }
      : { kind: "entity", selector: { id } };
  }
  return null;
}

export function decodeReadableFieldValue(
  value: unknown,
  shape: FieldValueShape,
): ReadableFieldValue | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const atoms = value.map((item) => decodeAtom(item, shape));
    if (shape !== "unknown" && atoms.every((item): item is FieldAtom => item !== null)) {
      return { kind: "multi", values: atoms };
    }
    return { kind: "unknown", value: safeJson(value) };
  }
  const atom = decodeAtom(value, shape);
  return atom ?? { kind: "unknown", value: safeJson(value) };
}
