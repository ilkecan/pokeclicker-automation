'use strict';

function createVirtualClock() {
  let now = 0;
  let nextTimerID = 1;
  let timerCallbackCount = 0;
  const timers = [];
  let installedTarget;
  let originalSetTimeout;
  let originalClearTimeout;

  function discardCancelledTimers() {
    while (timers[0]?.cancelled) timers.shift();
  }

  function schedule(callback, delay = 0, ...args) {
    if (typeof callback !== 'function') throw new TypeError('setTimeout callback must be a function');
    const numericDelay = Number(delay);
    const timer = {
      id: nextTimerID++,
      due: now + (Number.isFinite(numericDelay) ? Math.max(numericDelay, 0) : 0),
      callback,
      args,
      cancelled: false,
    };
    timers.push(timer);
    timers.sort((left, right) => left.due - right.due || left.id - right.id);
    return timer.id;
  }

  function cancel(id) {
    const timer = timers.find((candidate) => candidate.id === id);
    if (timer) timer.cancelled = true;
  }

  return {
    get now() {
      return now;
    },

    get timerCallbackCount() {
      return timerCallbackCount;
    },

    get hasPendingTimers() {
      discardCancelledTimers();
      return timers.length > 0;
    },

    installGlobalTimers(target = globalThis) {
      if (installedTarget) throw new Error('virtual clock timers are already installed');
      installedTarget = target;
      originalSetTimeout = target.setTimeout;
      originalClearTimeout = target.clearTimeout;
      target.setTimeout = schedule;
      target.clearTimeout = cancel;
    },

    restoreGlobalTimers() {
      if (!installedTarget) return;
      installedTarget.setTimeout = originalSetTimeout;
      installedTarget.clearTimeout = originalClearTimeout;
      installedTarget = undefined;
    },

    advanceToNext(externalEventAt, externalCallback) {
      if (!Number.isFinite(externalEventAt) || externalEventAt < now) {
        throw new Error(`external event time must be finite and at least ${now}, got ${externalEventAt}`);
      }
      discardCancelledTimers();
      const timer = timers[0];
      if (!timer || externalEventAt <= timer.due) {
        now = externalEventAt;
        externalCallback();
        return { type: 'external', pendingMicrotasks: null };
      }

      timers.shift();
      now = timer.due;
      timerCallbackCount += 1;
      timer.callback(...timer.args);
      return { type: 'timer', pendingMicrotasks: Promise.resolve() };
    },
  };
}

module.exports = { createVirtualClock };
