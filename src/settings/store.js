"use strict";

const AutomationSettings = (() => {
  const STORAGE_VERSION = 1;
  const STORAGE_KEY_PREFIX = "pokeclicker-automation";

  const valueValidators = Object.freeze({
    boolean: (value) => typeof value === "boolean",
  });

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validateValue(value, type, path) {
    const validator = valueValidators[type];
    if (!validator) {
      throw new Error(`Unknown value type \`${type}\` for \`${path}\``);
    }
    if (!validator(value)) {
      throw new Error(`Invalid ${type} value for \`${path}\``);
    }
  }

  function createSection(definition) {
    validateValue(definition.defaultValue, "boolean", `${definition.id}.defaultValue`);

    const options = definition.options.map((option) => {
      validateValue(option.defaultValue, option.type, `${definition.id}.${option.id}.defaultValue`);
      return {
        ...option,
        value: ko.observable(option.defaultValue),
      };
    });

    return {
      ...definition,
      enabled: ko.observable(definition.defaultValue),
      options,
      optionsById: new Map(options.map((option) => [option.id, option])),
    };
  }

  const sections = settingsDefinitions.map(createSection);
  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  const defaultSettings = Object.fromEntries(sections.map((section) => [
    section.id,
    Object.fromEntries([
      ["enabled", section.defaultValue],
      ...section.options.map((option) => [option.id, option.defaultValue]),
    ]),
  ]));

  let storageKey;

  function getSection(sectionId) {
    const section = sectionsById.get(sectionId);
    if (!section) {
      throw new Error(`Unknown automation section: ${sectionId}`);
    }
    return section;
  }

  function getOption(section, optionId) {
    const option = section.optionsById.get(optionId);
    if (!option) {
      throw new Error(`Unknown ${section.id} automation option: ${optionId}`);
    }
    return option;
  }

  function isEnabled(sectionId) {
    return getSection(sectionId).enabled();
  }

  function getValue(sectionId, optionId) {
    return getOption(getSection(sectionId), optionId).value();
  }

  function capture() {
    return Object.fromEntries(sections.map((section) => [
      section.id,
      Object.fromEntries([
        ["enabled", section.enabled()],
        ...section.options.map((option) => [option.id, option.value()]),
      ]),
    ]));
  }

  let applying = false;

  function apply(settings) {
    applying = true;
    try {
      for (const [sectionId, newSection] of Object.entries(settings)) {
        const section = sectionsById.get(sectionId);
        if (!section) {
          continue;
        }

        section.enabled(newSection.enabled);

        for (const option of section.options) {
          const { id } = option;
          if (Object.hasOwn(newSection, id)) {
            option.value(newSection[id]);
          }
        }
      }
    } finally {
      applying = false;
    }
  }

  function serialize(settings) {
    return JSON.stringify({
      version: STORAGE_VERSION,
      settings,
    });
  }

  function validateEnvelope(json) {
    if (!isRecord(json)) {
      throw new Error("Stored value is not an object");
    }

    if (json.version !== STORAGE_VERSION) {
      throw new Error(`Unknown storage version: ${json.version}`);
    }
  }

  function validate(settings) {
    if (!isRecord(settings)) {
      throw new Error("Stored settings are not an object");
    }

    for (const [sectionId, storedSection] of Object.entries(settings)) {
      if (!isRecord(storedSection)) {
        throw new Error(`Stored section \`${sectionId}\` is not an object`);
      }
      validateValue(storedSection.enabled, "boolean", `${sectionId}.enabled`);

      const section = sectionsById.get(sectionId);
      if (!section) {
        continue;
      }

      for (const option of section.options) {
        if (Object.hasOwn(storedSection, option.id)) {
          validateValue(storedSection[option.id], option.type, `${sectionId}.${option.id}`);
        }
      }
    }

    return settings;
  }

  function deserialize(text) {
    const json = JSON.parse(text);
    validateEnvelope(json);
    return validate(json.settings);
  }

  function save() {
    if (applying) {
      return;
    }

    try {
      localStorage.setItem(storageKey, serialize(capture()));
    } catch (error) {
      console.error("[pokeclicker-automation] failed to save settings", error);
    }
  }

  function load() {
    try {
      const text = localStorage.getItem(storageKey);
      if (text === null) {
        return;
      }

      apply(deserialize(text));
    } catch (error) {
      console.warn("[pokeclicker-automation] failed to load settings", error);
    }
  }

  function subscribeToChanges() {
    for (const section of sections) {
      section.enabled.subscribe(save);
      for (const option of section.options) {
        option.value.subscribe(save);
      }
    }
  }

  function initialize() {
    storageKey = [STORAGE_KEY_PREFIX, (Save.key || "default")].join(".");

    load();
    subscribeToChanges();
  }

  function reset() {
    apply(defaultSettings);
    save();
  }

  return {
    getValue,
    initialize,
    isEnabled,
    reset,
    sections,
  };
})();
