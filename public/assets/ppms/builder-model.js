/** Safe presentation operations. The REST API validates every saved definition. */
import { fieldsOf, compileCalculations } from "./schema.js";

export const FIELD_LABELS = {
  text: "Text", textarea: "Long text", number: "Number", integer: "Whole number",
  boolean: "Checkbox", date: "Date", time: "Time", datetime: "Date and time",
  select: "Dropdown", multiselect: "Multiple choice", "trace-code": "Reference",
  table: "Table", repeatable: "Repeating group", group: "Field group", total: "Column total",
};
export const CONTAINERS = new Set(["table", "repeatable", "group"]);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
export const builderListId = (fieldPath) => `field:${fieldPath}`;

export function builderIndex(definition) {
  const fields = new Map(), lists = new Map();
  const visit = (items, listPath, scope, section, depth, parent = null) => {
    lists.set(listPath, { items, path: listPath, scope, section, depth, parent });
    items.forEach((field, index) => {
      const path = scope + field.key;
      fields.set(path, { field, path, scope, listPath, items, index, section, depth });
      if (field.fields) visit(field.fields, builderListId(path),
        path + (field.type === "group" ? "." : "[]."), section, depth + 1, field);
    });
  };
  for (const section of definition.sections)
    visit(section.items, section.key, "", section.key, 0);
  return { fields, lists };
}

export function uniqueFieldKey(definition, listPath, label) {
  const { lists } = builderIndex(definition), list = lists.get(listPath);
  if (!list) throw new Error("Choose a section or a table first");
  const siblings = list.scope ? list.items : fieldsOf(definition);
  let base = String(label || "field").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+(.)?/g, (_all, next) => next ? next.toUpperCase() : "");
  base = (base[0]?.toLowerCase() || "f") + base.slice(1);
  if (!/^[A-Za-z]/.test(base)) base = "field" + base;
  base = base.slice(0, 55) || "field";
  if (forbidden.has(base)) base = "field" + base[0].toUpperCase() + base.slice(1);
  let key = base, suffix = 2;
  while (siblings.some((field) => field.key === key)) key = base + suffix++;
  return key;
}

export function createBuilderField(definition, listPath, type) {
  const { fields, lists } = builderIndex(definition), list = lists.get(listPath);
  if (!list || !Object.hasOwn(FIELD_LABELS, type)) throw new Error("Choose a valid field and destination");
  if (CONTAINERS.has(type) && list.depth >= 3)
    throw new Error("Add a simple field here, or place the group in a section");
  const label = FIELD_LABELS[type];
  const next = { key: uniqueFieldKey(definition, listPath, label), label, type };
  if (type === "table") Object.assign(next, { label: "Records", minRows: 1, maxRows: 200,
    fields: [{ key: "description", label: "Description", type: "text" },
      { key: "quantity", label: "Quantity", type: "number", validation: { min: 0 } }] });
  if (type === "repeatable" || type === "group") {
    next.fields = [{ key: "value", label: "Value", type: "text" }];
    if (type === "repeatable") Object.assign(next, { minRows: 1, maxRows: 200 });
  }
  if (["select", "multiselect"].includes(type))
    next.options = [{ value: "option1", label: "Option 1" }, { value: "option2", label: "Option 2" }];
  if (type === "total") {
    const source = [...fields.values()].find(({ field, path }) =>
      path.includes("[]") && ["number", "integer"].includes(field.type));
    if (!source) throw new Error("Add a number column to a table before adding its total");
    Object.assign(next, { type: "number", label: `Total ${source.field.label.toLowerCase()}`,
      calculation: { op: "sum", path: source.path } });
  }
  return next;
}

function references(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (typeof value.path === "string") found.push(value.path);
  for (const key of ["args", "all", "any"])
    if (Array.isArray(value[key])) for (const child of value[key]) references(child, found);
  return found;
}
const within = (path, parent) => path === parent || path.startsWith(parent + ".") || path.startsWith(parent + "[].");

export function removalDependents(definition, removedPath) {
  const { fields } = builderIndex(definition), users = [];
  for (const entry of fields.values()) {
    if (within(entry.path, removedPath)) continue;
    const paths = [entry.field.calculation, entry.field.visibleWhen, entry.field.requiredWhen]
      .flatMap((rule) => references(rule));
    if (paths.some((raw) => within(fields.has(entry.scope + raw) ? entry.scope + raw : raw, removedPath)))
      users.push(entry.field.label);
  }
  return [...new Set(users)];
}

export function validateBuilderDefinition(definition) {
  if (!definition || definition.schemaVersion !== 2 || definition.fields !== undefined || !Array.isArray(definition.sections) ||
      definition.sections.map((section) => section?.key).join(",") !== "header,main,summary" ||
      definition.sections.some((section) => !Array.isArray(section.items)))
    throw new Error("Use the header, main records and summary sections in that order");
  if (!String(definition.title || "").trim()) throw new Error("Give the form a title");
  const shape = (fields, depth = 0) => {
    if (depth > 3 || fields.length > 200)
      throw new Error("Use at most 200 fields per group and four levels of fields");
    for (const field of fields) {
      if (!field || typeof field !== "object" || !Object.hasOwn(FIELD_LABELS, field.type) || field.type === "total")
        throw new Error("Choose a supported field type");
      if (CONTAINERS.has(field.type)) {
        if (!Array.isArray(field.fields) || !field.fields.length)
          throw new Error(`${field.label}: a table or group needs at least one field`);
        shape(field.fields, depth + 1);
      } else if (Object.hasOwn(field, "fields"))
        throw new Error(`${field.label}: only tables and groups can contain fields`);
    }
  };
  shape(fieldsOf(definition));
  const { lists, fields } = builderIndex(definition);
  if (!fields.size) throw new Error("Add at least one field");
  if (!definition.sections.find((section) => section.key === "main")?.items.length)
    throw new Error("Keep at least one field in the main records section");
  const roots = fieldsOf(definition);
  for (const list of lists.values()) {
    const siblings = list.scope ? list.items : roots, seen = new Set();
    if (siblings.length > 200 || list.depth > 3)
      throw new Error("Use at most 200 fields per group and four levels of fields");
    for (const field of siblings) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(field.key) || forbidden.has(field.key))
        throw new Error("Use a valid stable field key");
      if (seen.has(field.key)) throw new Error("Field keys must be unique within their group");
      seen.add(field.key);
      if (!String(field.label || "").trim()) throw new Error("Every field needs a label");
      if (field.fields && !CONTAINERS.has(field.type))
        throw new Error(`${field.label}: only tables and groups can contain fields`);
      if (field.fields && !field.fields.length) throw new Error(`${field.label} needs at least one field`);
      if (field.minRows > field.maxRows) throw new Error(`${field.label}: minimum rows cannot exceed maximum rows`);
      if (field.validation?.min > field.validation?.max) throw new Error(`${field.label}: minimum cannot exceed maximum`);
      if (field.validation?.step !== undefined && field.validation.step <= 0)
        throw new Error(`${field.label}: step must be greater than zero`);
    }
  }
  compileCalculations(definition);
  for (const entry of fields.values())
    for (const raw of [entry.field.visibleWhen, entry.field.requiredWhen].flatMap((rule) => references(rule)))
      if (!fields.has(raw) && !fields.has(entry.scope + raw))
        throw new Error(`${entry.field.label}: choose an existing field for the condition`);
}
