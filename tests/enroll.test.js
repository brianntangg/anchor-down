// Alt+X: the enrollment request itself (enroll.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { openYesPage } = require('./helpers/fake-yes');

test('Alt+X sends one enroll request for the whole cart, with waitlist on', async () => {
  const page = openYesPage({
    termCode: '1050',
    cart: [
      { course: 'CS 3251', number: '1111' },
      { course: 'MATH 2810', number: '2222' },
      { course: 'ECON 1010', number: '3333' },
    ],
  });
  await page.advance(2500); // presses in the first 2s after page load are ignored
  page.pressAltX();
  await page.advance(100);

  const enrolls = page.enrollRequests();
  assert.equal(enrolls.length, 1);
  assert.equal(enrolls[0].url,
    'https://more.app.vanderbilt.edu/more/StudentClass!queueEnroll.action?selectedTermCode=1050' +
    '&enrollmentRequestItems%5B0%5D.classNumber=1111&enrollmentRequestItems%5B0%5D.waitList=true' +
    '&enrollmentRequestItems%5B1%5D.classNumber=2222&enrollmentRequestItems%5B1%5D.waitList=true' +
    '&enrollmentRequestItems%5B2%5D.classNumber=3333&enrollmentRequestItems%5B2%5D.waitList=true');
  page.close();
});

test('each attempt reads the cart, enrolls, checks the job and refreshes the hours', async () => {
  const page = openYesPage();
  await page.advance(2500);
  page.pressAltX();
  await page.advance(100);

  const endpoints = page.requests.map((r) => r.endpoint).sort();
  assert.deepEqual(endpoints, ['checkStatus', 'getClassHoursSummary', 'getSavedClasses', 'queueEnroll']);
  page.close();
});

test('holding Alt+X sends at most one attempt every 2 seconds', async () => {
  const page = openYesPage();
  await page.advance(2500);
  for (let i = 0; i < 60; i++) { // hold for 6 seconds, key repeating every 100ms
    page.pressAltX();
    await page.advance(100);
  }
  assert.equal(page.enrollRequests().length, 3);
  page.close();
});

test('the page counter shows the attempt count', async () => {
  const page = openYesPage();
  await page.advance(2500);
  page.pressAltX();
  await page.advance(2100);
  page.pressAltX();
  await page.advance(100);
  assert.equal(page.$('enrollmentDatesLink').textContent, 'Attempts: 2');
  page.close();
});
