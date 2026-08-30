"use strict";

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
}

function installAutomationSettingsTab() {
  const tabId = "settings-automation";

  const settingsModal = document.getElementById("settingsModal");
  const tabs = settingsModal?.querySelector(".modal-body > .nav-tabs");
  const tabContent = settingsModal?.querySelector(".modal-body > .tab-content");
  if (!tabs || !tabContent) {
    console.warn("[pokeclicker-automation] could not find the settings modal tab containers");
    return;
  }

  const tabItem = document.createElement("li");
  tabItem.className = "nav-item";
  tabItem.innerHTML = `<a class="nav-link" href="#${tabId}" data-toggle="tab">Automation</a>`;
  tabs.appendChild(tabItem);

  const tabPane = document.createElement("div");
  tabPane.className = "tab-pane";
  tabPane.id = tabId;
  tabPane.innerHTML = `
    <p class="m-2 text-muted">
      Disabling an automation prevents its next scripted action. It does not undo actions already taken.
    </p>
    <div class="px-2">
      <table class="table table-striped table-hover mb-3">
        <!-- ko foreach: sections -->
        <thead>
          <tr>
            <th class="p-2" data-bind="text: label"></th>
            <th class="p-2 text-center">
              <label class="form-check-label toggler-wrapper style-1 m-auto">
                <input class="clickable" type="checkbox"
                  data-bind="checked: enabled, attr: { id: 'automation-' + id + '-enabled', 'aria-label': label + ' automation enabled' }">
                <div class="toggler-slider">
                  <div class="toggler-knob"></div>
                </div>
              </label>
            </th>
          </tr>
        </thead>
        <tbody data-bind="foreach: options">
          <tr data-bind="css: { 'text-muted': !$parent.enabled() }">
            <td class="p-2 pl-4">
              <label class="m-0" data-bind="text: label, attr: { for: 'automation-' + $parent.id + '-' + id }"></label>
            </td>
            <td class="p-2 text-center">
              <!-- ko if: type === "boolean" -->
              <label class="form-check-label toggler-wrapper style-1 m-auto"
                data-bind="css: { 'checkbox-disabled': !$parent.enabled() }">
                <input class="clickable" type="checkbox"
                  data-bind="checked: value, enable: $parent.enabled, attr: { id: 'automation-' + $parent.id + '-' + id, 'aria-label': label }">
                <div class="toggler-slider">
                  <div class="toggler-knob"></div>
                </div>
              </label>
              <!-- /ko -->
              <!-- ko if: type === "nonNegativeInteger" -->
              <input class="form-control" type="number" min="0" max="${Number.MAX_SAFE_INTEGER}" step="1"
                data-bind="value: value, enable: $parent.enabled, event: { change: function(_, event) { var normalized = normalizeNonNegativeInteger(event.target.value); event.target.value = normalized; value(normalized); } }, attr: { id: 'automation-' + $parent.id + '-' + id, 'aria-label': label }">
              <!-- /ko -->
            </td>
          </tr>
        </tbody>
        <!-- /ko -->
      </table>
    </div>
    <div class="p-2 text-center">
      <button type="button" class="btn btn-warning" data-bind="click: reset">
        Reset Automation Settings
      </button>
    </div>`;
  tabContent.appendChild(tabPane);

  ko.applyBindings(AutomationSettings, tabPane);
}
