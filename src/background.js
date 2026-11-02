// Forwards Alt+X to the content script on the active tab.
chrome.commands.onCommand.addListener(function (command) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { command }, ignoreError);
  });
});

// Passed as the callback to Chrome calls that can fail harmlessly, like
// messaging a tab that isn't a YES page. Reading lastError stops Chrome from
// listing it on the extension's Errors page.
function ignoreError() {
  void chrome.runtime.lastError;
}
