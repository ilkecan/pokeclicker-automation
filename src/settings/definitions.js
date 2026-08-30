"use strict";

const settingsDefinitions = [
    {
      id: "dungeon",
      label: "Dungeon",
      defaultValue: true,
      options: [
        { id: "fightAllBattles", label: "Fight all battles", type: "boolean", defaultValue: true },
        { id: "openAccessibleChests", label: "Open accessible chests before progressing", type: "boolean", defaultValue: true },
        { id: "restartUponLoss", label: "Restart the dungeon upon lost", type: "boolean", defaultValue: true },
        { id: "restartUponWin", label: "Restart the dungeon upon win", type: "boolean", defaultValue: true },
        { id: "searchAllChests", label: "Search for all chests", type: "boolean", defaultValue: true },
      ],
    },
    {
      id: "farm",
      label: "Farm",
      defaultValue: true,
      options: [
        { id: "catchWanderers", label: "Catch wanderers", type: "boolean", defaultValue: true },
        { id: "harvestWitheringBerries", label: "Harvest berries before they wither", type: "boolean", defaultValue: true },
        { id: "useGooeyMulch", label: "Use Gooey Mulch for priority wanderers", type: "boolean", defaultValue: true },
      ],
    },
    {
      id: "gym",
      label: "Gym",
      defaultValue: true,
      options: [
        { id: "autoRestart", label: "Auto restart gym", type: "boolean", defaultValue: true },
      ],
    },
    {
      id: "hatchery",
      label: "Hatchery",
      defaultValue: true,
      options: [
        { id: "fillEggSlots", label: "Fill empty egg slots", type: "boolean", defaultValue: true },
        { id: "hatchReadyEggs", label: "Hatch ready eggs", type: "boolean", defaultValue: true },
        { id: "manageHelpers", label: "Manage hatchery helpers", type: "boolean", defaultValue: true },
        { id: "spreadPokerus", label: "Prioritize spreading Pokérus", type: "boolean", defaultValue: true },
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
        { id: "targetPokeball", label: "Poke Ball target", type: "nonNegativeInteger", defaultValue: 0 },
        { id: "targetGreatball", label: "Great Ball target", type: "nonNegativeInteger", defaultValue: 0 },
        { id: "targetUltraball", label: "Ultra Ball target", type: "nonNegativeInteger", defaultValue: 0 },
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
