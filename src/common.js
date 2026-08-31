"use strict";

function _and(xs) {
  return xs.every(Boolean);
}

function _automate(gate, actions) {
  const gateObservable = ko.pureComputed(gate);
  let subscriptions = [];
  _runAndSubscribe(gateObservable, (enabled) => {
    _disposeAll(subscriptions);

    if (enabled) {
      for (const action of actions) {
        subscriptions.push(...action());
      }
    }
  });
}

function _disposeAll(subscriptions) {
  for (const subscription of subscriptions) {
    subscription?.dispose();
  }
  subscriptions.length = 0;
}

function _or(xs) {
  return xs.some(Boolean);
}

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
