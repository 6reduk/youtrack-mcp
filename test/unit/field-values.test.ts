import assert from "node:assert/strict";
import { test } from "node:test";

import { validateFieldChange, type CustomFieldChange } from "../../src/domain/field-values.js";
import { canWriteField, type FieldDefinition, type FieldValueShape } from "../../src/domain/project-schema.js";

function field(
  valueShape: FieldValueShape,
  cardinality: FieldDefinition["cardinality"] = "single",
  overrides: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    id: "field-id",
    name: "Arbitrary field",
    fieldType: "SyntheticField",
    valueType: null,
    valueShape,
    cardinality,
    required: false,
    writability: "writable",
    valuesComplete: false,
    allowedValues: [],
    provenance: ["admin_project_fields"],
    ...overrides,
  };
}

function set(value: CustomFieldChange & { action: "set" }): CustomFieldChange {
  return value;
}

void test("validates every supported single atom without field-name semantics", () => {
  const cases: readonly [FieldValueShape, CustomFieldChange][] = [
    ["scalar", set({ field: { id: "field-id" }, action: "set", value: { kind: "scalar", value: 3 } })],
    ["date", set({ field: { id: "field-id" }, action: "set", value: { kind: "date", epochMillis: 1 } })],
    ["period", set({ field: { id: "field-id" }, action: "set", value: { kind: "period", iso8601: "P1D" } })],
    ["entity", set({ field: { id: "field-id" }, action: "set", value: { kind: "entity", selector: { id: "value-id" } } })],
    ["user", set({ field: { id: "field-id" }, action: "set", value: { kind: "user", selector: { login: "user.login" } } })],
  ];

  for (const [shape, change] of cases) {
    assert.deepEqual(validateFieldChange(field(shape), change), { valid: true });
  }
});

void test("keeps unknown types readable but rejects writes", () => {
  const definition = field("unknown");
  assert.equal(canWriteField(definition), false);
  assert.deepEqual(
    validateFieldChange(definition, {
      field: { id: "field-id" },
      action: "set",
      value: { kind: "scalar", value: "x" },
    }),
    {
      valid: false,
      kind: "unsupported_field_type",
      message: "The discovered field type has no write codec",
    },
  );
});

void test("accepts API-neutral scalar and epoch representations", () => {
  assert.deepEqual(
    validateFieldChange(field("scalar"), {
      field: { id: "field-id" },
      action: "set",
      value: { kind: "scalar", value: "" },
    }),
    { valid: true },
  );
  assert.deepEqual(
    validateFieldChange(field("date"), {
      field: { id: "field-id" },
      action: "set",
      value: { kind: "date", epochMillis: -1 },
    }),
    { valid: true },
  );
});

void test("rejects writes when cardinality is not proven", () => {
  const definition = field("scalar", "unknown");
  assert.equal(canWriteField(definition), false);
  assert.deepEqual(
    validateFieldChange(definition, {
      field: { id: "field-id" },
      action: "set",
      value: { kind: "scalar", value: "x" },
    }),
    {
      valid: false,
      kind: "unknown_cardinality",
      message: "Field cardinality is not proven",
    },
  );
});

void test("distinguishes explicit clear and protects required fields", () => {
  assert.deepEqual(
    validateFieldChange(field("scalar"), { field: { id: "field-id" }, action: "clear" }),
    { valid: true },
  );
  const result = validateFieldChange(field("scalar", "single", { required: true }), {
    field: { id: "field-id" },
    action: "clear",
  });
  assert.equal(result.valid, false);
});

void test("validates multi cardinality, uniqueness, kinds and bounds", () => {
  const definition = field("entity", "multi");
  assert.deepEqual(
    validateFieldChange(definition, {
      field: { id: "field-id" },
      action: "set",
      value: {
        kind: "multi",
        values: [
          { kind: "entity", selector: { id: "one" } },
          { kind: "entity", selector: { exactName: "Two" } },
        ],
      },
    }),
    { valid: true },
  );

  const duplicate = validateFieldChange(definition, {
    field: { id: "field-id" },
    action: "set",
    value: {
      kind: "multi",
      values: [
        { kind: "entity", selector: { id: "one" } },
        { kind: "entity", selector: { id: "one" } },
      ],
    },
  });
  assert.deepEqual(duplicate, {
    valid: false,
    kind: "duplicate_value",
    message: "Multi values must be unique",
  });
});

void test("rejects shape/cardinality errors and invalid atom representations", () => {
  const mismatch = validateFieldChange(field("date"), {
    field: { id: "field-id" },
    action: "set",
    value: { kind: "scalar", value: 1 },
  });
  assert.equal(mismatch.valid, false);

  const wrongCardinality = validateFieldChange(field("scalar", "multi"), {
    field: { id: "field-id" },
    action: "set",
    value: { kind: "scalar", value: "x" },
  });
  assert.equal(wrongCardinality.valid, false);

  const invalidPeriod = validateFieldChange(field("period"), {
    field: { id: "field-id" },
    action: "set",
    value: { kind: "period", iso8601: "one day" },
  });
  assert.equal(invalidPeriod.valid, false);

  const invalidNumber = validateFieldChange(field("scalar"), {
    field: { id: "field-id" },
    action: "set",
    value: { kind: "scalar", value: Number.POSITIVE_INFINITY },
  });
  assert.deepEqual(invalidNumber, {
    valid: false,
    kind: "invalid_number",
    message: "Numeric values must be finite",
  });
});
