// ---------------------------------------------------------------------------
// Auto-enroll timer
// Calls the same enroll() as Alt+X, from 5s before the armed time to 30s after,
// and shares its 2s cooldown, so holding Alt+X at the same time is safe.
// Loads after enroll.js (see manifest.json) and uses its enroll() and
// previous_enrollment_time. Panel styles are in panel.css.
//
// Chrome slows timers in background tabs, so background.js keeps time near the
// armed moment: it brings this tab to the front 20s before and sends a "tick"
// message every 250ms, which runs the same tick() as the local timer.
// ---------------------------------------------------------------------------

(function () {
	'use strict';

	const START_BEFORE_MS = 5000;        // start firing this long before the armed time
	const STOP_AFTER_MS = 30000;         // stop firing this long after it, at the latest
	const COOLDOWN_MS = 2000;            // same as the Alt+X cooldown in enroll.js
	const TICK_MS = 250;
	const KEEPALIVE_MS = 4 * 60 * 1000;  // login check interval while waiting
	const BASELINE_BEFORE_MS = 15000;    // last hours snapshot before firing
	const WARN_BEFORE_MS = 60000;        // "1 minute to go" notification
	const FRONT_BEFORE_S = 20;           // background.js brings the tab forward this early
	const MAX_HOURS = 18;                // usual per-semester limit without approval
	const STORAGE_KEY = 'anchorDownTarget';
	const HOURS_URL = 'https://more.app.vanderbilt.edu/more/StudentClass!getClassHoursSummary.action';
	const CART_URL = 'https://more.app.vanderbilt.edu/more/StudentClass!getSavedClasses.action';
	const TIME_ZONE = 'America/Chicago';  // YES enrollment times are Central
	const TIME_ZONE_LABEL = 'CT';

	const MESSAGES = {
		idle: 'Not armed. Alt+X still works.',
		loginExpired: "Can't reach YES. Your login may have expired. Refresh the page.",
		stillArmed: ' The timer stays armed.'
	};

	const STATES = {
		idle:     { label: 'Not armed', color: '#6b7280' },
		armed:    { label: 'Armed',     color: '#2563eb' },
		firing:   { label: 'Enrolling', color: '#d97706' },
		success:  { label: 'Success',   color: '#16a34a' },
		partial:  { label: 'Partly done', color: '#ea580c' },
		nochange: { label: 'No change', color: '#dc2626' },
		done:     { label: 'Finished',  color: '#6b7280' }  // finished, but hours couldn't be checked
	};

	// Everything the timer tracks while armed. start() resets it.
	const state = {
		target: null,          // armed time (ms)
		interval: null,
		attempts: 0,
		attemptTimes: [],
		baseline: null,        // { enrolled, waitlisted, saved } hours before firing
		baselineFinal: false,  // the last snapshot before firing was taken
		cart: null,            // [{ name, numbers }] in the cart before firing
		lastKeepAlive: 0,
		warned: false,         // "1 minute to go" was sent
		firingNotified: false,
		loginOk: null,         // result of the last login check
		restored: false        // re-armed after a page refresh
	};

	const originalTitle = document.title;
	let audio = null;
	let lastBadge = null;
	const el = {};  // panel elements, filled in by buildPanel()

	// ---- Scheduling ----

	// Runs every TICK_MS: count down, then fire, then finish.
	function tick() {
		if (!state.target) return;  // not armed, or a late tick after finishing
		const untilOpen = state.target - Date.now();
		if (untilOpen > START_BEFORE_MS) tickWaiting(untilOpen);
		else if (untilOpen > -STOP_AFTER_MS) tickFiring(untilOpen);
		else finish(false);
	}

	function tickWaiting(untilOpen) {
		const now = Date.now();
		const lastCall = !state.baselineFinal && untilOpen <= BASELINE_BEFORE_MS;
		if (lastCall || now - state.lastKeepAlive > KEEPALIVE_MS) {
			if (lastCall) state.baselineFinal = true;
			state.lastKeepAlive = now;
			refreshBaseline();
		}
		if (!state.warned && untilOpen <= WARN_BEFORE_MS) {
			state.warned = true;
			notify('status', 'Anchor Down: 1 minute to go', 'It will bring the YES tab to the front ' + FRONT_BEFORE_S + ' seconds before.');
		}
		setState('armed');
		setText(el.countdown, 'Opens in ' + formatDuration(untilOpen));
		setStatus('Armed for ' + formatDate(state.target) + '. Starts ' + START_BEFORE_MS / 1000 + ' seconds early. ' +
			'Keeping your computer awake; keep the lid open.' +
			(state.restored ? ' (Kept after page refresh.)' : ''));
		setBadge(badgeTime(untilOpen), 'armed');
		setTitle('⏳ ' + formatShort(untilOpen));
	}

	function tickFiring(untilOpen) {
		if (!state.firingNotified) {
			state.firingNotified = true;
			notify('status', 'Anchor Down is enrolling', 'Sending your cart every 2 seconds until ' +
				formatClock(state.target + STOP_AFTER_MS) + '.');
		}
		if (cartDone()) {
			finish(true);
			return;
		}
		tryEnroll();
		setState('firing');
		setProgress((START_BEFORE_MS - untilOpen) / (START_BEFORE_MS + STOP_AFTER_MS));
		setText(el.countdown, formatDuration(untilOpen + STOP_AFTER_MS) + ' left');
		setStatus('Enrolling... attempt ' + state.attempts + '. ' + pageHours());
		setText(el.log, 'Sent at ' + state.attemptTimes.slice(-6).map(formatClock).join(', '));
		setBadge('GO', 'firing');
		setTitle('🔄 Enrolling (' + state.attempts + ')');
	}

	function start(target) {
		Object.assign(state, {
			target: target,
			attempts: 0,
			attemptTimes: [],
			baseline: null,
			baselineFinal: false,
			cart: null,
			lastKeepAlive: Date.now(),
			warned: target - Date.now() <= WARN_BEFORE_MS,
			firingNotified: false
		});
		save(target);
		el.time.value = toInputValue(target);
		setText(el.log, '');
		setWarn('');
		showClassResults(null);
		setProgress(null);
		if (target - Date.now() > START_BEFORE_MS) refreshBaseline();
		state.interval = setInterval(tick, TICK_MS);
		send({ type: 'schedule', target: target });
		el.arm.textContent = 'Cancel';
		tick();
	}

	function arm() {
		const target = readInput();
		if (!target) {
			setStatus('Pick your enrollment date and time first.');
			return;
		}
		if (target - Date.now() < START_BEFORE_MS) {
			setStatus('That time is too soon or already passed. Use Alt+X instead.');
			return;
		}
		state.restored = false;
		unlockAudio();
		clearNotification('result');
		start(target);
		notify('status', 'Anchor Down armed', 'Enrolling at ' + formatDate(target) +
			'. Your computer will stay awake until it finishes; keep the lid open.');
	}

	function stop() {
		send({ type: 'unschedule' });
		clearInterval(state.interval);
		state.interval = null;
		state.target = null;
		forget();
		el.arm.textContent = 'Arm';
	}

	function cancel() {
		stop();
		setState('idle');
		setText(el.countdown, '');
		setStatus('Cancelled. Alt+X still works.');
		setProgress(null);
		setBadge('', 'idle');
		document.title = originalTitle;
		clearNotification('status');
	}

	// Reports which classes went through by comparing the cart before and after,
	// with the hours as a backup if the cart can't be read.
	// early: stopped because the cart emptied, not because time ran out.
	function finish(early) {
		const attempts = state.attempts;
		const hoursBefore = state.baseline;
		const cartBefore = state.cart;
		stop();
		setProgress(1);
		setText(el.countdown, '');
		setStatus('Finished after ' + attempts + ' attempts. Checking your classes...');
		clearNotification('status');

		readHoursAndCart().then(function (now) {
			if (!now.hours) {
				showResult('done', 'Finished after ' + attempts + " attempts, but couldn't check your classes. Refresh the page to see your schedule.");
				return;
			}
			reportResult({
				attempts: attempts,
				early: early,
				hoursBefore: hoursBefore,
				hoursAfter: now.hours,
				cartBefore: cartBefore,
				cartAfter: now.cart
			});
		});
	}

	function reportResult(r) {
		const before = r.hoursBefore;
		const after = r.hoursAfter;
		const hours = 'Enrolled hours ' + (before ? before.enrolled + ' \u2192 ' : '') + after.enrolled +
			', waitlisted ' + (before ? before.waitlisted + ' \u2192 ' : '') + after.waitlisted + '.';
		const hoursUp = !!before && (after.enrolled > before.enrolled || after.waitlisted > before.waitlisted);
		const stoppedEarly = r.early ? 'Your cart is empty, so it stopped after ' + r.attempts + ' attempts. ' : '';
		const outcome = r.cartBefore && r.cartAfter && r.cartBefore.length > 0
			? compareCarts(r.cartBefore, r.cartAfter)
			: null;

		// Class by class, unless hours went up while the cart didn't change, which
		// would mean YES keeps enrolled classes in the cart.
		if (outcome && (outcome.through.length > 0 || !hoursUp)) {
			showClassResults(outcome);
			const total = r.cartBefore.length;
			if (outcome.left.length === 0) {
				showResult('success', 'Success! ' + stoppedEarly + 'All ' + total + ' ' + plural(total, 'class', 'classes') +
					' went through. ' + hours + ' Refresh to see which are enrolled and which are waitlisted.');
			} else if (outcome.through.length > 0) {
				showResult('partial', outcome.through.length + ' of ' + total + ' classes went through. Still in your cart: ' +
					names(outcome.left) + '. Enroll ' + plural(outcome.left.length, 'that one', 'those') + ' manually now. ' + hours);
			} else {
				showResult('nochange', 'No change. Nothing left your cart. ' + hours + ' Enroll manually now.');
			}
			return;
		}

		if (!before) {
			showResult('done', 'Finished after ' + r.attempts + ' attempts. ' + hours + ' Refresh to see your schedule.');
		} else if (hoursUp) {
			let why = "Your cart didn't change, so I can't tell which classes.";
			if (!r.cartBefore || r.cartBefore.length === 0) why = "I couldn't read your cart before it started, so I can't tell which classes.";
			else if (!r.cartAfter) why = "I couldn't read your cart afterward, so I can't tell which classes.";
			showResult('success', 'Success! ' + stoppedEarly + hours + ' ' + why + ' Refresh to check each one.');
		} else {
			showResult('nochange', 'No change. ' + hours + ' Enroll manually now.');
		}
	}

	// A class went through once none of its class numbers are left in the cart.
	function compareCarts(before, after) {
		const remaining = new Set();
		after.forEach(function (c) { c.numbers.forEach(function (n) { remaining.add(n); }); });
		const through = [];
		const left = [];
		before.forEach(function (c) {
			(c.numbers.some(function (n) { return remaining.has(n); }) ? left : through).push(c);
		});
		return { through: through, left: left };
	}

	// ---- Enrolling ----

	function tryEnroll() {
		if (Date.now() - previous_enrollment_time > COOLDOWN_MS) {
			state.attempts++;
			state.attemptTimes.push(Date.now());
			enroll();
			previous_enrollment_time = Date.now();
		}
	}

	// True once every class has left the cart (saved hours are 0) and enrolled or
	// waitlisted hours have gone up. Reads the hours on the page, which enroll.js
	// refreshes after every attempt, so it adds no extra requests. A class still
	// in the cart keeps saved hours above 0, so it keeps retrying.
	function cartDone() {
		if (!state.baseline || state.attempts === 0) return false;
		const saved = readPageNumber('savedHours');
		const enrolled = readPageNumber('enrolledHours');
		const waiting = readPageNumber('waitingHours');
		if (saved === null || enrolled === null || waiting === null) return false;
		return saved === 0 && (enrolled > state.baseline.enrolled || waiting > state.baseline.waitlisted);
	}

	// ---- Hours and login check ----

	// Rejects if the login has expired, because YES then returns a login page
	// instead of JSON.
	function getHours() {
		return fetch(HOURS_URL)
		.then(function (res) {
			if (!res.ok) throw new Error('HTTP ' + res.status);
			return res.json();
		})
		.then(function (r) {
			return {
				enrolled: Number(r.enrolled.classHours),
				waitlisted: Number(r.waitlisted.classHours),
				saved: Number(r.saved.classHours)
			};
		});
	}

	// Doubles as the login check and cart check while waiting.
	function refreshBaseline() {
		readHoursAndCart().then(function (now) {
			if (!state.target) return;  // cancelled meanwhile
			if (now.hours) state.baseline = now.hours;
			if (now.cart) state.cart = now.cart;
			showCheck(now);
		});
	}

	// The Check button: the same checks as arming, without arming.
	function checkNow() {
		setStatus('Checking your login and cart...');
		readHoursAndCart().then(function (now) {
			showCheck(now);
			if (!state.target) {
				setStatus(now.hours
					? 'Checked at ' + formatClock(Date.now()) + ' ' + TIME_ZONE_LABEL + '. Not armed.'
					: "Couldn't reach YES. Not armed.");
			}
		});
	}

	// Shows the login line, the cart, and any warnings.
	function showCheck(now) {
		setLogin(!!now.hours, now.hours);
		if (now.cart) {
			showCart(now.cart, now.hours);
		} else if (now.hours) {
			// Logged in, but the cart couldn't be read. (If logged out, the login
			// warning already covers it.)
			setText(el.cart, '');
			setWarn("Couldn't read your cart. Refresh the page if this keeps happening.");
		}
	}

	// Reads the hours and the cart together. Either is null if it couldn't be read.
	// YES leaves the cart section off the page when the cart is empty, so a
	// missing cart with 0 saved hours (while logged in) counts as an empty cart.
	function readHoursAndCart() {
		return Promise.allSettled([getHours(), readCart()]).then(function (results) {
			const hours = results[0].status === 'fulfilled' ? results[0].value : null;
			let cart = results[1].status === 'fulfilled' ? results[1].value : null;
			if (!cart && hours && hours.saved === 0) cart = [];
			return { hours: hours, cart: cart };
		});
	}

	// Reads the classes in the cart, the same way enroll.js does, plus each
	// class's name. Rejects if the cart isn't on the page (e.g. login expired).
	function readCart() {
		return fetch(CART_URL)
		.then(function (res) {
			if (!res.ok) throw new Error('HTTP ' + res.status);
			return res.text();
		})
		.then(function (html) {
			const doc = new DOMParser().parseFromString(html, 'text/html');
			const cart = doc.getElementById('StudentCartList_div');
			if (!doc.getElementById('selectedTermCodeHidden') || !cart) throw new Error('Cart not found');
			return Array.from(cart.getElementsByClassName('classTable'))
				.map(function (table) {
					const numbers = [];
					Array.from(table.getElementsByClassName('classSelection')).forEach(function (selection) {
						Array.from(selection.children).forEach(function (input) {
							const parts = (input.name || '').split('.');
							if (parts.length === 2 && parts[1] === 'classNumber') numbers.push(input.value);
						});
					});
					return { name: courseName(table, numbers), numbers: numbers };
				})
				.filter(function (c) { return c.numbers.length > 0; });
		});
	}

	// "CS 3251", from the same spans enroll.js reads; class numbers as a fallback.
	function courseName(table, numbers) {
		const left = table.getElementsByClassName('left')[0];
		const nodes = left ? left.childNodes : [];
		const parts = [nodes[1], nodes[3]]
			.map(function (n) { return n ? n.textContent.trim() : ''; })
			.filter(Boolean);
		return parts.length ? parts.join(' ') : 'Class ' + numbers.join('/');
	}

	// Lists the cart in the panel and warns about an empty cart, two sections of
	// the same course, or going over the hours limit.
	function showCart(classes, hours) {
		setText(el.cart, classes.length
			? 'In your cart (' + classes.length + '): ' + names(classes)
			: '');
		const counts = {};
		classes.forEach(function (c) { counts[c.name] = (counts[c.name] || 0) + 1; });
		const dupes = Object.keys(counts).filter(function (n) { return counts[n] > 1; });
		const warnings = [];
		if (classes.length === 0) {
			warnings.push('Your cart is empty. Add your classes before your time.');
		}
		if (dupes.length) {
			warnings.push('More than one section of ' + dupes.join(', ') +
				' is in your cart, and it will try to enroll in all of them. Remove the ones you don\'t want.');
		}
		const total = hours ? hours.enrolled + hours.saved : 0;
		if (total > MAX_HOURS) {
			warnings.push('Your classes plus your cart come to ' + total + ' hours, over the usual ' + MAX_HOURS +
				'-hour limit, so YES may turn some down.');
		}
		setWarn(warnings.join(' '));
	}

	function setLogin(ok, hours) {
		const time = formatClock(Date.now());
		setText(el.login, ok
			? '✓ Logged in, checked ' + time + '. Enrolled ' + hours.enrolled + ' hrs, waitlisted ' + hours.waitlisted + ' hrs.'
			: '✗ Login check failed at ' + time + '.');
		if (ok && state.loginOk === false) {
			setNote('');
			clearNotification('login');
		} else if (!ok) {
			setNote(MESSAGES.loginExpired + (state.target ? MESSAGES.stillArmed : ''));
			if (state.target && state.loginOk !== false) {
				notify('login', 'YES login may have expired', 'Refresh the YES page. The timer stays armed.', true);
			}
		}
		state.loginOk = ok;
	}

	// ---- Result ----

	// Shows the result in the panel, toolbar badge, tab title, a notification
	// that stays until dismissed, and a sound.
	function showResult(stateName, message) {
		const good = stateName === 'success';
		setText(el.cart, '');
		setWarn('');
		setState(stateName);
		setStatus(message);
		setBadge(good ? '✓' : '!', stateName);
		document.title = (good ? '✅ ' : '⚠️ ') + 'Anchor Down finished · ' + originalTitle;
		notify('result', good ? 'Anchor Down: success' : 'Anchor Down finished', message, true);
		beep(good);
	}

	// One line per class: went through, or still in the cart. null clears it.
	function showClassResults(outcome) {
		el.classes.textContent = '';
		el.classes.hidden = !outcome;
		if (!outcome) return;
		outcome.through.forEach(function (c) { addClassLine('\u2713 ' + c.name + ': enrolled or waitlisted', 'ad-ok'); });
		outcome.left.forEach(function (c) { addClassLine('\u2717 ' + c.name + ': still in your cart', 'ad-bad'); });
	}

	function addClassLine(text, className) {
		const li = document.createElement('li');
		li.className = className;
		li.textContent = text;
		el.classes.appendChild(li);
	}

	// ---- Notifications, badge and tab title ----
	// Notifications and the badge go through background.js, which shows them
	// even when this tab is hidden.

	function send(msg) {
		try {
			chrome.runtime.sendMessage(msg).catch(function () {});
		} catch (e) {
			// Extension was reloaded; this page needs a refresh to reconnect.
		}
	}

	function notify(id, title, message, sticky) {
		send({ type: 'notify', id: id, title: title, message: message, sticky: !!sticky });
	}

	function clearNotification(id) {
		send({ type: 'clear', id: id });
	}

	function setBadge(text, stateName) {
		if (text === lastBadge) return;
		lastBadge = text;
		send({ type: 'badge', text: text, color: STATES[stateName].color });
	}

	function setTitle(prefix) {
		const title = prefix + ' · ' + originalTitle;
		if (document.title !== title) document.title = title;
	}

	// ---- Sound ----
	// Chrome only allows sound after a click on the page, so this unlocks on Arm
	// and on the first click after a refresh.

	function unlockAudio() {
		try {
			audio = audio || new (window.AudioContext || window.webkitAudioContext)();
			audio.resume();
		} catch (e) {
			// No audio available; the other alerts still work.
		}
	}

	function beep(good) {
		if (!audio) return;
		try {
			const t = audio.currentTime;
			(good ? [660, 880] : [440, 330]).forEach(function (freq, i) {
				const osc = audio.createOscillator();
				const gain = audio.createGain();
				const startAt = t + i * 0.25;
				osc.frequency.value = freq;
				gain.gain.setValueAtTime(0.2, startAt);
				gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.22);
				osc.connect(gain);
				gain.connect(audio.destination);
				osc.start(startAt);
				osc.stop(startAt + 0.23);
			});
		} catch (e) {
			// Sound is a nice-to-have; ignore failures.
		}
	}

	// ---- Refresh survival ----
	// The armed time lives in sessionStorage, so it's kept for this tab only.

	function save(target) {
		try { sessionStorage.setItem(STORAGE_KEY, String(target)); } catch (e) { /* storage blocked */ }
	}

	function forget() {
		try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* storage blocked */ }
	}

	function restore() {
		let target;
		try { target = Number(sessionStorage.getItem(STORAGE_KEY)); } catch (e) { return; }
		if (!target) return;
		if (Date.now() - target >= STOP_AFTER_MS) {
			forget();
			return;
		}
		state.restored = true;
		start(target);
	}

	// ---- Panel ----

	const PANEL_HTML = `
		<div class="ad-header">
			<span class="ad-title">Anchor Down</span>
			<button type="button" class="ad-min" id="anchorDownMin" title="Minimize">–</button>
		</div>
		<div class="ad-content">
			<div class="ad-row">
				<span class="ad-state">
					<span class="ad-dot" id="anchorDownDot"></span>
					<span id="anchorDownState"></span>
				</span>
				<span class="ad-countdown" id="anchorDownCountdown"></span>
			</div>
			<div class="ad-progress" id="anchorDownProgress" hidden>
				<div class="ad-progress-fill" id="anchorDownProgressFill"></div>
			</div>
			<div class="ad-body" id="anchorDownBody">
				<label class="ad-label">Enrollment date and time (Central)
					<input type="datetime-local" step="1" id="anchorDownTime">
				</label>
				<div class="ad-buttons">
					<button type="button" class="ad-arm" id="anchorDownArm">Arm</button>
					<button type="button" class="ad-check" id="anchorDownCheck" title="Check your login and cart without arming">Check</button>
				</div>
			</div>
			<div class="ad-status" id="anchorDownStatus"></div>
			<ul class="ad-classes" id="anchorDownClasses" hidden></ul>
			<div class="ad-warn" id="anchorDownWarn"></div>
			<div class="ad-small" id="anchorDownCart"></div>
			<div class="ad-small" id="anchorDownLogin"></div>
			<div class="ad-small" id="anchorDownLog"></div>
			<div class="ad-note" id="anchorDownNote"></div>
		</div>`;

	function buildPanel() {
		const panel = document.createElement('div');
		panel.id = 'anchorDownPanel';
		panel.innerHTML = PANEL_HTML;
		document.body.appendChild(panel);

		const byId = function (id) { return document.getElementById(id); };
		Object.assign(el, {
			panel: panel,
			header: panel.querySelector('.ad-header'),
			min: byId('anchorDownMin'),
			dot: byId('anchorDownDot'),
			state: byId('anchorDownState'),
			countdown: byId('anchorDownCountdown'),
			progress: byId('anchorDownProgress'),
			progressFill: byId('anchorDownProgressFill'),
			body: byId('anchorDownBody'),
			time: byId('anchorDownTime'),
			arm: byId('anchorDownArm'),
			check: byId('anchorDownCheck'),
			status: byId('anchorDownStatus'),
			classes: byId('anchorDownClasses'),
			warn: byId('anchorDownWarn'),
			cart: byId('anchorDownCart'),
			login: byId('anchorDownLogin'),
			log: byId('anchorDownLog'),
			note: byId('anchorDownNote')
		});

		setState('idle');
		setStatus(MESSAGES.idle);

		// Default to today at 7:00:00 AM Central.
		const today = zonedParts(Date.now());
		el.time.value = toInputValue(zonedToMs(today.year, today.month, today.day, 7, 0, 0));

		el.arm.addEventListener('click', function () {
			if (state.interval) cancel();
			else arm();
		});
		el.check.addEventListener('click', checkNow);

		// Minimize hides the picker and button but keeps the state and status visible.
		el.min.addEventListener('click', function () {
			el.body.hidden = !el.body.hidden;
			el.min.textContent = el.body.hidden ? '+' : '–';
			el.min.title = el.body.hidden ? 'Expand' : 'Minimize';
		});

		enableDragging();

		// After a refresh, the first click on the page re-enables the finish sound.
		document.addEventListener('pointerdown', unlockAudio, { once: true });

		// Ticks from background.js keep the timer on time while this tab is in
		// the background.
		chrome.runtime.onMessage.addListener(function (message) {
			if (message && message.command === 'tick') tick();
		});
	}

	// Drag the panel by its header, kept inside the window.
	function enableDragging() {
		el.header.addEventListener('pointerdown', function (e) {
			if (e.target === el.min) return;
			const rect = el.panel.getBoundingClientRect();
			const offsetX = e.clientX - rect.left;
			const offsetY = e.clientY - rect.top;
			el.header.setPointerCapture(e.pointerId);

			function move(ev) {
				const x = Math.min(Math.max(0, ev.clientX - offsetX), window.innerWidth - el.panel.offsetWidth);
				const y = Math.min(Math.max(0, ev.clientY - offsetY), window.innerHeight - el.panel.offsetHeight);
				el.panel.style.left = x + 'px';
				el.panel.style.top = y + 'px';
				el.panel.style.bottom = 'auto';
			}
			function up() {
				el.header.removeEventListener('pointermove', move);
				el.header.removeEventListener('pointerup', up);
			}
			el.header.addEventListener('pointermove', move);
			el.header.addEventListener('pointerup', up);
		});
	}

	function setState(name) {
		const s = STATES[name];
		el.dot.style.background = s.color;
		el.dot.classList.toggle('is-firing', name === 'firing');
		el.state.textContent = s.label;
		el.state.style.color = s.color;
	}

	// fraction: 0 to 1, or null to hide the bar.
	function setProgress(fraction) {
		el.progress.hidden = fraction === null;
		if (fraction !== null) {
			el.progressFill.style.width = Math.min(100, Math.max(0, fraction * 100)) + '%';
		}
	}

	function setText(node, text) { node.textContent = text; }
	function setStatus(text) { setText(el.status, text); }
	function setNote(text) { setText(el.note, text); }
	function setWarn(text) { setText(el.warn, text); }

	function names(classes) {
		return classes.map(function (c) { return c.name; }).join(', ');
	}

	function plural(n, one, many) { return n === 1 ? one : many; }

	// ---- Page hours ----

	// The hours YES shows on the page, which enroll.js updates after every attempt.
	function pageHours() {
		const enrolled = document.getElementById('enrolledHours');
		const waiting = document.getElementById('waitingHours');
		if (!enrolled || !waiting || !enrolled.textContent) return '';
		return 'Page shows ' + enrolled.textContent + ' enrolled, ' + waiting.textContent + ' waitlisted hrs.';
	}

	function readPageNumber(id) {
		const node = document.getElementById(id);
		if (!node || node.textContent.trim() === '') return null;
		const n = Number(node.textContent.trim());
		return isNaN(n) ? null : n;
	}

	// ---- Formatting ----

	function pad(n) { return String(n).padStart(2, '0'); }

	// ---- Central time ----
	// The picker and every time shown are Central, since that's what YES uses,
	// even when the laptop is set to another time zone.

	const zoneFormat = new Intl.DateTimeFormat('en-US', {
		timeZone: TIME_ZONE, hourCycle: 'h23',
		year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
	});

	// ms -> { year, month, day, hour, minute, second } as a Central clock shows it.
	function zonedParts(ms) {
		const parts = {};
		zoneFormat.formatToParts(new Date(ms)).forEach(function (p) {
			if (p.type !== 'literal') parts[p.type] = Number(p.value);
		});
		return parts;
	}

	// How far Central time is ahead of UTC at that moment (negative, e.g. -5h).
	function zoneOffset(ms) {
		const p = zonedParts(ms);
		return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
	}

	// A Central date and time -> ms. Checked twice in case of a daylight saving change.
	function zonedToMs(year, month, day, hour, minute, second) {
		const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
		const first = asUtc - zoneOffset(asUtc);
		return asUtc - zoneOffset(first);
	}

	// ms -> "YYYY-MM-DDTHH:MM:SS" in Central time, for the picker.
	function toInputValue(ms) {
		const p = zonedParts(ms);
		return p.year + '-' + pad(p.month) + '-' + pad(p.day) +
			'T' + pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second);
	}

	// The picker's "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS", read as Central.
	function readInput() {
		const value = el.time.value;
		if (!value) return null;
		const date = value.split('T')[0].split('-').map(Number);
		const time = value.split('T')[1].split(':').map(Number);
		return zonedToMs(date[0], date[1], date[2], time[0], time[1], time[2] || 0);
	}

	// "Mon, Nov 2, 7:00:00 AM CT", plus the laptop's own time if it isn't Central:
	// "Mon, Nov 2, 7:00:00 AM CT (Mon 5:00:00 AM your time)"
	function formatDate(ms) {
		const central = new Date(ms).toLocaleString([], {
			timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric',
			hour: 'numeric', minute: '2-digit', second: '2-digit'
		}) + ' ' + TIME_ZONE_LABEL;
		const localOffset = -new Date(ms).getTimezoneOffset() * 60000;
		if (localOffset === zoneOffset(ms)) return central;
		return central + ' (' + new Date(ms).toLocaleString([], {
			weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit'
		}) + ' your time)';
	}

	// "7:00:00 AM", Central.
	function formatClock(ms) {
		return new Date(ms).toLocaleTimeString([], {
			timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', second: '2-digit'
		});
	}

	// "1d 2h 3m 4s"
	function formatDuration(ms) {
		let s = Math.max(0, Math.ceil(ms / 1000));
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		s = s % 60;
		return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + (d || h || m ? m + 'm ' : '') + s + 's';
	}

	// "1:02:03" or "4:57", for the tab title.
	function formatShort(ms) {
		let s = Math.max(0, Math.ceil(ms / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		s = s % 60;
		return (h ? h + ':' + pad(m) : m) + ':' + pad(s);
	}

	// Badge text has room for about 4 characters: "2d", "3h", "12m", "45s".
	function badgeTime(ms) {
		const s = Math.ceil(ms / 1000);
		if (s >= 86400) return Math.floor(s / 86400) + 'd';
		if (s >= 3600) return Math.floor(s / 3600) + 'h';
		if (s >= 60) return Math.floor(s / 60) + 'm';
		return s + 's';
	}

	buildPanel();
	restore();
})();
