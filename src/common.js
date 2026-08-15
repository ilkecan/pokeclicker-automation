"use strict";

function _runAndSubscribe(observable, action) {
  action(observable());
  return observable.subscribe(action);
}

function _whenReady(computed, action) {
  return _runAndSubscribe(computed, (ready) => {
    if (ready) {
      action();
    }
  });
}
