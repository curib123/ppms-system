/** Cross-runtime semantic regressions. Browser previews must match authoritative PHP calculations. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  calculate,
  computedData,
  condition,
  compileCalculations,
  sectionsOf,
  defaultData,
  fieldsOf,
  readPath,
  writePath,
  issues,
} from "../public/assets/ppms/schema.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const number = (key, calculation) => ({
  key,
  label: key,
  type: "number",
  ...(calculation ? { calculation } : {}),
});
const definition = {
  schemaVersion: 2,
  sections: [
    {
      key: "header",
      items: [
        number("double", {
          op: "multiply",
          args: [{ path: "total" }, { value: 2 }],
        }),
        number("quantity"),
        { key: "state", label: "State", type: "text" },
      ],
    },
    {
      key: "main",
      items: [
        {
          key: "entries",
          label: "Entries",
          type: "table",
          maxRows: 1000,
          fields: [
            number("amount", {
              op: "multiply",
              args: [{ path: "quantity" }, { path: "price" }],
            }),
            number("quantity"),
            number("price"),
          ],
        },
      ],
    },
    {
      key: "summary",
      items: [
        number("total", { op: "sum", path: "entries[].amount" }),
        number("rowCount", { op: "count", path: "entries" }),
        number("average", { op: "average", path: "entries[].quantity" }),
      ],
    },
  ],
};
const cases = [
  {
    definition,
    data: {
      quantity: 500,
      state: "READY",
      entries: [
        { quantity: 2, price: 3 },
        { quantity: 4, price: 5 },
      ],
    },
    conditions: [
      {
        all: [
          { path: "state", operator: "eq", value: "READY" },
          { path: "total", operator: "gt", value: 20 },
        ],
      },
      {
        any: [
          { path: "state", operator: "eq", value: "WAIT" },
          { path: "double", operator: "eq", value: 52 },
        ],
      },
      { path: "average", operator: "eq", value: 3 },
      { path: "average", operator: "eq", value: "3" },
    ],
  },
  {
    definition,
    data: { quantity: 500, entries: [{ price: 9 }, {}] },
    conditions: [{ path: "total", operator: "eq", value: 0 }],
  },
  {
    definition,
    data: { entries: [] },
    conditions: [
      { path: "average", operator: "eq", value: null },
      { path: "entries", operator: "notEmpty" },
    ],
  },
  {
    definition: {
      fields: [
        number("a", { op: "round", args: [{ value: -1.5 }] }),
        number("b", { op: "round", args: [{ value: 9.995 }, { value: 2 }] }),
        number("c", { op: "round", args: [{ value: -9.995 }, { value: 2 }] }),
        number("d", { op: "divide", args: [{ value: 3 }, { value: 0 }] }),
      ],
    },
    data: {},
    conditions: [],
  },
  {
    definition: {
      fields: [
        { key: "code", label: "Code", type: "text", defaultValue: "BASE" },
        number("quantity"),
        {
          key: "rows",
          label: "Rows",
          type: "table",
          fields: [
            {
              key: "details",
              label: "Details",
              type: "group",
              fields: [
                number("quantity"),
                number("copied", { path: "quantity" }),
              ],
            },
          ],
        },
      ],
    },
    data: {
      quantity: 8,
      rows: [{ details: {} }, { details: { quantity: 4 } }],
    },
    conditions: [{ path: "code", operator: "eq", value: "BASE" }],
  },
  {
    definition: {
      fields: [
        {
          key: "tags",
          label: "Tags",
          type: "multiselect",
          options: ["A", "B"],
        },
        number("count", { op: "count", path: "tags" }),
      ],
    },
    data: { tags: ["A", "", null, "B"] },
    conditions: [],
  },
];
cases.push({
  definition: {
    fields: [
      {
        key: "rows",
        label: "Rows",
        type: "table",
        fields: [
          {
            key: "tags",
            label: "Tags",
            type: "multiselect",
            options: ["A", "B"],
          },
        ],
      },
      number("count", { op: "count", path: "rows[].tags" }),
    ],
  },
  data: { rows: [{ tags: ["A", "B"] }] },
  conditions: [],
});
cases.push({
  ...cases.at(-1),
  data: { rows: [{ tags: ["A", "B"] }, { tags: [] }] },
});
const php = spawnSync(
  process.env.PHP_BINARY || "php",
  [
    ...JSON.parse(process.env.PPMS_PHP_ARGS || "[]"),
    resolve(root, "tests/schema_server_bridge.php"),
  ],
  { input: JSON.stringify(cases), encoding: "utf8", cwd: root },
);
assert.equal(php.status, 0, php.stderr || php.stdout);
const expected = JSON.parse(php.stdout);
let passed = 0;
for (let index = 0; index < cases.length; index++) {
  const fixture = cases[index],
    data = computedData(fixture.definition, fixture.data);
  assert.deepEqual(
    data,
    expected[index].data,
    `PHP/JS data parity case ${index + 1}`,
  );
  assert.deepEqual(
    fixture.conditions.map((rule) => condition(rule, data, data)),
    expected[index].conditions,
    `PHP/JS condition parity case ${index + 1}`,
  );
  passed += 2;
}
assert.equal(computedData(definition, cases[0].data).double, 52);
passed++;
assert.equal(computedData(definition, cases[1].data).entries[0].amount, null);
passed++;
assert.equal(
  calculate({ path: "quantity" }, { quantity: "5" }, { quantity: "5" }),
  null,
);
passed++;
assert.equal(
  calculate({ op: "round", args: [{ value: -9.995 }, { value: 2 }] }, {}, {}),
  -10,
);
passed++;
assert.throws(
  () =>
    compileCalculations({
      fields: [number("a", { path: "b" }), number("b", { path: "a" })],
    }),
  /cycle/,
);
passed++;
assert.throws(() => writePath({}, "__proto__.polluted", true), /Invalid/);
assert.equal({}.polluted, undefined);
passed++;
assert.equal(
  readPath({ constructor: { value: 7 } }, "constructor.value"),
  undefined,
);
passed++;
assert.equal(readPath({}, "toString"), undefined);
const inherited = {};
writePath(inherited, "toString.value", 5);
assert.equal(inherited.toString.value, 5);
assert.equal(Object.prototype.toString.value, undefined);
passed++;
assert.throws(
  () =>
    calculate(
      { op: "sum", path: "values" },
      { values: [1e308, 1e308] },
      { values: [1e308, 1e308] },
    ),
  /out of range/,
);
passed++;
const legacy = {
  sections: [
    {
      key: "dailyContext",
      items: [{ key: "operator", label: "Operator", type: "text" }],
    },
    {
      key: "monitoringEntries",
      items: [
        {
          key: "entries",
          label: "Entries",
          type: "repeatable",
          fields: [number("value")],
        },
      ],
    },
    { key: "dailyTotals", items: [number("total")] },
  ],
};
assert.deepEqual(
  sectionsOf(legacy).map((s) => s.items.map((f) => f.key)),
  [["operator"], ["entries"], ["total"]],
);
passed++;
assert.equal(
  issues(
    {
      fields: [
        {
          key: "reason",
          label: "Reason",
          type: "text",
          requiredWhen: {
            all: [
              { path: "state", operator: "eq", value: "HOLD" },
              { path: "quantity", operator: "gt", value: 0 },
            ],
          },
        },
        { key: "state", label: "State", type: "text" },
        number("quantity"),
      ],
    },
    { state: "HOLD", quantity: 1 },
    true,
  )[0].path,
  "reason",
);
passed++;
const large = {
  quantity: 100,
  entries: Array.from({ length: 1000 }, (_, i) => ({
    quantity: i + 1,
    price: 2,
  })),
};
const before = performance.now(),
  largeResult = computedData(definition, large),
  duration = performance.now() - before;
assert.equal(largeResult.total, 1001000);
assert.equal(largeResult.double, 2002000);
assert.equal(largeResult.rowCount, 1000);
passed++;
assert.equal(
  defaultData(
    fieldsOf({
      fields: [
        {
          key: "rows",
          label: "Rows",
          type: "table",
          minRows: 2,
          fields: [
            {
              key: "fixed",
              label: "Fixed",
              type: "text",
              defaultValue: "VALUE",
              readOnly: true,
            },
          ],
        },
      ],
    }),
  ).rows.length,
  2,
);
passed++;
console.log(
  JSON.stringify(
    {
      passed,
      phpParityCases: cases.length,
      largeFormRows: 1000,
      calculationMilliseconds: Math.round(duration * 100) / 100,
    },
    null,
    2,
  ),
);
