// Forwards Alt+X to the content script on the active tab.
chrome.commands.onCommand.addListener(function (command) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { command }, ignoreError);
  });
});

// Passed as the callback to Chrome calls that can fail harmlessly, like
// messaging a tab that isn't a YES page or badging a tab that just closed.
// Reading lastError stops Chrome from listing it on the extension's Errors page.
function ignoreError() {
  void chrome.runtime.lastError;
}

// Requests from timer.js (keeping time, notifications, the toolbar badge) and
// from the popup (which tab is armed). Notification ids end in ":<tabId>" so a
// click can bring that YES tab forward.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'armedTab') {
    findArmedTab(function (tabId) { sendResponse({ tabId: tabId }); });
    return true;  // answers asynchronously
  }

  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;

  if (msg.type === 'schedule') {
    schedule(tabId, msg.target);
  } else if (msg.type === 'unschedule') {
    unschedule(tabId);
  } else if (msg.type === 'reload') {
    chrome.tabs.reload(tabId, {}, ignoreError);
  } else if (msg.type === 'notify') {
    showNotification(tabId, msg.id, msg.title, msg.message, msg.sticky);
  } else if (msg.type === 'clear') {
    chrome.notifications.clear(msg.id + ':' + tabId, ignoreError);
  } else if (msg.type === 'badge') {
    chrome.action.setBadgeText({ tabId: tabId, text: msg.text }, ignoreError);
    if (msg.color) chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: msg.color }, ignoreError);
  }
});

// Clicking a notification brings its YES tab and window to the front.
chrome.notifications.onClicked.addListener(function (notificationId) {
  bringToFront(Number(notificationId.split(':').pop()));
  chrome.notifications.clear(notificationId, ignoreError);
});

function showNotification(tabId, id, title, message, sticky) {
  chrome.notifications.create(id + ':' + tabId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: title,
    message: message,
    priority: 2,
    requireInteraction: !!sticky
  }, ignoreError);
}

function bringToFront(tabId) {
  chrome.tabs.get(tabId, function (tab) {
    if (chrome.runtime.lastError || !tab) return;
    chrome.tabs.update(tabId, { active: true }, ignoreError);
    chrome.windows.update(tab.windowId, { focused: true }, ignoreError);
  });
}

// ---- Keeping time for the auto-enroll timer ----
// Chrome slows timers in background tabs but not here, and still delivers
// messages to background tabs right away. An alarm wakes this script 20s before
// the armed time; it brings the YES tab forward (which also wakes a tab Chrome
// froze to save power), then sends the tab a "tick" every 250ms until the
// enroll window ends. Each tick runs the timer in timer.js.

const FRONT_BEFORE_MS = 20000;
const TICK_MS = 250;
const WINDOW_AFTER_MS = 31000;  // a little past timer.js's 30s window
const ALARM_PREFIX = 'anchorDown:';
const MISSED_TICKS_WARNING = 8;  // ~2s of ticks not reaching the page
const tickers = {};             // tabId -> interval id

// Alarm names carry the tab and time, since this script can be restarted
// between arming and the alarm: "anchorDown:<tabId>:<target>".
function alarmName(tabId, target) {
  return ALARM_PREFIX + tabId + ':' + target;
}

function schedule(tabId, target) {
  // A (re)armed page clears any "can't enroll" warning.
  chrome.notifications.clear('cantEnroll:' + tabId, ignoreError);
  // Keep Chrome's Memory Saver from closing the tab while it waits.
  chrome.tabs.update(tabId, { autoDiscardable: false }, ignoreError);
  clearAlarms(tabId, function () {
    stopTicking(tabId);
    if (target - FRONT_BEFORE_MS <= Date.now()) {
      startTicking(tabId, target);
    } else {
      chrome.alarms.create(alarmName(tabId, target), { when: target - FRONT_BEFORE_MS }, function () {
        ignoreError();
        updateKeepAwake();
      });
    }
    updateKeepAwake();
  });
}

function unschedule(tabId) {
  stopTicking(tabId);
  clearAlarms(tabId, updateKeepAwake);
  chrome.tabs.update(tabId, { autoDiscardable: true }, ignoreError);
}

function clearAlarms(tabId, done) {
  chrome.alarms.getAll(function (alarms) {
    const mine = (alarms || []).filter(function (a) { return a.name.indexOf(ALARM_PREFIX + tabId + ':') === 0; });
    let left = mine.length;
    if (!left && done) done();
    mine.forEach(function (a) {
      chrome.alarms.clear(a.name, function () {
        ignoreError();
        if (--left === 0 && done) done();
      });
    });
  });
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name.indexOf(ALARM_PREFIX) !== 0) return;
  const parts = alarm.name.split(':');
  const tabId = Number(parts[1]);
  const target = Number(parts[2]);
  bringToFront(tabId);
  checkTabCanEnroll(tabId);
  startTicking(tabId, target);
});

// The page answers "ping" only if it's the YES class search page; it says
// whether it's armed. No answer usually means YES needed a new login and the
// tab is on the Vanderbilt login page, where the extension doesn't run.
function checkTabCanEnroll(tabId) {
  chrome.tabs.sendMessage(tabId, { command: 'ping' }, function (reply) {
    if (chrome.runtime.lastError || !reply || !reply.armed) warnCantEnroll(tabId);
  });
}

function warnCantEnroll(tabId) {
  showNotification(tabId, 'cantEnroll', "Anchor Down can't enroll",
    "The YES tab isn't on class search, or isn't armed. Log in to YES and open class search now; it keeps trying until the window ends.",
    true);
}

// Each message also counts as activity, which keeps this script running for
// the whole window.
function startTicking(tabId, target) {
  stopTicking(tabId);
  let missed = 0;
  let warned = false;
  tickers[tabId] = setInterval(function () {
    if (Date.now() > target + WINDOW_AFTER_MS) {
      stopTicking(tabId);
      return;
    }
    chrome.tabs.sendMessage(tabId, { command: 'tick' }, function () {
      if (!chrome.runtime.lastError) {
        missed = 0;
        return;
      }
      // The page stopped listening, e.g. it left class search mid-window.
      if (++missed >= MISSED_TICKS_WARNING && !warned) {
        warned = true;
        warnCantEnroll(tabId);
      }
    });
  }, TICK_MS);
}

function stopTicking(tabId) {
  if (!(tabId in tickers)) return;
  clearInterval(tickers[tabId]);
  delete tickers[tabId];
  updateKeepAwake();
}

// ---- Keeping the computer awake ----
// While any tab is armed (an alarm is waiting or ticks are running), ask the
// computer not to sleep. The screen may still turn off or lock; Chrome keeps
// running either way. Worked out from the alarms each time, so it's still
// right if Chrome restarts this script while waiting.

function updateKeepAwake() {
  chrome.alarms.getAll(function (alarms) {
    const waiting = (alarms || []).some(function (a) { return a.name.indexOf(ALARM_PREFIX) === 0; });
    if (waiting || Object.keys(tickers).length > 0) {
      chrome.power.requestKeepAwake('system');
    } else {
      chrome.power.releaseKeepAwake();
    }
  });
}

// On startup (including a restart while waiting), pick up any armed timers.
updateKeepAwake();

// The tab that's ticking, or else the one with an alarm waiting; null if none.
function findArmedTab(done) {
  const ticking = Object.keys(tickers)[0];
  if (ticking) {
    done(Number(ticking));
    return;
  }
  chrome.alarms.getAll(function (alarms) {
    const alarm = (alarms || []).find(function (a) { return a.name.indexOf(ALARM_PREFIX) === 0; });
    done(alarm ? Number(alarm.name.split(':')[1]) : null);
  });
}

chrome.tabs.onRemoved.addListener(function (tabId) {
  unschedule(tabId);
});
