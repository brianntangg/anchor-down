// The auto-enroll timer and panel (timer.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { openYesPage, targetIn } = require('./helpers/fake-yes');

const CS = { course: 'CS 3251', number: '1111' };
const MATH = { course: 'MATH 2810', number: '2222' };
const ECON = { course: 'ECON 1010', number: '3333' };
const FULL_CART = [CS, MATH, ECON];

// A YES where, once an enroll request is sent at or after `openAt`, the cart
// becomes `cartAfter` and the hours become `hoursAfter`.
function enrollsAt(openAt, cartAfter, hoursAfter) {
  const went = (ctx) => ctx.enrollsAfter(openAt) > 0;
  return {
    cart: (ctx) => (went(ctx) ? cartAfter : FULL_CART),
    hours: (ctx) => (went(ctx) ? hoursAfter : { enrolled: 0, saved: 13, waitlisted: 0 }),
  };
}

const NOTHING = { enrolled: 0, saved: 13, waitlisted: 0 };

function resultLines(page) {
  return [...page.$('anchorDownClasses').children].map((li) => li.textContent);
}

// A target `seconds` from now, plus a matching start time for openYesPage.
function schedule(seconds) {
  const now = Date.now();
  return { now, target: Math.ceil((now + seconds * 1000) / 1000) * 1000 };
}

// Enroll request times, in seconds relative to `target`.
function attemptOffsets(page, target) {
  return page.enrollRequests().map((r) => (r.time - target) / 1000);
}

test('the panel loads not armed, defaulting to 7:00 AM today', () => {
  const page = openYesPage();
  assert.equal(page.stateLabel(), 'Not armed');
  assert.match(page.$('anchorDownTime').value, /T07:00(:00)?$/);
  page.close();
});

test('refuses a time that is too soon or already passed', () => {
  const page = openYesPage();
  page.arm(page.now + 3000);
  assert.match(page.status(), /too soon or already passed/);
  assert.equal(page.$('anchorDownArm').textContent, 'Arm');
  page.close();
});

test('counts down, then fires every 2 seconds starting 5 seconds early', async () => {
  const page = openYesPage({ hours: () => NOTHING });
  const target = targetIn(page, 120);
  page.arm(target);

  assert.equal(page.stateLabel(), 'Armed');
  assert.match(page.$('anchorDownCountdown').textContent, /^Opens in 2m/);
  assert.match(page.window.document.title, /^⏳ 2:0\d · YES$/);
  assert.equal(page.enrollRequests().length, 0);

  await page.advance(target - page.now + 31000);
  const offsets = attemptOffsets(page, target);
  assert.ok(offsets[0] >= -5 && offsets[0] < -4.5, 'first attempt about 5s early, got ' + offsets[0]);
  for (let i = 1; i < offsets.length; i++) {
    const gap = offsets[i] - offsets[i - 1];
    assert.ok(gap > 2 && gap < 2.3, 'gap between attempts was ' + gap);
  }
  assert.ok(offsets[offsets.length - 1] < 30, 'stops by 30s after');
  page.close();
});

test('stops early and lists every class once the whole cart has gone through', async () => {
  const { now, target } = schedule(30);
  const page = openYesPage({ now, ...enrollsAt(target, [], { enrolled: 10, saved: 0, waitlisted: 3 }) });
  page.arm(target);
  await page.advance(target - page.now + 31000);

  assert.ok(page.enrollRequests().length <= 6, 'stopped early, sent ' + page.enrollRequests().length);
  assert.equal(page.stateLabel(), 'Success');
  assert.match(page.status(), /^Success! Your cart is empty, so it stopped after \d+ attempts\. All 3 classes went through\./);
  assert.deepEqual(resultLines(page), [
    '✓ CS 3251: enrolled or waitlisted',
    '✓ MATH 2810: enrolled or waitlisted',
    '✓ ECON 1010: enrolled or waitlisted',
  ]);
  assert.equal(page.badges().at(-1), '✓');
  assert.match(page.window.document.title, /^✅ Anchor Down finished/);
  const result = page.notifications().at(-1);
  assert.equal(result.id, 'result');
  assert.equal(result.sticky, true);
  page.close();
});

test('names the classes still in the cart and keeps retrying for them', async () => {
  const { now, target } = schedule(30);
  const page = openYesPage({ now, ...enrollsAt(target, [ECON], { enrolled: 7, saved: 3, waitlisted: 3 }) });
  page.arm(target);
  await page.advance(target - page.now + 31000);

  assert.ok(attemptOffsets(page, target).at(-1) > 27, 'kept going to the end of the window');
  assert.equal(page.stateLabel(), 'Partly done');
  assert.match(page.status(), /^2 of 3 classes went through\. Still in your cart: ECON 1010\. Enroll that one manually now\./);
  assert.deepEqual(resultLines(page), [
    '✓ CS 3251: enrolled or waitlisted',
    '✓ MATH 2810: enrolled or waitlisted',
    '✗ ECON 1010: still in your cart',
  ]);
  assert.equal(page.badges().at(-1), '!');
  assert.match(page.notifications().at(-1).message, /ECON 1010/);
  page.close();
});

test('reports No change when nothing leaves the cart', async () => {
  const page = openYesPage({ cart: FULL_CART, hours: () => NOTHING });
  const target = targetIn(page, 30);
  page.arm(target);
  await page.advance(target - page.now + 31000);

  assert.equal(page.stateLabel(), 'No change');
  assert.match(page.status(), /^No change\. Nothing left your cart\. .* Enroll manually now\.$/);
  assert.equal(resultLines(page).length, 3);
  assert.equal(page.badges().at(-1), '!');
  page.close();
});

test('falls back to hours if they go up but the cart never changes', async () => {
  const { now, target } = schedule(30);
  const page = openYesPage({ now, ...enrollsAt(target, FULL_CART, { enrolled: 10, saved: 13, waitlisted: 0 }) });
  page.arm(target);
  await page.advance(target - page.now + 31000);

  assert.equal(page.stateLabel(), 'Success');
  assert.match(page.status(), /Your cart didn't change, so I can't tell which classes\./);
  assert.equal(page.$('anchorDownClasses').hidden, true);
  page.close();
});

test('lists the class when YES drops the cart section after the last class goes through', async () => {
  // What happened on the real portal: one class, cart page loses its cart section once empty.
  const { now, target } = schedule(30);
  const page = openYesPage({ now, ...enrollsAt(target, [], { enrolled: 15, saved: 0, waitlisted: 0 }) });
  page.arm(target);
  await page.advance(target - page.now + 31000);

  assert.equal(page.stateLabel(), 'Success');
  assert.match(page.status(), /All 3 classes went through/);
  assert.doesNotMatch(page.status(), /can't tell which classes/);
  assert.equal(resultLines(page).length, 3);
  page.close();
});

test('says the cart could not be read afterward, rather than that it did not change', async () => {
  const { now, target } = schedule(30);
  const page = openYesPage({ now, ...enrollsAt(target, FULL_CART, { enrolled: 15, saved: 13, waitlisted: 0 }) });
  page.arm(target);
  await page.advance(target - page.now + 1000);
  const realFetch = page.window.fetch;
  page.window.fetch = (url) => (url.includes('getSavedClasses')
    ? Promise.resolve({ ok: true, status: 200, text: async () => '<html>error</html>' })
    : realFetch(url));
  await page.advance(31000);

  assert.match(page.status(), /I couldn't read your cart afterward, so I can't tell which classes\./);
  page.close();
});

test('lists the cart when armed', async () => {
  const page = openYesPage({ cart: FULL_CART });
  page.arm(targetIn(page, 120));
  await page.advance(100);
  assert.equal(page.$('anchorDownCart').textContent, 'In your cart (3): CS 3251, MATH 2810, ECON 1010');
  assert.equal(page.$('anchorDownWarn').textContent, '');
  page.close();
});

test('warns when armed with an empty cart', async () => {
  const page = openYesPage({ cart: [], hours: () => ({ enrolled: 0, saved: 0, waitlisted: 0 }) });
  page.arm(targetIn(page, 120));
  await page.advance(100);
  assert.match(page.$('anchorDownWarn').textContent, /^Your cart is empty/);
  assert.equal(page.stateLabel(), 'Armed', 'still armed, in case classes are added later');
  page.close();
});

test('warns about two sections of the same course', async () => {
  const page = openYesPage({ cart: [CS, { course: 'CS 3251', number: '1112' }, MATH] });
  page.arm(targetIn(page, 120));
  await page.advance(100);
  assert.match(page.$('anchorDownWarn').textContent, /^More than one section of CS 3251 is in your cart/);
  page.close();
});

test('warns when logged in but the cart cannot be read', async () => {
  const page = openYesPage();  // 3 saved hours, so the cart isn't just empty
  const realFetch = page.window.fetch;
  page.window.fetch = (url) => (url.includes('getSavedClasses')
    ? Promise.resolve({ ok: true, status: 200, text: async () => '<html>error</html>' })
    : realFetch(url));
  page.arm(targetIn(page, 120));
  await page.advance(100);
  assert.match(page.$('anchorDownWarn').textContent, /^Couldn't read your cart/);
  page.close();
});

test('shows only the login warning when logged out', async () => {
  const page = openYesPage({ loggedIn: () => false });
  page.window.fetch = async (url) => (url.includes('getSavedClasses')
    ? { ok: true, status: 200, text: async () => '<html>Please log in</html>' }
    : { ok: true, status: 200, json: async () => { throw new Error('not JSON'); } });
  page.arm(targetIn(page, 120));
  await page.advance(100);
  assert.match(page.$('anchorDownNote').textContent, /login may have expired/);
  assert.equal(page.$('anchorDownWarn').textContent, '');
  page.close();
});

test('reads the picker as Central time, whatever the laptop time zone', () => {
  const page = openYesPage();
  page.$('anchorDownTime').value = '2030-01-15T07:00:00';  // CST, UTC-6
  page.$('anchorDownArm').click();
  assert.equal(page.session().anchorDownTarget, String(Date.UTC(2030, 0, 15, 13, 0, 0)));
  page.$('anchorDownArm').click();

  page.$('anchorDownTime').value = '2030-07-15T07:00:00';  // CDT, UTC-5
  page.$('anchorDownArm').click();
  assert.equal(page.session().anchorDownTarget, String(Date.UTC(2030, 6, 15, 12, 0, 0)));
  page.close();
});

test('shows the time in CT, plus local time if the laptop is not on Central', () => {
  const page = openYesPage();
  page.$('anchorDownTime').value = '2030-01-15T07:00:00';
  page.$('anchorDownArm').click();
  assert.match(page.status(), /^Armed for Tue, Jan 15, 7:00:00\sAM CT/);
  assert.match(page.status(), /Keeping your computer awake; keep the lid open\./);
  const onCentral = Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Chicago';
  assert.equal(/your time\)/.test(page.status()), !onCentral);
  page.close();
});

test('stays armed through a page refresh', async () => {
  const page = openYesPage({ hours: () => NOTHING });
  const target = targetIn(page, 60);
  page.arm(target);
  await page.advance(10000);
  const session = page.session();
  const now = page.now;
  page.close();

  const refreshed = openYesPage({ hours: () => NOTHING, session, now });
  assert.equal(refreshed.stateLabel(), 'Armed');
  assert.match(refreshed.status(), /\(Kept after page refresh\.\)$/);
  await refreshed.advance(target - refreshed.now + 1000);
  assert.ok(refreshed.enrollRequests().length > 0, 'fired after the refresh');
  refreshed.close();
});

test('refreshes the page once, 3 minutes before, and still fires on time', async () => {
  const page = openYesPage({ hours: () => NOTHING });
  const target = targetIn(page, 10 * 60);
  page.arm(target);
  await page.advance(target - 3 * 60 * 1000 - page.now - 1000);
  assert.equal(page.messages.filter((m) => m.type === 'reload').length, 0, 'not yet');
  await page.advance(2000);
  assert.equal(page.messages.filter((m) => m.type === 'reload').length, 1);
  assert.match(page.$('anchorDownNote').textContent, /^Refreshing the page/);

  // If the reload never happens, it still fires on time.
  await page.advance(target - page.now + 1000);
  assert.equal(page.messages.filter((m) => m.type === 'reload').length, 1, 'only once');
  assert.ok(page.enrollRequests().length > 0);
  page.close();
});

test('after its refresh, the reloaded page does not refresh again', async () => {
  const page = openYesPage();
  const target = targetIn(page, 10 * 60);
  page.arm(target);
  await page.advance(target - 3 * 60 * 1000 - page.now + 1000);
  const session = page.session();
  const now = page.now;
  page.close();

  const reloaded = openYesPage({ session, now });
  await reloaded.advance(60000);
  assert.equal(reloaded.messages.filter((m) => m.type === 'reload').length, 0);
  assert.equal(reloaded.stateLabel(), 'Armed');
  reloaded.close();
});

test('does not refresh when armed less than 3 minutes ahead', async () => {
  const page = openYesPage();
  const target = targetIn(page, 120);
  page.arm(target);
  await page.advance(target - page.now);
  assert.equal(page.messages.filter((m) => m.type === 'reload').length, 0);
  page.close();
});

test('ignores a saved timer whose window already passed', () => {
  const now = Date.now();
  const page = openYesPage({ now, session: { anchorDownTarget: String(now - 10 * 60 * 1000) } });
  assert.equal(page.stateLabel(), 'Not armed');
  assert.equal(page.$('anchorDownArm').textContent, 'Arm');
  page.close();
});

test('Cancel stops the timer and clears the badge and title', async () => {
  const page = openYesPage();
  page.arm(targetIn(page, 120));
  await page.advance(1000);
  page.$('anchorDownArm').click();

  assert.equal(page.stateLabel(), 'Not armed');
  assert.equal(page.status(), 'Cancelled. Alt+X still works.');
  assert.equal(page.badges().at(-1), '');
  assert.equal(page.window.document.title, 'YES');
  assert.deepEqual(page.session(), {});
  await page.advance(200000);
  assert.equal(page.enrollRequests().length, 0);
  page.close();
});

test('sends notifications when armed, 1 minute before, and when enrolling', async () => {
  const page = openYesPage({ hours: () => NOTHING });
  const target = targetIn(page, 120);
  page.arm(target);
  await page.advance(target - page.now);

  const titles = page.notifications().map((n) => n.title);
  assert.deepEqual(titles.slice(0, 3), ['Anchor Down armed', 'Anchor Down: 1 minute to go', 'Anchor Down is enrolling']);
  page.close();
});

test('asks background.js to keep time when armed, and to stop when cancelled', () => {
  const page = openYesPage();
  const target = targetIn(page, 120);
  page.arm(target);
  assert.deepEqual(page.messages.find((m) => m.type === 'schedule'), { type: 'schedule', target });
  page.$('anchorDownArm').click();
  assert.ok(page.messages.some((m) => m.type === 'unschedule'));
  page.close();
});

test('in a background tab, ticks from background.js alone keep it on time', async () => {
  const { now, target } = schedule(60);
  const page = openYesPage({ now, background: true, ...enrollsAt(target, [], { enrolled: 10, saved: 0, waitlisted: 3 }) });
  page.arm(target);
  await page.advance(target - 20000 - page.now);  // no ticks yet: background.js is waiting for its alarm
  assert.equal(page.enrollRequests().length, 0);
  await page.advanceWithTicks(20000 + 31000);     // from 20s before, ticks every 250ms

  const offsets = attemptOffsets(page, target);
  assert.ok(offsets[0] >= -5 && offsets[0] < -4.5, 'first attempt about 5s early, got ' + offsets[0]);
  assert.equal(page.stateLabel(), 'Success');
  assert.match(page.status(), /All 3 classes went through/);
  assert.ok(page.messages.some((m) => m.type === 'unschedule'), 'told background.js to stop');
  page.close();
});

test('ignores ticks when not armed', async () => {
  const page = openYesPage();
  page.tick();
  page.tick();
  await page.advance(100);
  assert.equal(page.stateLabel(), 'Not armed');
  assert.equal(page.requests.length, 0);
  page.close();
});

test('the Check button shows the cart and login without arming', async () => {
  const page = openYesPage({ cart: FULL_CART });
  page.$('anchorDownCheck').click();
  await page.advance(100);
  assert.equal(page.$('anchorDownCart').textContent, 'In your cart (3): CS 3251, MATH 2810, ECON 1010');
  assert.match(page.$('anchorDownLogin').textContent, /^✓ Logged in/);
  assert.match(page.status(), /^Checked at .* CT\. Not armed\.$/);
  assert.equal(page.stateLabel(), 'Not armed');
  assert.equal(page.enrollRequests().length, 0);
  assert.equal(page.messages.some((m) => m.type === 'schedule'), false);
  page.close();
});

test('the Check button warns about an expired login without a notification', async () => {
  const page = openYesPage({ loggedIn: () => false });
  page.window.fetch = async () => ({
    ok: true, status: 200,
    text: async () => '<html>Please log in</html>',
    json: async () => { throw new Error('not JSON'); },
  });
  page.$('anchorDownCheck').click();
  await page.advance(100);
  assert.equal(page.$('anchorDownNote').textContent, "Can't reach YES. Your login may have expired. Refresh the page.");
  assert.equal(page.status(), "Couldn't reach YES. Not armed.");
  assert.equal(page.notifications().length, 0);
  page.close();
});

test('warns when classes plus cart go over 18 hours', async () => {
  const page = openYesPage({ cart: FULL_CART, hours: () => ({ enrolled: 9, saved: 10, waitlisted: 0 }) });
  page.$('anchorDownCheck').click();
  await page.advance(100);
  assert.match(page.$('anchorDownWarn').textContent, /come to 19 hours, over the usual 18-hour limit/);
  page.close();
});

test('no hours warning at exactly 18', async () => {
  const page = openYesPage({ cart: FULL_CART, hours: () => ({ enrolled: 9, saved: 9, waitlisted: 0 }) });
  page.$('anchorDownCheck').click();
  await page.advance(100);
  assert.equal(page.$('anchorDownWarn').textContent, '');
  page.close();
});

test('when the login check fails, it warns and reloads the page to sign back in', async () => {
  let loggedIn = false;
  const page = openYesPage({ loggedIn: () => loggedIn });
  page.arm(targetIn(page, 600));
  await page.advance(100);

  assert.match(page.$('anchorDownLogin').textContent, /^✗ Login check failed/);
  assert.equal(page.notifications().at(-1).id, 'login');
  assert.equal(page.messages.filter((m) => m.type === 'reload').length, 1);
  assert.match(page.$('anchorDownNote').textContent, /^Your login may have expired\. Refreshing the page/);
  assert.equal(page.stateLabel(), 'Armed');

  // The reloaded page is logged in again: the warning clears.
  const session = page.session();
  const now = page.now;
  page.close();
  loggedIn = true;
  const reloaded = openYesPage({ session, now: now + 2000 });
  await reloaded.advance(100);
  assert.match(reloaded.$('anchorDownLogin').textContent, /^✓ Logged in/);
  assert.equal(reloaded.$('anchorDownNote').textContent, '');
  assert.ok(reloaded.messages.some((m) => m.type === 'clear' && m.id === 'login'));
  reloaded.close();
});

test('does not reload again within 2 minutes if the login is still failing', async () => {
  const page = openYesPage({ loggedIn: () => false });
  page.arm(targetIn(page, 600));
  await page.advance(100);
  const session = page.session();
  const now = page.now;
  page.close();

  const reloaded = openYesPage({ loggedIn: () => false, session, now: now + 5000 });
  await reloaded.advance(100);
  assert.equal(reloaded.messages.filter((m) => m.type === 'reload').length, 0);
  assert.equal(reloaded.$('anchorDownNote').textContent,
    "Can't reach YES. Your login may have expired. Refresh the page. The timer stays armed.");
  reloaded.close();
});

test('does not reload in the last minute', async () => {
  let loggedIn = true;
  const page = openYesPage({ loggedIn: () => loggedIn });
  const target = targetIn(page, 120);
  page.arm(target);
  await page.advance(100);
  loggedIn = false;
  await page.advance(target - page.now - 10000);  // the last check, 15s before, fails
  assert.match(page.$('anchorDownLogin').textContent, /^✗ Login check failed/);
  assert.equal(page.messages.filter((m) => m.type === 'reload').length, 0);
  page.close();
});

test('Alt+X during the timer shares the 2-second limit', async () => {
  const page = openYesPage({ hours: () => NOTHING });
  const target = targetIn(page, 30);
  page.arm(target);
  await page.advance(target - page.now);
  for (let i = 0; i < 40; i++) {
    page.pressAltX();
    await page.advance(100);
  }
  const offsets = attemptOffsets(page, target);
  for (let i = 1; i < offsets.length; i++) {
    assert.ok(offsets[i] - offsets[i - 1] > 2, 'attempts at least 2s apart');
  }
  page.close();
});

test('minimize hides the picker but keeps the status visible', () => {
  const page = openYesPage();
  page.$('anchorDownMin').click();
  assert.equal(page.$('anchorDownBody').hidden, true);
  assert.notEqual(page.status(), '');
  page.$('anchorDownMin').click();
  assert.equal(page.$('anchorDownBody').hidden, false);
  page.close();
});

test('timer.js does not leak variables into the page scope shared with enroll.js', () => {
  const page = openYesPage();
  for (const name of ['state', 'tick', 'arm', 'start', 'finish', 'el', 'STATES', 'MESSAGES']) {
    assert.equal(name in page.window, false, name + ' leaked');
  }
  page.close();
});
