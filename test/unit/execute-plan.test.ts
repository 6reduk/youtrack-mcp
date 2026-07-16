import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalJson,
  EXECUTE_PLAN_HASH_DOMAIN,
  EXECUTE_PLAN_MAX_CUSTOM_FIELD_CHANGES,
  EXECUTE_PLAN_MAX_MULTI_VALUES,
  EXECUTE_PLAN_MAX_OPERATION_ID_LENGTH,
  EXECUTE_PLAN_MAX_OPERATIONS,
  EXECUTE_PLAN_MAX_WRITES,
  EXECUTE_PLAN_VERSION,
  hashResolvedPlan,
  type ResolvedIssueLinkV1,
  type ResolvedPlanV1,
  type ResolvedTagMembershipV1,
  type ResolvedUpdateIssueV1,
} from "../../src/domain/execute-plan.js";

const fixedOperation = {
  command: {
    customFields: [
      {
        $type: "StateIssueCustomField",
        id: "147-71",
        value: { id: "130-65" },
      },
    ],
  },
  expectedUpdatedAt: 1_784_200_000_000,
  index: 0,
  inputKind: "set_issue_state",
  kind: "update_issue",
  operationId: "set-state",
  postconditions: [
    { fieldId: "147-71", kind: "custom_field", value: { id: "130-65" } },
  ],
  subjectIssueId: "2-10",
} satisfies ResolvedUpdateIssueV1;

const fixedPlan = {
  operations: [fixedOperation],
  version: 1,
} satisfies ResolvedPlanV1;
const fixedCanonicalJson = "{\"operations\":[{\"command\":{\"customFields\":[{\"$type\":\"StateIssueCustomField\",\"id\":\"147-71\",\"value\":{\"id\":\"130-65\"}}]},\"expectedUpdatedAt\":1784200000000,\"index\":0,\"inputKind\":\"set_issue_state\",\"kind\":\"update_issue\",\"operationId\":\"set-state\",\"postconditions\":[{\"fieldId\":\"147-71\",\"kind\":\"custom_field\",\"value\":{\"id\":\"130-65\"}}],\"subjectIssueId\":\"2-10\"}],\"version\":1}";

void test("pins execute-plan v1 bounds and hash domain", () => {
  assert.equal(EXECUTE_PLAN_VERSION, 1);
  assert.equal(EXECUTE_PLAN_MAX_OPERATIONS, 20);
  assert.equal(EXECUTE_PLAN_MAX_WRITES, 20);
  assert.equal(EXECUTE_PLAN_MAX_OPERATION_ID_LENGTH, 64);
  assert.equal(EXECUTE_PLAN_MAX_CUSTOM_FIELD_CHANGES, 100);
  assert.equal(EXECUTE_PLAN_MAX_MULTI_VALUES, 100);
  assert.equal(EXECUTE_PLAN_HASH_DOMAIN, "youtrack_execute_plan:v1\n");
});

void test("matches the normative canonical JSON and SHA-256 vector", () => {
  assert.equal(canonicalJson(fixedPlan), fixedCanonicalJson);
  assert.equal(
    hashResolvedPlan(fixedPlan),
    "685164b01a86841201c5ecea3a4301f3c4b4dff1adb1493d50ac48c77d21c127",
  );
});

void test("object property insertion order does not affect canonical JSON or plan hash", () => {
  const reorderedPlan = {
    version: 1,
    operations: [
      {
        subjectIssueId: "2-10",
        postconditions: [
          { value: { id: "130-65" }, kind: "custom_field", fieldId: "147-71" },
        ],
        operationId: "set-state",
        kind: "update_issue",
        inputKind: "set_issue_state",
        index: 0,
        expectedUpdatedAt: 1_784_200_000_000,
        command: {
          customFields: [
            {
              value: { id: "130-65" },
              id: "147-71",
              $type: "StateIssueCustomField",
            },
          ],
        },
      },
    ],
  } satisfies ResolvedPlanV1;

  assert.equal(canonicalJson(reorderedPlan), fixedCanonicalJson);
  assert.equal(hashResolvedPlan(reorderedPlan), hashResolvedPlan(fixedPlan));
});

void test("preserves array order and makes operation order hash-sensitive", () => {
  assert.equal(canonicalJson(["second", "first"]), "[\"second\",\"first\"]");

  const first = {
    index: 0,
    operationId: "first",
    inputKind: "add_tag",
    kind: "tag_membership",
    subjectIssueId: "2-10",
    expectedUpdatedAt: 100,
    tagId: "6-1",
    desiredPresent: true,
  } as const;
  const second = {
    ...first,
    index: 1,
    operationId: "second",
    subjectIssueId: "2-11",
  } as const;
  const ordered = { version: 1, operations: [first, second] } satisfies ResolvedPlanV1;
  const reversed = { version: 1, operations: [second, first] } satisfies ResolvedPlanV1;

  assert.notEqual(hashResolvedPlan(ordered), hashResolvedPlan(reversed));
});

void test("every semantic resolved field changes the hash", () => {
  const variants: ResolvedPlanV1[] = [
    { ...fixedPlan, version: 1, operations: [{ ...fixedOperation, index: 1 }] },
    { ...fixedPlan, operations: [{ ...fixedOperation, operationId: "other" }] },
    { ...fixedPlan, operations: [{ ...fixedOperation, operationId: null }] },
    { ...fixedPlan, operations: [{ ...fixedOperation, inputKind: "set_custom_field" }] },
    { ...fixedPlan, operations: [{ ...fixedOperation, subjectIssueId: "2-11" }] },
    { ...fixedPlan, operations: [{ ...fixedOperation, expectedUpdatedAt: 1 }] },
    {
      ...fixedPlan,
      operations: [{ ...fixedOperation, command: { ...fixedOperation.command, summary: "Summary" } }],
    },
    {
      ...fixedPlan,
      operations: [{ ...fixedOperation, command: { ...fixedOperation.command, description: "Details" } }],
    },
    {
      ...fixedPlan,
      operations: [{
        ...fixedOperation,
        command: {
          customFields: [{
            $type: "StateIssueCustomField",
            id: "147-72",
            value: { id: "130-65" },
          }],
        },
      }],
    },
    {
      ...fixedPlan,
      operations: [{
        ...fixedOperation,
        command: {
          customFields: [{
            $type: "SingleEnumIssueCustomField",
            id: "147-71",
            value: { id: "130-65" },
          }],
        },
      }],
    },
    {
      ...fixedPlan,
      operations: [{
        ...fixedOperation,
        command: {
          customFields: [{
            $type: "StateIssueCustomField",
            id: "147-71",
            value: { id: "130-66" },
          }],
        },
      }],
    },
    {
      ...fixedPlan,
      operations: [{
        ...fixedOperation,
        postconditions: [{ kind: "custom_field", fieldId: "147-72", value: { id: "130-65" } }],
      }],
    },
    {
      ...fixedPlan,
      operations: [{
        ...fixedOperation,
        postconditions: [{ kind: "custom_field", fieldId: "147-71", value: { id: "130-66" } }],
      }],
    },
  ];

  const baseline = hashResolvedPlan(fixedPlan);
  for (const variant of variants) {
    assert.notEqual(hashResolvedPlan(variant), baseline);
  }

  const runtimeVersionChange = { ...fixedPlan, version: 2 } as unknown as ResolvedPlanV1;
  assert.notEqual(hashResolvedPlan(runtimeVersionChange), baseline);
  const runtimeKindChange = {
    ...fixedPlan,
    operations: [{ ...fixedOperation, kind: "tag_membership" }],
  } as unknown as ResolvedPlanV1;
  assert.notEqual(hashResolvedPlan(runtimeKindChange), baseline);
  const runtimePostconditionKindChange = {
    ...fixedPlan,
    operations: [{
      ...fixedOperation,
      postconditions: [{ ...fixedOperation.postconditions[0], kind: "summary" }],
    }],
  } as unknown as ResolvedPlanV1;
  assert.notEqual(hashResolvedPlan(runtimePostconditionKindChange), baseline);

  const summaryOperation = {
    ...fixedOperation,
    command: { summary: "Before" },
    postconditions: [{ kind: "summary", value: "Before" }],
  } satisfies ResolvedUpdateIssueV1;
  const summaryPlan = { version: 1, operations: [summaryOperation] } satisfies ResolvedPlanV1;
  assert.notEqual(
    hashResolvedPlan({
      ...summaryPlan,
      operations: [{ ...summaryOperation, postconditions: [{ kind: "summary", value: "After" }] }],
    }),
    hashResolvedPlan(summaryPlan),
  );

  const descriptionOperation = {
    ...fixedOperation,
    command: { description: "Before" },
    postconditions: [{ kind: "description", value: "Before" }],
  } satisfies ResolvedUpdateIssueV1;
  const descriptionPlan = {
    version: 1,
    operations: [descriptionOperation],
  } satisfies ResolvedPlanV1;
  assert.notEqual(
    hashResolvedPlan({
      ...descriptionPlan,
      operations: [{
        ...descriptionOperation,
        postconditions: [{ kind: "description", value: null }],
      }],
    }),
    hashResolvedPlan(descriptionPlan),
  );

  const tagOperation = {
    index: 0,
    operationId: "tag",
    inputKind: "add_tag",
    kind: "tag_membership",
    subjectIssueId: "2-10",
    expectedUpdatedAt: 100,
    tagId: "6-1",
    desiredPresent: true,
  } satisfies ResolvedTagMembershipV1;
  const tagPlan = { version: 1, operations: [tagOperation] } satisfies ResolvedPlanV1;
  const tagBaseline = hashResolvedPlan(tagPlan);
  assert.notEqual(
    hashResolvedPlan({ ...tagPlan, operations: [{ ...tagOperation, tagId: "6-2" }] }),
    tagBaseline,
  );
  assert.notEqual(
    hashResolvedPlan({ ...tagPlan, operations: [{ ...tagOperation, desiredPresent: false }] }),
    tagBaseline,
  );

  const linkOperation = {
    index: 0,
    operationId: "link",
    inputKind: "add_link",
    kind: "issue_link",
    subjectIssueId: "2-10",
    expectedUpdatedAt: 100,
    targetIssueId: "2-11",
    linkTypeId: "100-1",
    direction: "source_to_target",
    desiredPresent: true,
    preventCycle: false,
  } satisfies ResolvedIssueLinkV1;
  const linkPlan = {
    version: 1,
    operations: [linkOperation],
  } satisfies ResolvedPlanV1;
  const linkVariants: ResolvedPlanV1[] = [
    { ...linkPlan, operations: [{ ...linkOperation, targetIssueId: "2-12" }] },
    { ...linkPlan, operations: [{ ...linkOperation, linkTypeId: "100-2" }] },
    { ...linkPlan, operations: [{ ...linkOperation, direction: "target_to_source" }] },
    { ...linkPlan, operations: [{ ...linkOperation, desiredPresent: false }] },
    { ...linkPlan, operations: [{ ...linkOperation, preventCycle: true }] },
  ];
  const linkBaseline = hashResolvedPlan(linkPlan);
  for (const variant of linkVariants) {
    assert.notEqual(hashResolvedPlan(variant), linkBaseline);
  }
});

void test("sorts object keys by Unicode code points instead of UTF-16 code units", () => {
  const privateUse = "\uE000";
  const supplementary = "\u{1F4A9}";
  assert.equal(
    canonicalJson({ [supplementary]: 2, [privateUse]: 1 }),
    `{"${privateUse}":1,"${supplementary}":2}`,
  );
});

void test("accepts the complete canonical primitive subset and null-prototype objects", () => {
  const nullPrototype = Object.create(null) as Record<string, unknown>;
  nullPrototype.text = "line\n\"quoted\"";
  nullPrototype.values = [null, true, false, 0, -1.5];
  assert.equal(
    canonicalJson(nullPrototype),
    "{\"text\":\"line\\n\\\"quoted\\\"\",\"values\":[null,true,false,0,-1.5]}",
  );
});

void test("rejects non-finite numeric values", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => canonicalJson(value), /numbers must be finite/);
  }
});

void test("rejects unsupported primitive and callable values", () => {
  for (const value of [undefined, 1n, Symbol("value"), (): void => undefined]) {
    assert.throws(() => canonicalJson(value), /does not support/);
  }
});

void test("rejects symbol keys without reading their values", () => {
  const symbol = Symbol("secret");
  const value = { valid: true, [symbol]: "hidden" };
  assert.throws(() => canonicalJson(value), /string keys only/);
});

void test("rejects accessors and non-enumerable properties without invoking getters", () => {
  let getterCalled = false;
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "unsafe";
    },
  });
  const nonEnumerable = Object.defineProperty({}, "value", {
    enumerable: false,
    value: "hidden",
  });

  assert.throws(() => canonicalJson(accessor), /data properties only/);
  assert.equal(getterCalled, false);
  assert.throws(() => canonicalJson(nonEnumerable), /data properties only/);
});

void test("rejects class instances even when their fields are enumerable data properties", () => {
  class Example {
    value = "data";
  }
  assert.throws(() => canonicalJson(new Example()), /plain objects/);
});

void test("rejects direct and indirect cycles while allowing repeated acyclic references", () => {
  const direct: { self?: unknown } = {};
  direct.self = direct;
  const left: { right?: unknown } = {};
  const right = { left };
  left.right = right;
  const shared = { id: "shared" };

  assert.throws(() => canonicalJson(direct), /cyclic data/);
  assert.throws(() => canonicalJson(left), /cyclic data/);
  assert.equal(canonicalJson([shared, shared]), "[{\"id\":\"shared\"},{\"id\":\"shared\"}]");
});

void test("rejects sparse arrays, accessor elements, and extra string or symbol properties", () => {
  const sparse: string[] = [];
  sparse[0] = "first";
  sparse[2] = "third";
  const accessor = ["first"];
  Object.defineProperty(accessor, "0", { enumerable: true, get: () => "unsafe" });
  const withStringProperty = ["value"];
  Object.assign(withStringProperty, { extra: true });
  const withSymbolProperty = ["value"];
  Object.assign(withSymbolProperty, { [Symbol("extra")]: true });

  const withOutOfRangeNumericProperty = ["value"];
  Object.defineProperty(withOutOfRangeNumericProperty, "4294967295", {
    enumerable: true,
    value: "extra",
  });

  assert.throws(() => canonicalJson(sparse), /cannot be sparse/);
  assert.throws(() => canonicalJson(accessor), /data properties only/);
  assert.throws(() => canonicalJson(withStringProperty), /extra properties/);
  assert.throws(() => canonicalJson(withSymbolProperty), /extra properties/);
  assert.throws(() => canonicalJson(withOutOfRangeNumericProperty), /extra properties/);
});
