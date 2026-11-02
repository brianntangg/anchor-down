# anchor-down

Enroll in your entire Vanderbilt YES cart the moment registration opens.

## Install

1. Clone or download this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open YES class search. An **Anchor Down** panel should appear in the bottom left. If it doesn't, refresh the page.

Don't press **Alt+X** (**Option+X** on Mac) to test it. Every press sends a real enrollment request for your whole cart.

To change the shortcut, go to `chrome://extensions/shortcuts`.

## Use

### Before registration

- Add every class you want to your YES cart. Fill in any per-class options, such as grad/undergrad.
- Remove conflicts, such as two classes at the same time or two sections of the same course. What happens with conflicts in the cart is undefined.
- Every class is requested with **waitlist on**. If a class is full, you'll be added to its waitlist.
- Tip: put your most competitive classes in the cart first. Add the easier ones by hand afterward.

### Automatic (recommended)

1. Open YES class search. In the **Anchor Down** panel in the bottom left, set your enrollment date and time and click **Arm**. The time is **Central time**, like YES, even if your laptop is set to another time zone. It defaults to today at 7:00:00 AM CT, and if you're somewhere else, the panel also shows the time where you are.

   The panel then lists the classes in your cart, so you can check them. It warns you if the cart is empty, has more than one section of the same course (it would try to enroll in every section), or would take you over the usual 18-hour limit.

   To run these checks without arming, click **Check**.
2. Leave the YES tab open and keep your computer awake. On a Mac, running `caffeinate -d` in Terminal does this. You can use other tabs and windows; 20 seconds before your time, Anchor Down brings the YES tab to the front.
3. Refresh the page a few minutes before your time so your login is fresh. The timer stays armed through a refresh, as long as it's the same tab.
4. It starts 5 seconds before your time and tries every 2 seconds. It stops as soon as your cart is empty, or 30 seconds after your time at the latest. Then it compares your cart from before and after and lists each class:
   - **✓ CS 3251: enrolled or waitlisted.** It left your cart, so it went through.
   - **✗ ECON 1010: still in your cart.** It didn't go through. Enroll in it by hand right away.

   The overall result is **Success** (every class went through), **Partly done** (some did) or **No change** (none did), with a sound. Refresh to see which classes are enrolled and which are waitlisted.

You can follow along without looking at the panel:

- **Panel:** a colored state (Not armed, Armed, Enrolling, Success, No change), a live countdown, the time of the last login check, and a progress bar with each attempt's time while it runs.
- **Toolbar badge:** the Anchor Down icon counts down (`3h`, `12m`, `45s`), shows `GO` while enrolling, then `✓` or `!`. Pin the extension from Chrome's puzzle-piece menu to keep it visible.
- **Tab title:** shows the countdown, like `⏳ 4:57`, and then the result.
- **Notifications:** when you arm it, 1 minute before, when it starts enrolling, and with the result. You also get one if your login expires. Click a notification to jump back to the YES tab. On a Mac, allow notifications for Google Chrome in System Settings → Notifications, and turn off Focus / Do Not Disturb.

Drag the panel by its header, or click **–** to shrink it to just the status.

A red note in the panel means your login may have expired: refresh the page. The timer stays armed.

You can hold **Alt+X** while it runs as a backup. Both share the same 2-second limit, so this won't send extra requests.

### Manual (Alt+X)

1. Refresh the page a minute before your time so your session is fresh.
2. About 5 seconds before your enrollment time, start holding **Alt+X**. The enrollment dates link shows **Attempts: N**, going up with each attempt. The extension sends at most one attempt every 2 seconds, because YES flags faster requests.
3. About 5 seconds after your time opens, refresh the page and check your schedule. Also look for error popups in the bottom right.
4. If it didn't work, try once more. After that, enroll the normal way.

Open DevTools (Console tab) to see each attempt's term code, class numbers and job status.

## Tests

The tests run the extension against a fake YES page, so they don't need Vanderbilt or Chrome. They need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm test
```

Chrome only loads the files listed in `manifest.json`, so `tests/`, `package.json` and `node_modules/` don't affect the extension.
