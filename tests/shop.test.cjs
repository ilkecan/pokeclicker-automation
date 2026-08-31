"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./lib/harness.cjs");

const constantsHarness = createHarness();
const { ko } = constantsHarness.game;

function loadShop(t, {
  targets = {},
  enabled = true,
  balls = [],
  currency = 100000,
  itemMultipliers = {},
} = {}) {
  const values = {
    targetPokeball: ko.observable(targets.Pokeball ?? 0),
    targetGreatball: ko.observable(targets.Greatball ?? 0),
    targetUltraball: ko.observable(targets.Ultraball ?? 0),
  };
  const sectionEnabled = ko.observable(enabled);
  const settings = {
    sections: [{
      id: "shop",
      options: [
        { id: "targetPokeball", type: "nonNegativeInteger", value: values.targetPokeball },
        { id: "targetGreatball", type: "nonNegativeInteger", value: values.targetGreatball },
        { id: "targetUltraball", type: "nonNegativeInteger", value: values.targetUltraball },
      ],
    }],
    value: (_section, id) => values[id],
    getValue: (_section, id) => values[id](),
    isEnabled: () => sectionEnabled(),
  };
  const money = ko.observable(currency);
  const itemsByName = new Map();

  const makeBall = ({ name, basePrice, multiplier = 1, bag = 0 }) => {
    const item = {};
    const bagChanged = ko.observable(0);
    let bagAmount = bag;
    item.name = name;
    item.basePrice = basePrice;
    item.multiplier = multiplier;
    item.currency = "money";
    item.saveName = name;
    item.price = ko.observable(basePrice);
    item.getBagAmount = () => {
      bagChanged();
      return bagAmount;
    };
    item.setBagAmount = (next) => {
      bagAmount = next;
      bagChanged(bagChanged() + 1);
    };
    item.buys = [];
    item.buy = (amount) => {
      item.buys.push(amount);
      item.setBagAmount(item.getBagAmount() + amount);
      money(money() - amount * item.price());
      if (item.multiplier !== 1) {
        item.price(Math.round(item.basePrice * item.multiplier));
      }
    };
    itemsByName.set(name, item);
    return item;
  };

  const context = {
    AutomationSettings: settings,
    pokeMartShop: { items: balls.map(makeBall) },
    player: { itemMultipliers },
    App: { game: { wallet: { currencies: { money } } } },
    ShopHandler: { shortcutVisible: () => true },
  };
  const loaded = createHarness(t).loadAutomation("shop", context);
  return {
    shop: loaded.automation,
    values,
    balls: itemsByName,
    money,
    sectionEnabled,
  };
}

function standardBalls() {
  return [
    { name: "Pokeball", basePrice: 10, multiplier: 1, bag: 0 },
    { name: "Greatball", basePrice: 100, multiplier: 1.2, bag: 0 },
    { name: "Ultraball", basePrice: 1000, multiplier: 1.2, bag: 0 },
  ];
}

test("maps each ball to its configured target and buys only deficits", (t) => {
  const state = loadShop(t, {
    targets: { Pokeball: 100, Greatball: 2, Ultraball: 1 },
    balls: standardBalls(),
  });
  state.shop.automate();
  assert.equal(state.balls.get("Pokeball").getBagAmount(), 100);
  assert.equal(state.balls.get("Greatball").getBagAmount(), 1);
  assert.equal(state.balls.get("Ultraball").getBagAmount(), 1);
  assert.deepEqual(state.balls.get("Greatball").buys, [1]);
});

test("zero, equal, and above targets do not buy", (t) => {
  const state = loadShop(t, {
    targets: { Pokeball: 0, Greatball: 2, Ultraball: 5 },
    balls: [
      { name: "Pokeball", basePrice: 10, bag: 4 },
      { name: "Greatball", basePrice: 100, multiplier: 1, bag: 2 },
      { name: "Ultraball", basePrice: 1000, multiplier: 1, bag: 8 },
    ],
  });
  state.shop.automate();
  assert.deepEqual(state.balls.get("Pokeball").buys, []);
  assert.deepEqual(state.balls.get("Greatball").buys, []);
  assert.deepEqual(state.balls.get("Ultraball").buys, []);
});
test("the shop section gate disables all item purchases", (t) => {
  const state = loadShop(t, {
    enabled: false,
    targets: { Pokeball: 1, Greatball: 1, Ultraball: 1 },
    balls: standardBalls(),
  });
  state.shop.automate();
  for (const item of state.balls.values()) {
    assert.deepEqual(item.buys, []);
  }
});
test("disabling the section disposes item subscriptions", (t) => {
  const state = loadShop(t, {
    targets: { Pokeball: 1 },
    balls: [{ name: "Pokeball", basePrice: 10, bag: 0 }],
  });
  state.shop.automate();
  assert.deepEqual(state.balls.get("Pokeball").buys, [1]);

  state.sectionEnabled(false);
  ko.tasks.runEarly();
  state.balls.get("Pokeball").setBagAmount(0);
  ko.tasks.runEarly();
  assert.deepEqual(state.balls.get("Pokeball").buys, [1]);

  state.sectionEnabled(true);
  ko.tasks.runEarly();
  assert.deepEqual(state.balls.get("Pokeball").buys, [1, 1]);
});

test("target edits and later consumption reactivate readiness", (t) => {
  const state = loadShop(t, {
    targets: { Pokeball: 0 },
    balls: [{ name: "Pokeball", basePrice: 10, bag: 0 }],
  });
  state.shop.automate();
  assert.deepEqual(state.balls.get("Pokeball").buys, []);
  state.values.targetPokeball(2);
  ko.tasks.runEarly();
  assert.deepEqual(state.balls.get("Pokeball").buys, [2]);
  state.balls.get("Pokeball").setBagAmount(1);
  ko.tasks.runEarly();
  state.shop.automate();
  assert.deepEqual(state.balls.get("Pokeball").buys, [2, 1]);
});

test("price and affordability gates remain active", (t) => {
  const expensive = loadShop(t, {
    targets: { Pokeball: 1 },
    currency: 9,
    balls: [{ name: "Pokeball", basePrice: 10, bag: 0 }],
  });
  expensive.shop.automate();
  assert.deepEqual(expensive.balls.get("Pokeball").buys, []);

  const priced = loadShop(t, {
    targets: { Pokeball: 1 },
    itemMultipliers: { Pokeball: 2 },
    balls: [{ name: "Pokeball", basePrice: 10, bag: 0 }],
  });
  priced.shop.automate();
  assert.deepEqual(priced.balls.get("Pokeball").buys, []);
});

test("normal balls use bulk affordability while multiplier balls buy one at a time", (t) => {
  const state = loadShop(t, {
    targets: { Pokeball: 20, Greatball: 3 },
    currency: 70,
    balls: [
      { name: "Pokeball", basePrice: 10, multiplier: 1, bag: 0 },
      { name: "Greatball", basePrice: 20, multiplier: 2, bag: 0 },
    ],
  });
  state.shop.automate();
  assert.deepEqual(state.balls.get("Pokeball").buys, [5]);
  assert.deepEqual(state.balls.get("Greatball").buys, [1]);
});
