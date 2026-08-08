// ==UserScript==
// @name        pokeclicker-scripts
// @namespace   ilkecan
// @match       https://www.pokeclicker.com/
// @require     hatchery.js
// @grant       none
// @icon        https://raw.githubusercontent.com/pokeclicker/pokeclicker/develop/src/assets/images/favicon.ico
// @version     0.10.25
// @author      ilkecan
// @description key bindings & automation for various things
// ==/UserScript==

"use strict";

GameLoadState.onLoadState(GameLoadState.states.running, () => {
  automateHatchery();
});
