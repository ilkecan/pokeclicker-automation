"use strict";

function _and(xs) {
  return xs.every(Boolean);
}

function _disposeAll(subscriptions) {
  for (const subscription of subscriptions) {
    subscription.dispose();
  }
  subscriptions.length = 0;
}

function _whenReady(computed, action) {
  return _runAndSubscribe(computed, (ready) => {
    if (ready) {
      action();
    }
  });
}

function _runAndSubscribe(observable, action) {
  action(observable());
  return observable.subscribe(action);
}
