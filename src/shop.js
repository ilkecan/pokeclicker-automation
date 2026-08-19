"use strict";

const automateShop = (() => {
  function synchronizeItemPrice(item) {
    const multiplier = player.itemMultipliers[item.saveName] || 1;
    item.price(Math.round(item.basePrice * multiplier));
  }

  function buyPokeBall(pokeball, targetAmountPerBall, buyingEnabled) {
    const numBallNeeded = ko.pureComputed(() => targetAmountPerBall[pokeball.name] - App.game.statistics.pokeballsObtained[GameConstants.Pokeball[pokeball.name]]());
    if (numBallNeeded() <= 0) {
      return;
    }

    synchronizeItemPrice(pokeball);
    const shouldBuy = ko.pureComputed(() => pokeball.price() == pokeball.basePrice);
    const canBuy = ko.pureComputed(() => App.game.wallet.currencies[pokeball.currency]() >= pokeball.basePrice);
    const ready = ko.pureComputed(() => _and([
      buyingEnabled(),
      numBallNeeded() > 0,
      shouldBuy(),
      canBuy(),
    ]));
    _whenReady(ready, () => {
      const currency = App.game.wallet.currencies[pokeball.currency];
      let remaining = numBallNeeded();

      if (pokeball.multiplier === 1) {
        const affordable = Math.floor(currency() / pokeball.basePrice);
        pokeball.buy(Math.min(affordable, remaining));
        return;
      }

      while (remaining > 0 && pokeball.price() === pokeball.basePrice && currency() >= pokeball.basePrice) {
        pokeball.buy(1);
        remaining--;
      }
    });
  }

  function buyPokeBalls() {
    const buyingEnabled = ko.pureComputed(() => AutomationSettings.getValue("shop", "buyPokeBalls"));
    const achievements = AchievementHandler.achievementList.filter((achievement) => achievement.property.achievementType === GameConstants.AchievementType["Poke Balls"]);
    const achievementsPerBall = Object.groupBy(achievements, (achievement) => GameConstants.Pokeball[achievement.property.pokeball]);
    const targetAmountPerBall = Object.fromEntries(
      Object.entries(achievementsPerBall).map(([ballType, achievements]) => [
        ballType,
        Math.max(...achievements.map((achievement) => achievement.property.requiredValue))
      ])
    );

    const pokeballs = pokeMartShop.items
      .filter((item) => item instanceof PokeballItem)
      .sort((a, b) => b.basePrice - a.basePrice);
    for (const pokeball of pokeballs) {
      buyPokeBall(pokeball, targetAmountPerBall, buyingEnabled);
    }
  }

  function automate() {
    buyPokeBalls();
  }

  return function automateShop() {
    ko.when(() => ShopHandler.shortcutVisible(), automate);
  };
})();
