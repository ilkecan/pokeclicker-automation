"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("../lib/harness.cjs");
test("number normalization handles every boundary", (t) => {
  const loaded = createHarness(t).loadScripts(["src/settings/ui.js"], {}, "normalizeNonNegativeInteger");
  const cases = [
    ["", 0],
    ["abc", 0],
    [-1, 0],
    ["1.9", 1],
    [Infinity, 0],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ];
  for (const [input, expected] of cases) {
    assert.equal(loaded.value(input), expected);
  }
});

test("integer binding normalizes changes", (t) => {
  let changeHandler;
  const values = [];
  const ko = {
    bindingHandlers: {},
    utils: {
      registerEventHandler: (_element, event, handler) => {
        assert.equal(event, "change");
        changeHandler = handler;
      },
    },
    unwrap: (value) => typeof value === "function" ? value() : value,
  };
  const binding = createHarness(t).loadScripts(
    ["src/settings/ui.js"],
    { ko },
    "ko.bindingHandlers.automationNonNegativeInteger",
  ).value;
  const element = { value: "1.9" };
  const observable = (value) => values.push(value);

  binding.init(element, () => observable);
  changeHandler();

  assert.equal(element.value, 1);
  assert.deepEqual(values, [1]);
  binding.update(element, () => 2);
  assert.equal(element.value, 2);
});

test("settings UI renders number and enum controls", (t) => {
  let pane;
  const tabs = { appendChild() {} };
  const tabContent = { appendChild: (element) => { pane = element; } };
  const settingsModal = {
    querySelector: (selector) => selector.includes("nav-tabs") ? tabs : tabContent,
  };
  const document = {
    getElementById: () => settingsModal,
    createElement: () => ({ className: "", id: "", innerHTML: "" }),
  };
  const context = {
    document,
    AutomationSettings: {
      sections: [{
        id: "test",
        label: "Test",
        enabled: () => true,
        options: [
          { id: "target", label: "Target", type: "nonNegativeInteger", value: () => 0 },
          { id: "mode", label: "Mode", type: "enum", values: ["low", "high"], value: () => "low" },
        ],
      }],
      reset() {},
    },
    ko: {
      bindingHandlers: {},
      utils: { registerEventHandler() {} },
      unwrap: (value) => typeof value === "function" ? value() : value,
      applyBindings() {},
    },
  };
  const loaded = createHarness(t).loadScripts(
    ["src/settings/ui.js"],
    context,
    "installAutomationSettingsTab",
  );
  loaded.value();
  assert.match(pane.innerHTML, /type="number"/);
  assert.match(pane.innerHTML, /<select/);
  assert.match(pane.innerHTML, /min="0"/);
  assert.match(pane.innerHTML, /aria-label': label/);
  assert.match(pane.innerHTML, /automationNonNegativeInteger: value/);
  assert.equal((pane.innerHTML.match(/<!-- ko /g) || []).length, 4);
  assert.equal((pane.innerHTML.match(/<!-- \/ko -->/g) || []).length, 4);
});
