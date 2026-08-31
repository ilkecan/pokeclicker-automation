// ==UserScript==
// @name        pokeclicker-automation
// @namespace   ilkecan
// @match       https://www.pokeclicker.com/
// @match       pokeclicker://game/index.html
// @match       file:///home/*/.config/pokeclicker-desktop/pokeclicker-master/docs/index.html
// @require     common.js
// @require     dungeon.js
// @require     farm.js
// @require     gym.js
// @require     hatchery.js
// @require     items.js
// @require     quests.js
// @require     shop.js
// @require     underground.js
// @require     settings/definitions.js
// @require     settings/store.js
// @require     settings/ui.js
// @grant       none
// @icon        https://raw.githubusercontent.com/pokeclicker/pokeclicker/develop/src/assets/images/favicon.ico
// @version     0.10.25
// @author      ilkecan
// @description key bindings & automation for various things
// ==/UserScript==

"use strict";

GameLoadState.onLoadState(GameLoadState.states.running, () => {
  AutomationSettings.initialize();
  installAutomationSettingsTab();

  [
    dungeon,
    farm,
    gym,
    hatchery,
    items,
    quests,
    shop,
    underground,
  ].forEach((module) => module.automate());
});
