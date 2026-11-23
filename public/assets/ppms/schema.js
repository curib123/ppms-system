/** Presentation helpers only. Server validation and calculations remain authoritative. */
export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "integer",
  "boolean",
  "date",
  "time",
  "datetime",
  "select",
  "multiselect",
  "trace-code",
  "table",
  "repeatable",
  "group",
];
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
export function clone(value) {
  return structuredClone(value);
}
export function fieldsOf(definition) {
  return (
    definition.fields ||
    definition.sections?.flatMap((s) => s.items || []) ||
    []
  );
}
export function sectionsOf(definition) {
  if (definition.schemaVersion === 2) return definition.sections;
  const result = [
    { key: "header", label: "Form header", items: [] },
    { key: "main", label: "Main records", items: [] },
    { key: "summary", label: "Summary and totals", items: [] },
  ];
  if (definition.fields) {
    for (const f of definition.fields)
      result[["table", "repeatable"].includes(f.type) ? 1 : 0].items.push(f);
    return result;
  }
  for (const s of definition.sections || []) {
    const key = s.key.toLowerCase();
    const target = /total|summary|bottom|inventory/.test(key)
      ? 2
      : /context|header|identification|top/.test(key)
        ? 0
        : 1;
    result[target].items.push(...(s.items || []));
  }
  return result;
}
export function newDefinition(title = "New production form") {
  return {
    schemaVersion: 2,
    title,
    sections: [
      {
        key: "header",
        label: "Form header",
        items: [
          {
            key: "productionDate",
            label: "Production date",
            type: "date",
            required: true,
          },
        ],
      },
      {
        key: "main",
        label: "Production records",
        items: [
          {
            key: "entries",
            label: "Entries",
            type: "table",
            minRows: 1,
            maxRows: 200,
            fields: [
              {
                key: "description",
                label: "Description",
                type: "text",
                required: true,
              },
              {
                key: "quantity",
                label: "Quantity",
                type: "number",
                required: true,
                validation: { min: 0 },
              },
            ],
          },
        ],
      },
      {
        key: "summary",
        label: "Summary",
        items: [
          {
            key: "totalQuantity",
            label: "Total quantity",
            type: "number",
            calculation: { op: "sum", path: "entries[].quantity" },
          },
        ],
      },
    ],
  };
}
export function asV2(definition) {
  return {
    ...clone(definition),
    schemaVersion: 2,
    sections: sectionsOf(definition).map(clone),
    fields: undefined,
  };
}
export function readPath(data, path) {
  if (!path) return data;
  const parts = path.replaceAll("[]", ".*").split(".");
  const read = (value, index) => {
    if (index === parts.length) return value;
    if (unsafe.has(parts[index])) return undefined;
    if (parts[index] === "*") {
      const results = Array.isArray(value)
        ? value.map((row) => read(row, index + 1))
        : [];
      return parts.slice(index + 1).includes("*") ? results.flat() : results;
    }
    return read(
      value != null && Object.hasOwn(Object(value), parts[index])
        ? value[parts[index]]
        : undefined,
      index + 1,
    );
  };
  return read(data, 0);
}
export function writePath(data, path, value) {
  const parts = path.split(".");
  if (parts.some((p) => unsafe.has(p))) throw new Error("Invalid field path");
  let node = data;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!Object.hasOwn(node, parts[i]) || node[parts[i]] == null)
      node[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    node = node[parts[i]];
  }
  if (value === undefined) delete node[parts.at(-1)];
  else node[parts.at(-1)] = value;
}
export function valuesAt(data, path) {
  const parts = path.replaceAll("[]", ".*").split(".");
  const walk = (value, i) => {
    if (i === parts.length) return [value];
    if (unsafe.has(parts[i])) return [];
    if (parts[i] === "*")
      return Array.isArray(value) ? value.flatMap((v) => walk(v, i + 1)) : [];
    return walk(
      value != null && Object.hasOwn(Object(value), parts[i])
        ? value[parts[i]]
        : undefined,
      i + 1,
    );
  };
  return walk(data, 0).filter((v) => v !== undefined && v !== null && v !== "");
}
export function defaultData(fields) {
  const result = {};
  for (const f of fields) {
    if (Object.hasOwn(f, "defaultValue")) result[f.key] = clone(f.defaultValue);
    else if (f.type === "group") result[f.key] = defaultData(f.fields || []);
    else if (["table", "repeatable"].includes(f.type))
      result[f.key] = Array.from(
        { length: Math.min(f.minRows || 0, 1000) },
        () => defaultData(f.fields || []),
      );
  }
  return result;
}
const firstKey = (path) => String(path || "").split(/[.\[]/)[0];
function scopeFor(path, local, root, scope) {
  let defined = false;
  if (scope)
    walkFields(scope, (_field, p) => {
      if (p === path) defined = true;
    });
  else defined = Object.hasOwn(local, firstKey(path));
  return local === root || defined ? local : root;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function equal(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function condition(rule, local, root, scope) {
  if (!rule) return true;
  if (rule.all)
    return rule.all.every((child) => condition(child, local, root, scope));
  if (rule.any)
    return rule.any.some((child) => condition(child, local, root, scope));
  const v =
    readPath(scopeFor(rule.path, local, root, scope), rule.path) ?? null;
  switch (rule.operator) {
    case "eq":
      return equal(v, rule.value);
    case "ne":
      return !equal(v, rule.value);
    case "gt":
      return (
        typeof v === "number" &&
        typeof rule.value === "number" &&
        v > rule.value
      );
    case "gte":
      return (
        typeof v === "number" &&
        typeof rule.value === "number" &&
        v >= rule.value
      );
    case "lt":
      return (
        typeof v === "number" &&
        typeof rule.value === "number" &&
        v < rule.value
      );
    case "lte":
      return (
        typeof v === "number" &&
        typeof rule.value === "number" &&
        v <= rule.value
      );
    case "in":
      return Array.isArray(rule.value) && rule.value.some((x) => equal(v, x));
    case "notEmpty":
      return (
        v !== undefined &&
        v !== null &&
        v !== "" &&
        (!Array.isArray(v) || v.length > 0)
      );
    default:
      return false;
  }
}
export function calculate(expr, local, root, scope) {
  if (!expr || typeof expr !== "object") return null;
  if (Object.hasOwn(expr, "value")) return expr.value;
  if (expr.path && !expr.op) {
    const v = readPath(scopeFor(expr.path, local, root, scope), expr.path);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  if (["sum", "count", "average", "min", "max"].includes(expr.op)) {
    const raw = readPath(
      scopeFor(expr.path, local, root, scope),
      expr.path || "",
    );
    const source = Array.isArray(raw) ? raw : [raw];
    if (expr.op === "count")
      return source.filter((v) => v !== null && v !== undefined && v !== "")
        .length;
    const values = source.filter(
      (v) => typeof v === "number" && Number.isFinite(v),
    );
    if (!values.length) return expr.op === "sum" ? 0 : null;
    const value =
      expr.op === "sum"
        ? values.reduce((a, b) => a + b, 0)
        : expr.op === "average"
          ? values.reduce((a, b) => a + b, 0) / values.length
          : expr.op === "min"
            ? Math.min(...values)
            : Math.max(...values);
    if (!Number.isFinite(value))
      throw new Error("Calculated value is out of range");
    return value;
  }
  const args = (expr.args || []).map((arg) =>
    calculate(arg, local, root, scope),
  );
  if (args.some((a) => typeof a !== "number" || !Number.isFinite(a)))
    return null;
  const nums = args.map(Number);
  let value;
  switch (expr.op) {
    case "add":
      value = nums.reduce((a, b) => a + b, 0);
      break;
    case "subtract":
      value = nums.slice(1).reduce((a, b) => a - b, nums[0]);
      break;
    case "multiply":
      value = nums.reduce((a, b) => a * b, 1);
      break;
    case "divide":
      value = nums[1] === 0 ? null : nums[0] / nums[1];
      break;
    case "round": {
      const digits = nums[1] ?? 0;
      if (!Number.isInteger(digits) || digits < 0 || digits > 8)
        throw new Error("Invalid round precision");
      const [coefficient, exponent = "0"] = Math.abs(nums[0])
        .toString()
        .split("e");
      const shifted = Number(`${coefficient}e${Number(exponent) + digits}`);
      if (!Number.isFinite(shifted)) {
        value = nums[0];
        break;
      }
      const [rounded, roundExponent = "0"] = Math.round(shifted)
        .toString()
        .split("e");
      value =
        Math.sign(nums[0]) *
        Number(`${rounded}e${Number(roundExponent) - digits}`);
      break;
    }
    default:
      value = null;
  }
  if (value !== null && !Number.isFinite(value))
    throw new Error("Calculated value is out of range");
  return value;
}
export function compileCalculations(definition) {
  const map = new Map(),
    order = [],
    state = new Map();
  const index = (fields, scope = "") => {
    for (const field of fields) {
      const path = scope + field.key;
      map.set(path, { field, scope, fields });
      if (field.fields)
        index(field.fields, path + (field.type === "group" ? "." : "[]."));
    }
  };
  index(fieldsOf(definition));
  const dependencies = (expression, scope, depth = 0) => {
    if (depth > 12) throw new Error("Expression is too deep");
    if (expression?.path) {
      const path =
        scope && map.has(scope + expression.path)
          ? scope + expression.path
          : expression.path;
      if (!map.has(path))
        throw new Error("Calculation field is not defined: " + path);
      return [path];
    }
    return (expression?.args || []).flatMap((arg) =>
      dependencies(arg, scope, depth + 1),
    );
  };
  const visit = (path) => {
    if (state.get(path) === 2) return;
    if (state.get(path) === 1) throw new Error("Calculation cycle: " + path);
    state.set(path, 1);
    const entry = map.get(path);
    for (const dep of dependencies(entry.field.calculation, entry.scope))
      if (map.get(dep)?.field.calculation) visit(dep);
    state.set(path, 2);
    order.push(path);
  };
  for (const [path, entry] of map) if (entry.field.calculation) visit(path);
  return { map, order };
}
export function concretePaths(data, pattern) {
  const start = pattern.indexOf("[]");
  if (start === -1) {
    const dot = pattern.lastIndexOf(".");
    return dot === -1 ||
      (readPath(data, pattern.slice(0, dot)) &&
        typeof readPath(data, pattern.slice(0, dot)) === "object")
      ? [pattern]
      : [];
  }
  const prefix = pattern.slice(0, start),
    rows = readPath(data, prefix);
  return Array.isArray(rows)
    ? rows.flatMap((_row, index) =>
        concretePaths(data, prefix + "." + index + pattern.slice(start + 2)),
      )
    : [];
}
export function recompute(
  definition,
  data,
  compiled = compileCalculations(definition),
) {
  const defaults = (fields, local) => {
    for (const field of fields) {
      if (
        !Object.hasOwn(local, field.key) &&
        Object.hasOwn(field, "defaultValue")
      )
        local[field.key] = clone(field.defaultValue);
      if (
        field.type === "group" &&
        local[field.key] &&
        typeof local[field.key] === "object"
      )
        defaults(field.fields, local[field.key]);
      else if (["table", "repeatable"].includes(field.type))
        for (const row of local[field.key] || []) defaults(field.fields, row);
    }
  };
  defaults(fieldsOf(definition), data);
  for (const pattern of compiled.order) {
    const entry = compiled.map.get(pattern);
    for (const path of concretePaths(data, pattern)) {
      const last = path.lastIndexOf(".");
      const local = last === -1 ? data : readPath(data, path.slice(0, last));
      writePath(
        data,
        path,
        calculate(entry.field.calculation, local, data, entry.fields),
      );
    }
  }
  return data;
}
export function computedData(definition, input) {
  return recompute(definition, clone(input));
}
export function walkFields(fields, visit, prefix = "") {
  for (const f of fields) {
    const path = prefix + f.key;
    visit(f, path);
    if (f.fields)
      walkFields(
        f.fields,
        visit,
        path + (["table", "repeatable"].includes(f.type) ? "[]." : "."),
      );
  }
}
export function issues(definition, data, complete = false) {
  const results = [];
  const check = (fields, local, prefix) => {
    for (const f of fields) {
      if (!condition(f.visibleWhen, local, data, fields)) continue;
      const value =
        local && Object.hasOwn(local, f.key) ? local[f.key] : undefined;
      const path = prefix + f.key;
      const required =
        f.required ||
        (!!f.requiredWhen && condition(f.requiredWhen, local, data, fields));
      const empty =
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && !value.length);
      if (complete && required && empty)
        results.push({ path, message: `${f.label} is required` });
      if (empty) continue;
      if (f.type === "group") {
        check(f.fields || [], value, path + ".");
        continue;
      }
      if (["table", "repeatable"].includes(f.type)) {
        if (complete && value.length < (f.minRows || 0))
          results.push({
            path,
            message: `${f.label} needs at least ${f.minRows} row(s)`,
          });
        value.forEach((row, i) => check(f.fields || [], row, `${path}.${i}.`));
        continue;
      }
      const v = f.validation || {};
      if (
        ["number", "integer"].includes(f.type) &&
        (!Number.isFinite(value) ||
          (f.type === "integer" && !Number.isInteger(value)))
      )
        results.push({ path, message: `${f.label} must be a valid ${f.type}` });
      else if (
        typeof value === "number" &&
        ((v.min !== undefined && value < v.min) ||
          (v.max !== undefined && value > v.max))
      )
        results.push({
          path,
          message: `${f.label} is outside its allowed range`,
        });
      if (
        typeof value === "string" &&
        ((v.maxLength && value.length > v.maxLength) ||
          (v.minLength && value.length < v.minLength))
      )
        results.push({ path, message: `Check the length of ${f.label}` });
    }
  };
  check(fieldsOf(definition), data, "");
  return results;
}
