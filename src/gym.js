"use strict";

const gym = (() => {
  const SETTINGS_SECTION = "gym";

  function patchStartGym(fn) {
    GymRunner.startGym = fn;
  }

  function autoRestartGyms() {
    let originalStartGym = null;

    const subscription = _runAndSubscribe(AutomationSettings.value(SETTINGS_SECTION, "autoRestart"), (enabled) => {
      if (enabled) {
        originalStartGym = GymRunner.startGym;

        const fn = function(gym, autoRestart, initialRun) {
          if (arguments.length < 2) {
            autoRestart = gym.clears() > 0;
          }

          return originalStartGym.call(this, gym, autoRestart, initialRun);
        };
        patchStartGym(fn);
      } else {
        if (originalStartGym === null) {
          return;
        }

        GymRunner.autoRestart(false);

        patchStartGym(originalStartGym);
        originalStartGym = null;
      }
    })

    return [
      subscription,
      { dispose() { if (originalStartGym !== null) { patchStartGym(originalStartGym); } } }
    ];
  }

  function automate() {
    _automate(AutomationSettings.enabled(SETTINGS_SECTION), [autoRestartGyms]);
  };

  return {
    automate,
  }
})();
