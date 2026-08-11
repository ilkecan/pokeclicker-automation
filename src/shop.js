"use strict";

function _synchronizeItemPrice(item) {
  const multiplier = player.itemMultipliers[item.saveName] || 1;
  item.price(Math.round(item.basePrice * multiplier));
}

function _calculatePokeballAmount(pokeball, maxAmount) {
  let amount;
  if (pokeball.multiplier === 1) {
    amount = Math.floor(App.game.wallet.currencies[pokeball.currency]() / pokeball.basePrice)
  } else {
    amount = 1;
    while (true) {
      const nextAmount = amount + 1;
      if (pokeball.totalPrice(nextAmount) > nextAmount * pokeball.basePrice) {
        break;
      }
      amount = nextAmount;
    }
  }

  return Math.min(amount, maxAmount);
}

function _buyPokeBall(pokeball, targetAmountPerBall) {
  const numBallNeeded = ko.pureComputed(() => targetAmountPerBall[pokeball.name] - App.game.statistics.pokeballsObtained[GameConstants.Pokeball[pokeball.name]]());
  if (numBallNeeded() <= 0) {
    return;
  }

  _synchronizeItemPrice(pokeball);
  const shouldBuy = ko.pureComputed(() => pokeball.price() == pokeball.basePrice);
  const canBuy = ko.pureComputed(() => App.game.wallet.currencies[pokeball.currency]() >= pokeball.basePrice);
  const ready = ko.pureComputed(() => numBallNeeded() > 0 && shouldBuy() && canBuy());
  _whenReady(ready, () => pokeball.buy(_calculatePokeballAmount(pokeball, numBallNeeded())));
}

function _buyPokeBalls() {
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
    _buyPokeBall(pokeball, targetAmountPerBall);
  }
}

function automateShop() {
  ko.when(ShopHandler.shortcutVisible, _buyPokeBalls);
}
