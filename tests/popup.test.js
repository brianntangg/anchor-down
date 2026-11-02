// The toolbar popup (popup.html, popup.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { ROOT } = require('./helpers/fake-yes');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const POPUP_HTML = path.join(ROOT, manifest.action.default_popup);
const POPUP_JS = fs.readFileSync(path.join(path.dirname(POPUP_HTML), 'popup.js'), 'utf8');

const ARMED = {
  armed: true, state: 'Armed', color: 'rgb(37, 99, 235)', countdown: 'Opens in 12m 4s',
  status: 'Armed for Mon, Nov 2, 7:00:00 AM CT.', warn: '', cart: 'In your cart (2): CS 3251, MATH 2810',
  login: '✓ Logged in, checked 6:47:10 AM.', note: '', classes: [],
};
const FINISHED = {
  ...ARMED, armed: false, state: 'Partly done', countdown: '', status: '1 of 2 classes went through.',
  classes: [{ text: '✓ CS 3251: enrolled or waitlisted', ok: true }, { text: '✗ MATH 2810: still in your cart', ok: false }],
};

// Opens the popup. armedTab: what background.js says; status: what that tab
// answers (null = not a YES page).
function openPopup({ armedTab = 7, activeTab = 3, status = ARMED } = {}) {
  // Plain copies, since objects made in the popup's realm don't deepEqual Node's.
  const recorded = [];
  const sent = { push: (x) => recorded.push(JSON.parse(JSON.stringify(x))) };
  let closed = false;
  const dom = new JSDOM(fs.readFileSync(POPUP_HTML, 'utf8'), { runScripts: 'outside-only' });
  const w = dom.window;
  w.setInterval = () => 0;  // the test refreshes by hand
  w.close = () => { closed = true; };
  w.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => cb(msg.type === 'armedTab' ? { tabId: armedTab } : undefined),
    },
    tabs: {
      query: (q, cb) => cb([{ id: activeTab }]),
      sendMessage: (id, msg, cb) => {
        sent.push([id, msg.command]);
        if (msg.command === 'status' && !status) {
          w.chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
          cb();
          w.chrome.runtime.lastError = null;
          return;
        }
        cb(msg.command === 'status' ? JSON.parse(JSON.stringify(status)) : undefined);
      },
      get: (id, cb) => cb({ id, windowId: 2 }),
      update: (id, props, cb) => { sent.push(['tabs.update', id, props]); cb(); },
      create: (props, cb) => { sent.push(['tabs.create', props.url]); cb(); },
    },
    windows: { update: (id, props, cb) => { sent.push(['windows.update', id, props]); cb(); } },
  };
  w.eval(POPUP_JS);
  const $ = (id) => w.document.getElementById(id);
  const visibleButtons = () => ['check', 'cancel', 'goto', 'open'].filter((id) => !$(id).hidden);
  return { $, sent: recorded, visibleButtons, closed: () => closed };
}

test('shows the armed tab, from any tab', () => {
  const popup = openPopup();
  assert.equal(popup.$('state').textContent, 'Armed');
  assert.equal(popup.$('countdown').textContent, 'Opens in 12m 4s');
  assert.equal(popup.$('cart').textContent, 'In your cart (2): CS 3251, MATH 2810');
  assert.deepEqual(popup.visibleButtons(), ['check', 'cancel', 'goto']);
  assert.deepEqual(popup.sent[0], [7, 'status'], 'asked the armed tab, not the active one');
});

test('shows per-class results after a run, without Cancel', () => {
  const popup = openPopup({ status: FINISHED });
  const lines = [...popup.$('classes').children].map((li) => [li.className, li.textContent]);
  assert.deepEqual(lines, [
    ['ok', '✓ CS 3251: enrolled or waitlisted'],
    ['bad', '✗ MATH 2810: still in your cart'],
  ]);
  assert.deepEqual(popup.visibleButtons(), ['check', 'goto']);
});

test('with nothing armed, uses the tab it was opened from', () => {
  const popup = openPopup({ armedTab: null, activeTab: 3 });
  assert.deepEqual(popup.sent[0], [3, 'status']);
});

test('offers Open YES when there is no YES tab', () => {
  const popup = openPopup({ armedTab: null, status: null });
  assert.equal(popup.$('state').textContent, 'No YES tab');
  assert.deepEqual(popup.visibleButtons(), ['open']);
  popup.$('open').click();
  assert.deepEqual(popup.sent.at(-1), ['tabs.create', 'https://more.app.vanderbilt.edu/more/SearchClasses!input.action']);
  assert.equal(popup.closed(), true);
});

test('Check and Cancel go to the armed tab', () => {
  const popup = openPopup();
  popup.$('check').click();
  popup.$('cancel').click();
  assert.deepEqual(popup.sent.slice(-2), [[7, 'check'], [7, 'cancel']]);
});

test('Go to YES tab brings it forward and closes the popup', () => {
  const popup = openPopup();
  popup.$('goto').click();
  assert.deepEqual(popup.sent.slice(-2), [
    ['tabs.update', 7, { active: true }],
    ['windows.update', 2, { focused: true }],
  ]);
  assert.equal(popup.closed(), true);
});
