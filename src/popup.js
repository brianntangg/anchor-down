// Toolbar popup: shows the armed YES tab's panel from any tab, with Check,
// Cancel and Go to YES tab. Arming itself stays in the panel, next to the cart.

const YES_URL = 'https://more.app.vanderbilt.edu/more/SearchClasses!input.action';
const REFRESH_MS = 500;

const $ = (id) => document.getElementById(id);
let tabId = null;

// The armed tab if there is one (background.js knows from its alarms),
// otherwise the tab the popup was opened from.
function findTab(done) {
  chrome.runtime.sendMessage({ type: 'armedTab' }, function (reply) {
    void chrome.runtime.lastError;
    if (reply && reply.tabId) {
      done(reply.tabId);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      done(tabs && tabs[0] ? tabs[0].id : null);
    });
  });
}

// Asks the tab for its panel's contents. No answer means it isn't a YES
// class search page.
function refresh() {
  if (!tabId) {
    render(null);
    return;
  }
  chrome.tabs.sendMessage(tabId, { command: 'status' }, function (status) {
    render(chrome.runtime.lastError ? null : status || null);
  });
}

function render(status) {
  if (!status) {
    $('dot').style.background = '';
    $('state').textContent = 'No YES tab';
    $('state').style.color = '';
    $('status').textContent = 'Open YES class search to arm Anchor Down.';
    for (const id of ['countdown', 'warn', 'cart', 'login', 'note', 'classes']) $(id).textContent = '';
    showButtons({ open: true });
    return;
  }
  $('dot').style.background = status.color;
  $('state').textContent = status.state;
  $('state').style.color = status.color;
  for (const id of ['countdown', 'status', 'warn', 'cart', 'login', 'note']) $(id).textContent = status[id];
  $('classes').textContent = '';
  for (const c of status.classes) {
    const li = document.createElement('li');
    li.className = c.ok ? 'ok' : 'bad';
    li.textContent = c.text;
    $('classes').appendChild(li);
  }
  showButtons({ check: true, cancel: status.armed, goto: true });
}

function showButtons(visible) {
  for (const id of ['check', 'cancel', 'goto', 'open']) $(id).hidden = !visible[id];
}

$('check').addEventListener('click', function () {
  chrome.tabs.sendMessage(tabId, { command: 'check' }, ignoreError);
});

$('cancel').addEventListener('click', function () {
  chrome.tabs.sendMessage(tabId, { command: 'cancel' }, ignoreError);
});

$('goto').addEventListener('click', function () {
  chrome.tabs.get(tabId, function (tab) {
    if (chrome.runtime.lastError || !tab) return;
    chrome.tabs.update(tabId, { active: true }, ignoreError);
    chrome.windows.update(tab.windowId, { focused: true }, ignoreError);
    window.close();
  });
});

$('open').addEventListener('click', function () {
  chrome.tabs.create({ url: YES_URL }, ignoreError);
  window.close();
});

function ignoreError() {
  void chrome.runtime.lastError;
}

findTab(function (id) {
  tabId = id;
  refresh();
  setInterval(refresh, REFRESH_MS);
});
