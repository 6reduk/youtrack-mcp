import assert from "node:assert/strict";
import test from "node:test";
import { decodeReadableFieldValue, valueShapeFor } from "../../src/infrastructure/youtrack/custom-field-codecs.js";

void test("known observed value types map without relying on field names", () => {
  assert.equal(valueShapeFor("string"), "scalar");
  assert.equal(valueShapeFor("date"), "date");
  assert.equal(valueShapeFor("period"), "period");
  assert.equal(valueShapeFor("user"), "user");
  assert.equal(valueShapeFor("enum"), "entity");
  assert.equal(valueShapeFor("unseen-type"), "unknown");
  assert.deepEqual(decodeReadableFieldValue({ id: "choice-id", name: "Any" }, "entity"), {
    kind: "entity", selector: { id: "choice-id" },
  });
});

void test("unknown values remain safely readable and cannot become write FieldValue", () => {
  const decoded = decodeReadableFieldValue({ arbitrary: [1, "x"] }, "unknown");
  assert.deepEqual(decoded, { kind: "unknown", value: { arbitrary: [1, "x"] } });
});
