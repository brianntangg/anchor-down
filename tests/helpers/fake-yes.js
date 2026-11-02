// A fake YES class search page for testing the extension without Vanderbilt.
//
// Loads the content scripts listed in manifest.json, in order, into a jsdom
// page with fake YES endpoints, a fake chrome API and a fake clock, so tests
// can move time forward instantly instead of waiting.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const CONTENT_SCRIPTS = manifest.content_scripts[0].js
  .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'));

const YES_URL = 'https://more.app.vanderbilt.edu/more/SearchClasses!input.action';

// Promise rejections nothing handled. In Chrome these show up as
// "Uncaught (in promise)" errors on the extension's Errors page.
const unhandledRejections = [];
process.on('unhandledRejection', (reason) => { unhandledRejections.push(reason); });

// Cart HTML in the shape enroll.js reads: a term code, and one .classTable per
// class with the course name in td.left and *.classNumber inputs inside
// .classSelection. items: [{ course: 'CS 3251', number: '1111' }]
function cartHtml(termCode, items) {
  const tables = items.map((item, i) => {
    const [subject, catalog] = item.course.split(' ');
    return `
    <table class="classTable">
      <tr><td class="left"> <span>${subject}</span> <span>${catalog}</span></td></tr>
      <tr><td><div class="classSelection">
        <input name="items[${i}].classNumber" value="${item.number}">
        <input name="items[${i}].waitList" value="true">
      </div></td></tr>
    </table>`;
  }).join('');
  return `<html><body>
    <input id="selectedTermCodeHidden" value="${termCode}">
    <div id="StudentCartList_div">${tables}</div>
  </body></html>`;
}

/**
 * Opens a fake YES page with the extension loaded.
 *
 * options:
 *   termCode                the term in the cart
 *   cart                    [{ course: 'CS 3251', number: '1111' }], or
 *                           cart(ctx) to change it over time
 *   emptyCartPage           'no-cart' to leave the cart section off the
 *                           page when the cart is empty, as the real YES does
 *   now                     starting time (ms), defaults to the real time
 *   hours(ctx)              returns { enrolled, saved, waitlisted } for the
 *                           hours summary; ctx.enrollsAfter(t) counts enroll
 *                           requests sent at or after time t
 *   loggedIn()              false makes the hours summary return a login page
 *   session                 sessionStorage contents to start with (a refresh)
 *   network                 'down' makes every request fail, like being offline
 *   background              true: the tab is in the background and Chrome has
 *                           slowed its timers so much they never fire; only
 *                           tick() (from background.js) moves the timer
 */
function openYesPage(options = {}) {
  const {
    termCode = '1050',
    emptyCartPage = 'no-cart',
    cart = [{ course: 'CS 3251', number: '1111' }],
    hours = () => ({ enrolled: 0, saved: 3, waitlisted: 0 }),
    loggedIn = () => true,
    session = {},
    network = 'up',
    background = false,
  } = options;
  const firstRejection = unhandledRejections.length;

  let now = options.now ?? Date.now();
  const timers = new Map();
  let nextTimerId = 1;
  const requests = [];   // { time, endpoint, url }
  const messages = [];   // messages timer.js sent to background.js
  const pageErrors = []; // errors a browser would show in the console
  const messageListeners = [];  // enroll.js and timer.js each add one

  const dom = new JSDOM(`<!doctype html><title>YES</title><body>
      <a id="enrollmentDatesLink">Enrollment Dates</a>
      <span id="enrolledHours">0</span>
      <span id="savedHours">3</span>
      <span id="waitingHours">0</span>
    </body>`, { url: YES_URL, runScripts: 'outside-only' });
  const w = dom.window;

  // jsdom has no innerText; enroll.js uses it.
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
  });

  for (const [key, value] of Object.entries(session)) w.sessionStorage.setItem(key, value);

  // Fake clock: Date.now and timers only move when the test calls advance().
  w.Date.now = () => now;
  w.setTimeout = (fn, ms = 0) => { timers.set(nextTimerId, { fn, at: now + ms }); return nextTimerId++; };
  w.setInterval = (fn, ms) => {
    if (!background) timers.set(nextTimerId, { fn, at: now + ms, every: ms });
    return nextTimerId++;
  };
  w.clearTimeout = w.clearInterval = (id) => { timers.delete(id); };

  const ctx = {
    enrollsAfter: (t) => requests.filter((r) => r.endpoint === 'queueEnroll' && r.time >= t).length,
  };

  function respond(url) {
    const endpoint = url.split('!')[1].split('.action')[0];
    requests.push({ time: now, endpoint, url });
    switch (endpoint) {
      case 'getSavedClasses': {
        const items = typeof cart === 'function' ? cart(ctx) : cart;
        // Seen on the real portal: with an empty cart, the page keeps the term
        // code but leaves out the cart section.
        if (items.length === 0 && emptyCartPage === 'no-cart') {
          return `<html><body><input id="selectedTermCodeHidden" value="${termCode}">Your cart is empty.</body></html>`;
        }
        return cartHtml(termCode, items);
      }
      case 'queueEnroll': return JSON.stringify({ jobId: 'J' + requests.length });
      case 'checkStatus': return 'true';
      case 'getClassHoursSummary': {
        if (!loggedIn()) return '<html>Please log in</html>';
        const h = hours(ctx);
        return JSON.stringify({
          enrolled: { classHours: h.enrolled }, saved: { classHours: h.saved }, waitlisted: { classHours: h.waitlisted },
        });
      }
      default: throw new Error('Unexpected request: ' + url);
    }
  }

  w.fetch = async (url) => {
    if (network === 'down') throw new w.TypeError('Failed to fetch');
    const body = respond(url);
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  w.XMLHttpRequest = class {
    open(method, url) { this.url = url; }
    send() {
      queueMicrotask(() => {
        if (network === 'down') {
          this.responseText = '';
          this.status = 0;
          this.readyState = 4;
          try { this.onreadystatechange(); } catch (error) { pageErrors.push(error); }
          return;
        }
        this.responseText = respond(this.url);
        this.readyState = 4;
        // A browser logs errors thrown by a request callback and carries on, so
        // record them instead of crashing the test.
        try {
          this.onreadystatechange();
        } catch (error) {
          pageErrors.push(error);
        }
      });
    }
  };

  w.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => { messageListeners.push(fn); } },
      // Plain copies, since objects from the page's realm don't deepEqual Node's.
      sendMessage: async (msg) => { messages.push(JSON.parse(JSON.stringify(msg))); },
    },
  };
  w.console = { log() {}, error() {}, warn() {} };

  for (const source of CONTENT_SCRIPTS) w.eval(source);

  const $ = (id) => w.document.getElementById(id);

  // Lets pending fetch/XHR promises settle.
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  return {
    window: w,
    requests,
    messages,
    pageErrors,

    /** Every uncaught error and unhandled rejection since the page opened. */
    errors: () => [...pageErrors, ...unhandledRejections.slice(firstRejection)].map(String),
    $,
    get now() { return now; },

    /** Moves the fake clock forward, running timers as they come due. */
    async advance(ms, step = 50) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + step);
        for (const [id, timer] of [...timers]) {
          if (timer.at > now || !timers.has(id)) continue;
          if (timer.every) timer.at += timer.every;
          else timers.delete(id);
          timer.fn();
        }
        await flush();
      }
      await flush();
    },

    /** Simulates pressing Alt+X. */
    pressAltX() { messageListeners.forEach((fn) => fn({ command: 'toggle-enroll' })); },

    /** Delivers a "tick" from background.js. */
    tick() { messageListeners.forEach((fn) => fn({ command: 'tick' }, {}, () => {})); },

    /** Sends a message like background.js would, and returns the page's answer. */
    ask(message) {
      let reply;
      messageListeners.forEach((fn) => fn(message, {}, (r) => { reply = JSON.parse(JSON.stringify(r)); }));
      return reply;
    },

    /** Moves time forward while background.js ticks every 250ms. */
    async advanceWithTicks(ms) {
      for (let t = 0; t < ms; t += 250) {
        await this.advance(250);
        this.tick();
      }
      await this.advance(0);
    },

    /** Sets the panel's date and time and clicks Arm. */
    arm(targetMs) {
      $('anchorDownTime').value = toInputValue(targetMs);
      $('anchorDownArm').click();
    },

    status: () => $('anchorDownStatus').textContent,
    stateLabel: () => $('anchorDownState').textContent,
    enrollRequests: () => requests.filter((r) => r.endpoint === 'queueEnroll'),
    notifications: () => messages.filter((m) => m.type === 'notify'),
    badges: () => messages.filter((m) => m.type === 'badge').map((m) => m.text),
    session: () => ({ ...w.sessionStorage }),

    close() { w.close(); },
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

// ms -> the picker's "YYYY-MM-DDTHH:MM:SS", in Central time like the extension.
function toInputValue(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms)).forEach((part) => { p[part.type] = Number(part.value); });
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** A time `secondsAhead` from `now`, rounded to a whole second like the picker. */
function targetIn(page, secondsAhead) {
  return Math.ceil((page.now + secondsAhead * 1000) / 1000) * 1000;
}

module.exports = { openYesPage, targetIn, ROOT };
