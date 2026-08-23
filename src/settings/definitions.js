"use strict";

const settingsDefinitions = [
    {
      id: "farm",
      label: "Farm",
      defaultValue: true,
      options: [
        { id: "catchWanderers", label: "Catch wanderers", type: "boolean", defaultValue: true },
        { id: "harvestWitheringBerries", label: "Harvest berries before they wither", type: "boolean", defaultValue: true },
      ],
    },
    {
      id: "hatchery",
      label: "Hatchery",
      defaultValue: true,
      options: [
        { id: "hatchReadyEggs", label: "Hatch ready eggs", type: "boolean", defaultValue: true },
        { id: "fillEggSlots", label: "Fill empty egg slots", type: "boolean", defaultValue: true },
      ],
    },
    {
      id: "items",
      label: "Held Items",
      defaultValue: true,
      options: [
        { id: "giveHeldItems", label: "Give held items", type: "boolean", defaultValue: true },
      ],
    },
    {
      id: "quests",
      label: "Quests",
      defaultValue: true,
      options: [
        { id: "claimCompletedQuests", label: "Claim completed quests", type: "boolean", defaultValue: true },
        { id: "startQuests", label: "Start new quests", type: "boolean", defaultValue: true },
      ],
    },
    {
      id: "shop",
      label: "Shop",
      defaultValue: true,
      options: [
        { id: "buyPokeBalls", label: "Buy Poke Balls for achievements", type: "boolean", defaultValue: true },
      ],
    },
    {
      id: "dungeon",
      label: "Dungeon",
      defaultValue: true,
      options: [
        { id: "searchAllChests", label: "Search for all chests", type: "boolean", defaultValue: true },
        { id: "fightAllBattles", label: "Fight all battles", type: "boolean", defaultValue: true },
        { id: "restartUponWin", label: "Restart the dungeon upon win", type: "boolean", defaultValue: true },
        { id: "restartUponLoss", label: "Restart the dungeon upon lost", type: "boolean", defaultValue: true },
      ],
    },
    {
      id: "underground",
      label: "Underground",
      defaultValue: true,
      options: [
        { id: "dig", label: "Dig mines", type: "boolean", defaultValue: true },
        { id: "sellGemPlates", label: "Sell gem plates for quests", type: "boolean", defaultValue: true },
        { id: "sellTreasures", label: "Sell treasures with no item value", type: "boolean", defaultValue: true },
      ],
    },
];
