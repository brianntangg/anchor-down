# Anchor Down

Enroll in your entire Vanderbilt YES cart the moment registration opens, even if you're still asleep.

Anchor Down is a Chrome extension. You put your classes in your YES cart, set your enrollment time, and click **Arm**. At your time, it sends YES the same enrollment request the **Enroll** button does, for every class in your cart, and keeps retrying for a few seconds. It skips the slow YES page, so your request lands as soon as registration opens. Afterward, it tells you which classes went through.

No more 6:59 AM refresh-spamming. No more watching YES spin while the last seat in that class disappears.

You don't have to be at your computer when your time comes. It just has to be on, with Chrome open. Go back to sleep. 😴

## TL;DR (for the skimmers)

1. **Install:** download this repo, go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the folder.
2. **Add your classes** to your YES cart.
3. **Open YES class search,** set your enrollment time (Central time) in the panel in the bottom left, and click **Arm**.
4. **Leave Chrome open and your laptop lid open.** You can walk away.
5. **Check back afterward.** The panel shows a ✓ for each class that went through. Enroll in any ✗ by hand.

That's it. The rest of this page is details and troubleshooting, for when YES is being YES.

## What you need

- **Google Chrome** on a computer (not a phone or tablet).
- Your **YES login**.
- Your **enrollment time**, the one you've been dreading. YES shows it on the class search page, in the enrollment dates link.

## Install (one time, about 2 minutes)

1. **Download it.** On this repo's GitHub page, click **Code → Download ZIP**, then unzip it. (Or `git clone` it.) Keep the folder somewhere permanent, like Documents. Chrome loads the extension from that folder every time, so don't delete or move it.
2. **Load it into Chrome.**
   1. Go to `chrome://extensions` (type it in the address bar).
   2. Turn on **Developer mode** (top right). It sounds scarier than it is.
   3. Click **Load unpacked**, and select the folder that contains `manifest.json`. That's the unzipped folder itself, not the ZIP and not a folder above it.
3. **Pin it.** Click Chrome's puzzle-piece icon (top right) and pin **Anchor Down**, so its gold anchor icon stays in your toolbar.
4. **Allow notifications.** On a Mac, open System Settings → Notifications → Google Chrome and turn on **Allow notifications**. On Windows, make sure Chrome's notifications aren't turned off in Settings → System → Notifications.
5. **Check it works.** Open YES class search at
   `https://more.app.vanderbilt.edu/more/SearchClasses!input.action`
   An **Anchor Down** panel should appear in the bottom-left corner. If it doesn't, refresh the page.

Chrome lists three permissions for Anchor Down:

- **alarms:** wake it up just before your time.
- **notifications:** tell you what's happening.
- **power:** keep your computer from sleeping while it's armed.

That's the whole list. It can't see any other site, and it only ever adds the classes in your cart. It never drops or swaps a class.

## Registration day game plan

### Days before

1. Put every class you want in your YES cart. Fill in any options YES asks for, such as grad/undergrad.
2. Remove conflicts: two classes at the same time, or two sections of the same course. Anchor Down tries to enroll in everything in the cart.
3. Look up your enrollment date and time in YES.

### The night before, or any time before your window

1. Open YES class search and find the Anchor Down panel.
2. Set your **enrollment date and time** in **Central time**, even if you're somewhere else. The panel also shows your local time.
3. Click **Arm**. Check that the panel lists your classes, shows **✓ Logged in**, and has no orange warnings.
4. Leave **Chrome open**, the **YES tab open** and the **laptop lid open**, ideally plugged in. You can use other tabs and windows, and the screen can turn off or lock.

**At your time**, nothing is needed from you. Seriously. Anchor Down brings the YES tab to the front, enrolls, and notifies you with the result.

### Afterward

1. Read the result in the panel or the popup (see [Results](#results)).
2. Refresh YES and check your schedule. YES shows which classes are enrolled and which are waitlisted.
3. Enroll by hand in anything marked **✗ still in your cart**, right away.

## What it's doing while you sleep

| When | What happens |
| --- | --- |
| When you click Arm | Checks your login and cart, and starts keeping your computer awake |
| Every 4 minutes | Checks your login again. If it has expired, it refreshes the page to sign you back in |
| 3 minutes before | Refreshes the YES page so your login is fresh. It stays armed |
| 1 minute before | Notification: 1 minute to go |
| 20 seconds before | Brings the YES tab and its window to the front |
| 5 seconds before | Starts enrolling: one request for your whole cart every 2 seconds |
| Once your cart is empty, or 30 seconds after your time | Stops, and compares your cart before and after |

It starts a few seconds early because YES's clock and yours can differ slightly. Requests sent before registration opens are simply turned down. It never sends more than one request every 2 seconds, because YES flags faster requests.

**These stop it:** closing the YES tab, quitting Chrome, closing the laptop lid, or the computer losing power. Refreshing the tab, or logging back in and returning to class search in the same tab, does not stop it.

## The panel

- **Enrollment date and time (Central):** when registration opens for you. It defaults to today at 7:00:00 AM CT.
- **Arm:** starts the timer. It changes to **Cancel** while armed.
- **Check:** checks your login and cart without arming.
- **Drag** the panel by its brown header. Click **–** to shrink it to just the status.

### Warnings (orange)

- **Your cart is empty.**
- **More than one section of the same course** is in your cart. It would try to enroll in all of them.
- **Over the usual 18-hour limit:** your enrolled classes plus your cart, so YES may turn some down.
- **Couldn't read your cart.** Refresh the page.

A **red note** means your login may have expired. It refreshes the page itself, but you can too.

## Results

Each class in your cart gets a line:

- **✓ CS 3251: enrolled or waitlisted.** It left your cart, so it went through.
- **✗ ECON 1010: still in your cart.** It didn't go through. Enroll by hand now. Common reasons: the class is full with no waitlist, a time conflict, a missing prerequisite or permission, or the hours limit.

The overall result is one of:

- **Success:** every class went through. 🎉
- **Partly done:** some did. The ones left are named.
- **No change:** none did. Enroll by hand right away. (Sorry. 😬)
- **Finished:** it couldn't check your classes afterward. Refresh YES to see your schedule.

Every class is requested with **waitlist on**, so a full class with a waitlist adds you to the waitlist, and counts as ✓.

## Following along from anywhere

- **Toolbar popup:** click the anchor icon from any tab to see the status, countdown and results, with **Check**, **Cancel** and **Go to YES tab**. With no YES tab open, it offers **Open YES**.
- **Toolbar badge:** counts down (`3h`, `12m`, `45s`), shows `GO` while enrolling, then `✓` or `!`.
- **Tab title:** shows the countdown, like `⏳ 4:57`, then the result.
- **Notifications:**
  - when you arm it
  - 1 minute before
  - when it starts enrolling
  - the result
  - if your login expires
  - if the YES tab can't enroll

  Click one to jump to the YES tab.
- **Sound:** two rising beeps for success, two falling beeps otherwise. After a page refresh, the sound only works once you've clicked somewhere on the page.

## Manual mode (Alt+X), for the hands-on crowd

Holding **Alt+X** (**Option+X** on a Mac) sends the same request by hand, at most once every 2 seconds:

1. Refresh YES class search a minute before your time.
2. About 5 seconds before, start holding **Alt+X**. The enrollment dates link counts **Attempts: N**.
3. About 5 seconds after your time, let go, refresh and check your schedule.

**Every press sends a real enrollment request for your whole cart**, so don't press it just to try it out. Your cart will thank you. You can hold it as a backup while the timer runs; they share the 2-second limit. To change the shortcut, go to `chrome://extensions/shortcuts`.

## Troubleshooting (when YES is being YES)

**The panel doesn't appear.**

- Make sure you're on YES **class search** (link above), then refresh.
- Check that Anchor Down is turned on at `chrome://extensions`.
- If you just installed or reloaded the extension, refresh the YES page.

**"Anchor Down can't enroll" notification.** The YES tab isn't on class search, or isn't armed, usually because YES asked you to log in again. Log in, go back to class search in the same tab, and it re-arms itself. If the panel says **Not armed**, arm it again.

**"YES login may have expired" notification.** It tries to refresh the page and sign you back in. If YES asks you to log in, do so and return to class search.

**I didn't get any notifications.**

- Check your computer's notification settings for Chrome (see Install).
- Turn off Focus / Do Not Disturb.

**It didn't enroll at my time.**

- Check the panel or popup for the result.
- If your computer slept, the lid was closed or Chrome was closed, it couldn't run. Enroll by hand.

**A class says "still in your cart."** YES turned it down; see the reasons under [Results](#results). Enroll by hand, or pick another section.

**"Your cart didn't change, so I can't tell which classes."** Your hours went up, but it couldn't match classes. Refresh YES and check your schedule.

**Something else went wrong.** At `chrome://extensions`, click **Errors** on the Anchor Down card and note what it says. Also open DevTools on the YES page (Console tab) to see each attempt's details.

## Updating and uninstalling

- **Update:** download the new version into the same folder (or `git pull`), then click the reload arrow on the Anchor Down card at `chrome://extensions`, and refresh YES.
- **Uninstall:** click **Remove** on the Anchor Down card at `chrome://extensions`.

## Development

The tests run the extension against a fake YES page, so they don't need Vanderbilt or Chrome. They need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm test
```

`npm test` runs everything twice, the second time as if your computer were in California, to catch time zone bugs. Chrome only loads the files listed in `manifest.json`, so `tests/`, `package.json` and `node_modules/` don't affect the extension.

## What it does, and what it doesn't

- **It does what the Enroll button does.** It sends YES the same request, from your browser, using your own login.
- **It only runs at the time you set.** It starts 5 seconds early, tries every 2 seconds, and stops after about 35 seconds, or sooner once everything in your cart goes through.
- **It only adds classes from your cart.** It never drops or swaps a class you're already in.
- **It only talks to YES.** It doesn't collect or share your info. It only remembers the time you set and when it last refreshed the page, and only in that tab.

Always double-check your schedule in YES afterward.

---

Anchor Down, Commodores. ⚓
