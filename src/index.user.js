// ==UserScript==
// @name        pokeclicker-automation
// @namespace   ilkecan
// @match       https://www.pokeclicker.com/
// @match       pokeclicker://game/index.html
// @match       file:///home/*/.config/pokeclicker-desktop/pokeclicker-master/docs/index.html
// @require     lib.js
// @require     automation/dungeon.js
// @require     automation/farm.js
// @require     automation/gym.js
// @require     automation/hatchery.js
// @require     automation/items.js
// @require     automation/purify-chamber.js
// @require     automation/quests.js
// @require     automation/safari.js
// @require     automation/shop.js
// @require     automation/underground.js
// @require     settings/definitions.js
// @require     settings/store.js
// @require     settings/ui.js
// @grant       none
// @icon        https://raw.githubusercontent.com/pokeclicker/pokeclicker/develop/src/assets/images/favicon.ico
// @version     0.10.26
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
    purifyChamber,
    quests,
    safari,
    shop,
    underground,
  ].forEach((module) => module.automate());
});
