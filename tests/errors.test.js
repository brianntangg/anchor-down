// No uncaught errors, in normal use or when things go wrong. In Chrome, any of
// these would show up on the extension's Errors page.

const test = require('node:test');
const assert = require('node:assert/strict');
const { openYesPage, targetIn } = require('./helpers/fake-yes');

const EMPTY = { enrolled: 12, saved: 0, waitlisted: 0 };

async function holdAltX(page, seconds) {
  for (let i = 0; i < seconds * 10; i++) {
    page.pressAltX();
    await page.advance(100);
  }
}

test('Alt+X with a normal cart', async () => {
  const page = openYesPage();
  await page.advance(2500);
  await holdAltX(page, 5);
  assert.deepEqual(page.errors(), []);
  page.close();
});

test('Alt+X with an empty cart', async () => {
  const page = openYesPage({ cart: [], hours: () => EMPTY });
  await page.advance(2500);
  await holdAltX(page, 3);
  assert.equal(page.enrollRequests().length, 0, 'nothing to enroll, so no request');
  assert.deepEqual(page.errors(), []);
  page.close();
});

test('Alt+X after the login expired', async () => {
  const page = openYesPage({ loggedIn: () => false });
  page.window.fetch = async (url) => ({
    ok: true, status: 200,
    text: async () => '<html>Please log in</html>',
    json: async () => { throw new page.window.SyntaxError('Unexpected token <'); },
  });
  await page.advance(2500);
  await holdAltX(page, 3);
  assert.deepEqual(page.errors(), []);
  page.close();
});

test('Alt+X while offline', async () => {
  const page = openYesPage({ network: 'down' });
  await page.advance(2500);
  await holdAltX(page, 3);
  assert.deepEqual(page.errors(), []);
  page.close();
});

test('a full timer run where the cart empties partway', async () => {
  const now = Date.now();
  const target = Math.ceil((now + 30000) / 1000) * 1000;
  let enrolled = false;
  const page = openYesPage({
    now,
    cart: (ctx) => (ctx.enrollsAfter(target) > 0 ? [] : [{ course: 'CS 3251', number: '1111' }]),
    hours: (ctx) => (ctx.enrollsAfter(target) > 0 ? EMPTY : { enrolled: 9, saved: 3, waitlisted: 0 }),
  });
  page.arm(target);
  await page.advance(target - page.now);
  await holdAltX(page, 10);  // Alt+X held as a backup, past the point the cart empties
  await page.advance(31000);
  assert.deepEqual(page.errors(), []);
  page.close();
});

test('a timer run while offline', async () => {
  const page = openYesPage({ network: 'down' });
  const target = targetIn(page, 30);
  page.arm(target);
  await page.advance(target - page.now + 31000);
  assert.match(page.status(), /couldn't check your classes/);
  assert.deepEqual(page.errors(), []);
  page.close();
});
