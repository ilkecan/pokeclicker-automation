"use strict";

const shop = (() => {
  const SETTINGS_SECTION = "shop";
  const ITEM_NAMES = ["Pokeball", "Greatball", "Ultraball"];

  function synchronizeItemPrice(item) {
    const multiplier = player.itemMultipliers[item.saveName] || 1;
    item.price(Math.round(item.basePrice * multiplier));
  }

  function buyItem(item, targetAmount) {
    const numNeeded = ko.pureComputed(() => targetAmount() - item.getBagAmount());
    synchronizeItemPrice(item);
    const shouldBuy = ko.pureComputed(() => item.price() == item.basePrice);
    const canBuy = ko.pureComputed(() => App.game.wallet.currencies[item.currency]() >= item.basePrice);
    const ready = ko.pureComputed(() => _and([
      numNeeded() > 0,
      shouldBuy(),
      canBuy(),
    ]));

    const subscription = _whenReady(ready, () => {
      const currency = App.game.wallet.currencies[item.currency];
      let remaining = numNeeded();

      if (item.multiplier === 1) {
        const affordable = Math.floor(currency() / item.basePrice);
        item.buy(Math.min(affordable, remaining));
        return;
      }

      while (remaining > 0 && item.price() === item.basePrice && currency() >= item.basePrice) {
        item.buy(1);
        remaining--;
      }
    });
    return [subscription];
  }

  function buyItems() {
    const targetByName = new Map(
      ITEM_NAMES.map((itemName) => [
        itemName,
        AutomationSettings.value(SETTINGS_SECTION, `target${itemName}`),
      ]),
    );
    const items = pokeMartShop.items
      .filter((item) => targetByName.has(item.name))
      .sort((a, b) => b.basePrice - a.basePrice);
    return items.flatMap((item) => buyItem(item, targetByName.get(item.name)));
  }

  function automate() {
    _automate(() => _and([
      ShopHandler.shortcutVisible(),
      AutomationSettings.isEnabled(SETTINGS_SECTION),
    ]), [buyItems]);
  };

  return {
    automate,
  }
})();
