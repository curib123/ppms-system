/** Safety regressions for visual editing of existing versioned schemas. */
import assert from "node:assert/strict";
import { FIELD_TYPES, newDefinition, fieldsOf } from "../public/assets/ppms/schema.js";
import {
  builderIndex, builderListId, createBuilderField,
  removalDependents, uniqueFieldKey, validateBuilderDefinition,
} from "../public/assets/ppms/builder-model.js";

const checks = [];
function check(name, action) { action(); checks.push(name); }
const text = (key, extra = {}) => ({ key, label: key, type: "text", ...extra });
const number = (key, extra = {}) => ({ key, label: key, type: "number", ...extra });
const section = (definition, key) => definition.sections.find((item) => item.key === key).items;
const entries = (definition) => section(definition, "main").find((item) => item.key === "entries");
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

check("legal field names cannot replace header, main or summary insertion destinations", () => {
  const definition = newDefinition();
  for (const key of ["header", "main", "summary"])
    section(definition, key).push({ key, label: key, type: "group", fields: [text("value")] });
  validateBuilderDefinition(definition);
  const indexed = builderIndex(definition);
  for (const key of ["header", "main", "summary"]) {
    assert.equal(indexed.lists.get(key).items, section(definition, key));
    assert.equal(indexed.lists.get(key).scope, "");
    const container = indexed.fields.get(key).field;
    assert.equal(indexed.lists.get(builderListId(key)).items, container.fields);
    assert.equal(indexed.lists.get(builderListId(key)).scope, key + ".");
    assert.equal(indexed.fields.get(`${key}.value`).field, container.fields[0]);
    assert.notEqual(indexed.lists.get(key), indexed.lists.get(builderListId(key)));
    assert.equal(createBuilderField(definition, key, "text").type, "text");
    assert.equal(createBuilderField(definition, builderListId(key), "text").type, "text");
  }
  assert.equal(indexed.lists.size, 7, "Every root section and container must retain its own destination");
});

check("new keys are unique across root sections and within each independent parent", () => {
  const definition = newDefinition();
  section(definition, "header").push(text("text"));
  section(definition, "summary").push(text("text2"));
  entries(definition).fields.push(text("text"));
  section(definition, "header").push({ key: "other", label: "Other", type: "group", fields: [text("text2")] });
  const rootKey = uniqueFieldKey(definition, "main", "Text");
  assert.ok(!fieldsOf(definition).some((field) => field.key === rootKey));
  const localKey = uniqueFieldKey(definition, builderListId("entries"), "Text");
  assert.ok(!entries(definition).fields.some((field) => field.key === localKey));
  assert.equal(uniqueFieldKey(definition, builderListId("other"), "Text"), "text",
    "An unrelated parent's key must not force a rename of this field");
  for (const label of ["constructor", "prototype", "__proto__", "123 Batch / notes"])
    assert.match(uniqueFieldKey(definition, "header", label), /^[A-Za-z][A-Za-z0-9_-]*$/);
  for (const label of ["constructor", "prototype", "__proto__"])
    assert.ok(!["constructor", "prototype", "__proto__"].includes(uniqueFieldKey(definition, "header", label)));
});

check("removal guards protect aggregate, whole-container and nested relative dependencies", () => {
  const definition = newDefinition();
  section(definition, "header").push(number("quantity"));
  entries(definition).fields.push(
    text("rowNote", { label: "Row note", requiredWhen: { any: [
      { path: "quantity", operator: "gt", value: 0 },
      { path: "description", operator: "notEmpty" },
    ] } }),
    { key: "details", label: "Details", type: "group", fields: [
      number("quantity"),
      number("copy", { label: "Nested copy", calculation: { path: "quantity" } }),
    ] },
  );
  section(definition, "summary").push(
    number("rowCount", { label: "Row count", calculation: { op: "count", path: "entries" } }),
    text("hasEntries", { label: "Entries note", visibleWhen: { all: [
      { path: "entries", operator: "notEmpty" },
      { path: "productionDate", operator: "notEmpty" },
    ] } }),
    number("adjusted", { label: "Adjusted total", calculation: { op: "add", args: [
      { op: "sum", path: "entries[].quantity" }, { value: 1 },
    ] } }),
  );
  validateBuilderDefinition(definition);
  assert.deepEqual(removalDependents(definition, "entries").sort(),
    ["Adjusted total", "Entries note", "Row count", "Total quantity"].sort());
  assert.deepEqual(removalDependents(definition, "entries[].quantity").sort(),
    ["Adjusted total", "Row note", "Total quantity"].sort());
  assert.deepEqual(removalDependents(definition, "entries[].details.quantity"), ["Nested copy"]);
  assert.deepEqual(removalDependents(definition, "quantity"), [],
    "A relative dependency must resolve locally before an identically named root field");
});

check("existing server-valid 128-character keys remain editable without being renamed", () => {
  const definition = newDefinition();
  const key = "f" + "x".repeat(127);
  section(definition, "header").push(text(key));
  const before = structuredClone(definition);
  validateBuilderDefinition(definition);
  assert.equal(builderIndex(definition).fields.get(key).field.key, key);
  assert.deepEqual(definition, before);
  section(definition, "header").at(-1).key += "x";
  assert.throws(() => validateBuilderDefinition(definition));
});

check("palette defaults are valid and factories never mutate an existing definition", () => {
  const original = newDefinition();
  const source = freeze(structuredClone(original));
  for (const type of [...FIELD_TYPES, "total"]) {
    const destination = type === "total" ? "summary" : ["table", "repeatable"].includes(type) ? "main" : "header";
    const field = createBuilderField(source, destination, type);
    assert.deepEqual(source, original);
    assert.equal(field.type, type === "total" ? "number" : type);
    const candidate = structuredClone(source);
    section(candidate, destination).push(field);
    validateBuilderDefinition(candidate);
    field.label = "Changed draft field";
    assert.deepEqual(source, original);
  }
  for (const unsupported of ["script", "constructor", "__proto__"])
    assert.throws(() => createBuilderField(source, "header", unsupported));
  assert.throws(() => createBuilderField(source, "missing-destination", "text"));
});

for (const [name, corrupt] of [
  ["unsupported field type", (definition) => { entries(definition).fields[0].type = "script"; }],
  ["children hidden on a scalar field", (definition) => { entries(definition).fields[0].fields = [number("hidden")]; }],
  ["container without child fields", (definition) => {
    section(definition, "summary").splice(0);
    delete entries(definition).fields;
  }],
  ["duplicate root keys across sections", (definition) => { section(definition, "summary").push(text("productionDate")); }],
  ["unsupported schema version", (definition) => { definition.schemaVersion = 99; }],
  ["incorrect section order", (definition) => { definition.sections.reverse(); }],
  ["empty main content", (definition) => { section(definition, "main").splice(0); }],
]) check(`malformed schemas are rejected: ${name}`, () => {
  const definition = newDefinition();
  corrupt(definition);
  assert.throws(() => validateBuilderDefinition(definition));
});

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
