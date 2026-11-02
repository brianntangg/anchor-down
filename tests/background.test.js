// Alt+X forwarding, notifications and the toolbar badge (background.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT } = require('./helpers/fake-yes');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const SOURCE = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), 'utf8');

// Runs background.js against a fake chrome API that records every call, with a
// fake clock: advance(ms) moves time and runs its timers.
function loadBackground({ activeTabs = [{ id: 7 }], now = 1_000_000 } = {}) {
  let clock = now;
  const timers = new Map();
  let nextTimer = 1;
  const alarms = new Map();  // name -> when
  // Objects made inside the vm are from another realm, so record plain copies
  // that deepEqual can compare.
  const recorded = [];
  const calls = { push: (call) => recorded.push(JSON.parse(JSON.stringify(call))) };
  const listeners = {};
  // Chrome calls that can fail; each should be given a callback.
  const callbacks = { missing: [] };
  const needsCallback = (name, fn) => (...args) => {
    if (typeof args[args.length - 1] !== 'function') callbacks.missing.push(name);
    return fn(...args);
  };
  const chrome = {
    commands: { onCommand: { addListener: (fn) => { listeners.command = fn; } } },
    alarms: {
      create: needsCallback('alarms.create', (name, info) => {
        alarms.set(name, info.when);
        calls.push(['alarms.create', name, info.when]);
      }),
      getAll: (cb) => cb([...alarms.keys()].map((name) => ({ name }))),
      clear: needsCallback('alarms.clear', (name) => {
        alarms.delete(name);
        calls.push(['alarms.clear', name]);
      }),
      onAlarm: { addListener: (fn) => { listeners.alarm = fn; } },
    },
    runtime: {
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
      getURL: (p) => 'chrome-extension://test/' + p,
      lastError: null,
    },
    tabs: {
      query: (q, cb) => cb(activeTabs),
      sendMessage: needsCallback('tabs.sendMessage', (id, msg, cb) => { calls.push(['tabs.sendMessage', id, msg]); if (typeof cb === 'function') cb(); }),
      get: (id, cb) => cb({ id, windowId: 3 }),
      update: needsCallback('tabs.update', (id, props) => calls.push(['tabs.update', id, props])),
      onRemoved: { addListener: (fn) => { listeners.removed = fn; } },
    },
    windows: { update: needsCallback('windows.update', (id, props) => calls.push(['windows.update', id, props])) },
    notifications: {
      create: needsCallback('notifications.create', (id, opts) => calls.push(['notifications.create', id, opts])),
      clear: needsCallback('notifications.clear', (id) => calls.push(['notifications.clear', id])),
      onClicked: { addListener: (fn) => { listeners.click = fn; } },
    },
    action: {
      setBadgeText: needsCallback('setBadgeText', (opts) => calls.push(['setBadgeText', opts])),
      setBadgeBackgroundColor: needsCallback('setBadgeBackgroundColor', (opts) => calls.push(['setBadgeBackgroundColor', opts])),
    },
  };
  vm.runInNewContext(SOURCE, {
    chrome,
    Date: { now: () => clock },
    setInterval: (fn, ms) => { timers.set(nextTimer, { fn, at: clock + ms, every: ms }); return nextTimer++; },
    clearInterval: (id) => { timers.delete(id); },
  });

  function advance(ms) {
    const end = clock + ms;
    while (clock < end) {
      clock += 50;
      for (const [id, t] of [...timers]) {
        if (t.at > clock || !timers.has(id)) continue;
        t.at += t.every;
        t.fn();
      }
    }
  }

  // Fires any alarms that are due, like Chrome would.
  function fireDueAlarms() {
    for (const [name, when] of [...alarms]) {
      if (when <= clock) {
        alarms.delete(name);
        listeners.alarm({ name });
      }
    }
  }

  return {
    calls: recorded, listeners, callbacks, alarms, advance, fireDueAlarms,
    get now() { return clock; },
    ticksSent: () => recorded.filter((c) => c[0] === 'tabs.sendMessage' && c[2].command === 'tick').length,
  };
}

const fromTab = { tab: { id: 7 } };

test('forwards Alt+X to the active tab', () => {
  const { calls, listeners } = loadBackground();
  listeners.command('toggle-enroll');
  assert.deepEqual(calls, [['tabs.sendMessage', 7, { command: 'toggle-enroll' }]]);
});

test('does nothing on Alt+X when there is no active tab', () => {
  const { calls, listeners } = loadBackground({ activeTabs: [] });
  listeners.command('toggle-enroll');
  assert.deepEqual(calls, []);
});

test('creates a notification tagged with the sending tab, using the bundled icon', () => {
  const { calls, listeners } = loadBackground();
  listeners.message({ type: 'notify', id: 'result', title: 'Done', message: 'Hi', sticky: true }, fromTab);
  const [name, id, opts] = calls[0];
  assert.equal(name, 'notifications.create');
  assert.equal(id, 'result:7');
  assert.equal(opts.title, 'Done');
  assert.equal(opts.requireInteraction, true);
  assert.equal(opts.iconUrl, 'chrome-extension://test/icons/icon128.png');
  assert.ok(fs.existsSync(path.join(ROOT, 'icons/icon128.png')), 'notification icon exists');
});

test('clears a notification for the sending tab', () => {
  const { calls, listeners } = loadBackground();
  listeners.message({ type: 'clear', id: 'hidden' }, fromTab);
  assert.deepEqual(calls, [['notifications.clear', 'hidden:7']]);
});

test('sets the badge text and color on the sending tab only', () => {
  const { calls, listeners } = loadBackground();
  listeners.message({ type: 'badge', text: 'GO', color: '#d97706' }, fromTab);
  assert.deepEqual(calls, [
    ['setBadgeText', { tabId: 7, text: 'GO' }],
    ['setBadgeBackgroundColor', { tabId: 7, color: '#d97706' }],
  ]);
});

test('ignores messages that do not come from a tab', () => {
  const { calls, listeners } = loadBackground();
  listeners.message({ type: 'notify', id: 'x', title: 't', message: 'm' }, {});
  assert.deepEqual(calls, []);
});

test('every Chrome call that can fail is given a callback, so failures never surface as errors', () => {
  const { listeners, callbacks } = loadBackground();
  listeners.command('toggle-enroll');
  listeners.message({ type: 'notify', id: 'a', title: 't', message: 'm' }, fromTab);
  listeners.message({ type: 'clear', id: 'a' }, fromTab);
  listeners.message({ type: 'badge', text: 'GO', color: '#000' }, fromTab);
  listeners.click('a:7');
  listeners.message({ type: 'schedule', target: 2_000_000 }, fromTab);
  listeners.alarm({ name: 'anchorDown:7:2000000' });
  listeners.message({ type: 'unschedule' }, fromTab);
  listeners.removed(7);
  assert.deepEqual(callbacks.missing, [], 'calls without a callback: ' + callbacks.missing.join(', '));
});

test('clicking a notification brings its tab and window to the front', () => {
  const { calls, listeners } = loadBackground();
  listeners.click('result:7');
  assert.deepEqual(calls, [
    ['tabs.update', 7, { active: true }],
    ['windows.update', 3, { focused: true }],
    ['notifications.clear', 'result:7'],
  ]);
});

// ---- Keeping time for the auto-enroll timer ----

test('arming sets an alarm for 20 seconds before, and keeps the tab from being discarded', () => {
  const bg = loadBackground();
  const target = bg.now + 10 * 60 * 1000;
  bg.listeners.message({ type: 'schedule', target }, fromTab);
  assert.deepEqual([...bg.alarms], [['anchorDown:7:' + target, target - 20000]]);
  assert.ok(bg.calls.some((c) => c[0] === 'tabs.update' && c[2].autoDiscardable === false));
  bg.advance(60000);
  assert.equal(bg.ticksSent(), 0, 'no ticks while waiting for the alarm');
});

test('when the alarm fires, it brings the tab forward and ticks every 250ms until the window ends', () => {
  const bg = loadBackground();
  const target = bg.now + 60000;
  bg.listeners.message({ type: 'schedule', target }, fromTab);
  bg.advance(40000);
  bg.fireDueAlarms();
  assert.ok(bg.calls.some((c) => c[0] === 'tabs.update' && c[2].active === true), 'tab activated');
  assert.ok(bg.calls.some((c) => c[0] === 'windows.update' && c[2].focused === true), 'window focused');

  bg.advance(1000);
  assert.equal(bg.ticksSent(), 4, '4 ticks per second');
  bg.advance(60000);
  const total = bg.ticksSent();
  assert.ok(total >= 200 && total <= 206, 'stops about 31s after the time, sent ' + total);
});

test('arming less than 20 seconds ahead starts ticking right away', () => {
  const bg = loadBackground();
  bg.listeners.message({ type: 'schedule', target: bg.now + 10000 }, fromTab);
  assert.equal(bg.alarms.size, 0);
  bg.advance(1000);
  assert.equal(bg.ticksSent(), 4);
});

test('cancelling clears the alarm and stops ticking', () => {
  const bg = loadBackground();
  bg.listeners.message({ type: 'schedule', target: bg.now + 10 * 60 * 1000 }, fromTab);
  bg.listeners.message({ type: 'unschedule' }, fromTab);
  assert.equal(bg.alarms.size, 0);

  bg.listeners.message({ type: 'schedule', target: bg.now + 5000 }, fromTab);
  bg.advance(500);
  bg.listeners.message({ type: 'unschedule' }, fromTab);
  const sent = bg.ticksSent();
  bg.advance(5000);
  assert.equal(bg.ticksSent(), sent, 'no ticks after cancelling');
});

test('re-arming replaces the earlier alarm', () => {
  const bg = loadBackground();
  bg.listeners.message({ type: 'schedule', target: bg.now + 10 * 60 * 1000 }, fromTab);
  const target = bg.now + 20 * 60 * 1000;
  bg.listeners.message({ type: 'schedule', target }, fromTab);
  assert.deepEqual([...bg.alarms.keys()], ['anchorDown:7:' + target]);
});

test('closing the tab clears its alarm', () => {
  const bg = loadBackground();
  bg.listeners.message({ type: 'schedule', target: bg.now + 10 * 60 * 1000 }, fromTab);
  bg.listeners.removed(7);
  assert.equal(bg.alarms.size, 0);
});
