"use strict";

function _whenReady(computed, action) {
  if (computed()) {
    action();
  }

  computed.subscribe((ready) => {
    if (ready) {
      action();
    }
  });
}
