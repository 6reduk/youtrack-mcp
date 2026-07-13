import assert from "node:assert/strict";
import { test } from "node:test";

import { getProjectSchema } from "../../../src/application/reads/get-project-schema.js";
import type { FieldDefinition } from "../../../src/domain/project-schema.js";
import { FIELD_A, FakeGateway, PROJECT_A, createReadContext } from "./fakes.js";

const PROBE_FIELD: FieldDefinition = {
  ...FIELD_A,
  id: "probe-field-id",
  name: "Probe-only field",
  valuesComplete: false,
  provenance: ["probe_issue"],
};

void test("returns a complete admin schema without inventing a probe", async () => {
  const gateway = new FakeGateway();
  gateway.probeSchema = {
    source: { kind: "probe_issue", outcome: "partial" },
    schemaComplete: false,
    fields: [PROBE_FIELD],
    issueId: "unused-probe",
    projectId: PROJECT_A.id,
  };
  const result = await getProjectSchema(createReadContext(gateway), {
    project: { id: PROJECT_A.id },
    probeIssue: { id: "unused-probe" },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.data?.schemaComplete, true);
  assert.deepEqual(result.data.sources, [{ kind: "admin_project_fields", outcome: "ok" }]);
  assert.deepEqual(result.warnings, []);
  assert.equal(gateway.probeSchemaCalls, 0);
});

void test("merges an explicit same-project probe conservatively", async () => {
  const gateway = new FakeGateway();
  gateway.adminSchema = {
    source: { kind: "admin_project_fields", outcome: "partial" },
    schemaComplete: false,
    fields: [FIELD_A],
  };
  gateway.probeSchema = {
    source: { kind: "probe_issue", outcome: "partial" },
    schemaComplete: false,
    fields: [PROBE_FIELD],
    issueId: "probe-issue-id",
    projectId: PROJECT_A.id,
  };

  const result = await getProjectSchema(createReadContext(gateway), {
    project: { shortName: PROJECT_A.shortName },
    probeIssue: { id: "probe-issue-id" },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.data?.schemaComplete, false);
  assert.equal(result.data.fields.length, 2);
  assert.deepEqual(
    result.warnings.map((warning) => warning.kind),
    ["probe_schema_incomplete", "schema_incomplete"],
  );
});

void test("rejects missing or cross-project probe issues", async () => {
  const gateway = new FakeGateway();
  gateway.adminSchema = {
    source: { kind: "admin_project_fields", outcome: "partial" },
    schemaComplete: false,
    fields: [FIELD_A],
  };
  const missing = await getProjectSchema(createReadContext(gateway), {
    project: { id: PROJECT_A.id },
    probeIssue: { id: "missing-probe" },
  });
  assert.equal(missing.status, "not_found");

  gateway.probeSchema = {
    source: { kind: "probe_issue", outcome: "partial" },
    schemaComplete: false,
    fields: [],
    issueId: "other-probe",
    projectId: "other-project-id",
  };
  const mismatch = await getProjectSchema(createReadContext(gateway), {
    project: { id: PROJECT_A.id },
    probeIssue: { id: "other-probe" },
  });
  assert.equal(mismatch.status, "invalid");
  assert.equal(mismatch.error?.kind, "probe_project_mismatch");
});

void test("marks deliberately omitted allowed values as incomplete", async () => {
  const result = await getProjectSchema(createReadContext(), {
    project: { id: PROJECT_A.id },
    includeAllowedValues: false,
  });
  assert.equal(result.data?.fields[0]?.valuesComplete, false);
  assert.deepEqual(result.data.fields[0].allowedValues, []);
  assert.equal(result.warnings[0]?.kind, "allowed_values_omitted");
});
