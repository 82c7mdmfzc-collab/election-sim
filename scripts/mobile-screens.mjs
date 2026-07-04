/**
 * Mobile screen audit harness (companion to check-mobile-native.mjs).
 *
 * Drives the NATIVE landscape app through every reachable screen/state and captures
 * a screenshot of each to /tmp/elector-mobile-audit/, asserting no document overflow.
 * Real app routes/state are the primary evidence; a few genuinely hard-to-drive
 * states (signed-in shop, online lobby) fall back to injecting the real component
 * markup against the built CSS — those are captured with an `injected:true` flag and
 * clearly labeled in the manifest.
 *
 * Unlike check-mobile-native.mjs (the strict CI gate for the board) this is an audit
 * tool: it never aborts on a single failure, so the full set of screenshots + a
 * per-screen status manifest are always produced.
 *
 * Run: npm run build && node scripts/mobile-screens.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const PORT = 4178;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT_DIR = '/tmp/elector-mobile-audit';

// Landscape rotations of the brief's portrait targets (the app is landscape-locked).
const VIEWPORTS = [
  { width: 740, height: 360, name: '360x740' },
  { width: 844, height: 390, name: '390x844' },
  { width: 852, height: 393, name: '393x852' },
  { width: 932, height: 430, name: '430x932' },
];
const REP = VIEWPORTS[1]; // representative size for expensive single-run drives
const PORTRAIT = { width: 390, height: 844, name: '390x844-portrait' };

const PREFS = {
  tutorialSeen: true,
  muted: true,
  lastAwardedGameId: null,
  selectedVictoryMessage: 'classic',
  pendingReferralCode: null,
  firstRunCoachDismissed: false,
  blockedPlayers: [],
  notifPermissionAsked: false,
};

const manifest = []; // { viewport, screen, status: 'ok'|'overflow'|'injected'|'injected-overflow', v, h }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(proc) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (proc.exitCode != null) throw new Error('vite preview exited before serving');
    try { const res = await fetch(URL); if (res.ok) return; } catch { /* keep waiting */ }
    await wait(250);
  }
  throw new Error('timed out waiting for vite preview');
}

async function applyNative(page) {
  await page.evaluate((prefs) => {
    document.documentElement.classList.add('native');
    localStorage.setItem('election-sim-prefs-v1', JSON.stringify(prefs));
  }, PREFS);
}

const overflow = (page) => page.evaluate(() => {
  const el = document.scrollingElement ?? document.documentElement;
  return { v: el.scrollHeight - el.clientHeight, h: el.scrollWidth - el.clientWidth };
});

async function clickByText(page, selector, text) {
  return page.evaluate((selectorArg, textArg) => {
    const wanted = textArg.toLowerCase();
    const el = [...document.querySelectorAll(selectorArg)]
      .find((node) => (node.textContent ?? '').toLowerCase().includes(wanted));
    if (!(el instanceof HTMLElement)) return false;
    el.click();
    return true;
  }, selector, text);
}

/** Screenshot + record overflow. `injected` marks fallback (non-real-route) captures. */
async function capture(page, viewportName, screen, { injected = false } = {}) {
  await wait(180);
  await page.screenshot({ path: `${OUT_DIR}/${viewportName}-${screen}.png` });
  const o = await overflow(page);
  const bad = o.v > 1 || o.h > 1;
  const status = injected ? (bad ? 'injected-overflow' : 'injected') : (bad ? 'overflow' : 'ok');
  manifest.push({ viewport: viewportName, screen, status, v: o.v, h: o.h });
  const mark = injected ? '◌(injected)' : (bad ? `⚠ overflow v=${o.v} h=${o.h}` : '✓');
  console.log(`  ${bad ? '⚠' : '·'} ${screen} ${mark}`);
}

/** Tap the largest on-screen state path; returns true if a state card opened. */
async function tapState(page) {
  const targets = await page.evaluate(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    return [...document.querySelectorAll('.rsm-geography')]
      .map((p) => { const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, a: r.width * r.height, r }; })
      .filter((t) => t.r.top > vh * 0.18 && t.r.bottom < vh * 0.92 && t.x > vw * 0.12 && t.x < vw * 0.72)
      .sort((a, b) => b.a - a.a)
      .slice(0, 6)
      .map((t) => ({ x: t.x, y: t.y }));
  });
  for (const t of targets) {
    await page.mouse.click(t.x, t.y);
    await wait(220);
    if (await page.$('.state-card')) return true;
  }
  return false;
}

async function load(page, viewport) {
  await page.setViewport({ ...viewport, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await applyNative(page);
  await page.reload({ waitUntil: 'networkidle0' });
  await applyNative(page);
  await wait(300);
}

async function startSoloGame(page) {
  if (!(await page.$('button.landing__guest'))) return false;
  await page.click('button.landing__guest');
  await wait(700);
  await applyNative(page);
  return true;
}

/** Comprehensive per-viewport pass over menus + in-game overlays (all real routes). */
async function auditSession(browser, viewport) {
  console.log(`\n▶ ${viewport.name} (${viewport.width}×${viewport.height})`);
  const page = await browser.newPage();
  await load(page, viewport);

  await capture(page, viewport.name, 'landing');

  if (await startSoloGame(page)) {
    // Versus intro (capture before dismissing)
    if (await page.$('.versus')) {
      await capture(page, viewport.name, 'versus');
      await page.click('.versus'); await wait(400);
    }
    await page.waitForSelector('.shell', { timeout: 5_000 }).catch(() => {});
    await capture(page, viewport.name, 'board');

    // State detail card (tap a state on the map)
    if (await tapState(page)) {
      await capture(page, viewport.name, 'state-card');
      await page.click('.state-card__close').catch(() => {});
      await page.evaluate(() => document.querySelector('.popover-backdrop')?.click());
      await wait(250);
    } else {
      console.log('  – state-card: no tappable state found');
    }

    // National / State / Options bottom sheets
    for (const [label, key] of [['National', 'national'], ['State', 'state']]) {
      if (await clickByText(page, '.native-round-action', label)) {
        await wait(380);
        await capture(page, viewport.name, `sheet-${key}`);
        await page.click('.native-game-sheet__close').catch(() => {});
        await wait(220);
      }
    }
    if (await page.$('.native-corner--right')) {
      await page.click('.native-corner--right'); await wait(360);
      await capture(page, viewport.name, 'sheet-options');
      // Options → Help (the "?" icon) opens How-to-Play. Click the *visible*
      // help button (a hidden desktop HeaderHud copy also exists, display:none).
      const helpOpened = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.help-btn')].find((el) => el.offsetParent !== null);
        if (!b) return false; b.click(); return true;
      });
      if (helpOpened) {
        await wait(420);
        if (await page.$('.howto')) await capture(page, viewport.name, 'how-to-play');
        await page.evaluate(() => document.querySelector('.howto__close')?.click());
        await wait(220);
      }
      await page.evaluate(() => document.querySelector('.native-game-sheet__close')?.click());
      await wait(220);
    }

    // Player profile modal (tap the active player tray)
    if (await page.$('.native-active-tray')) {
      await page.click('.native-active-tray'); await wait(360);
      if (await page.$('.profile-modal')) await capture(page, viewport.name, 'profile-modal');
      await page.click('.profile-modal__close').catch(() => {});
      await wait(220);
    }

    // Turn resolution recap (end the turn → the bot's purchases tick through)
    const turnBtn = await page.$('.native-turn-button:not([disabled])');
    if (turnBtn) {
      await turnBtn.click();
      for (let i = 0; i < 8 && !(await page.$('.round-resolution')); i += 1) await wait(300);
      if (await page.$('.round-resolution')) await capture(page, viewport.name, 'round-resolution');
      // let the ticker dismiss
      await page.evaluate(() => document.querySelector('.res-skip-btn')?.click());
      await wait(400);
    }

    // Exit → solo setup → home menu
    if (await page.$('.native-corner--left')) {
      await page.click('.native-corner--left');
      await page.waitForSelector('.setup--bot', { timeout: 4_000 }).catch(() => {});
      await wait(380);
      await capture(page, viewport.name, 'setup-bot');

      if (await page.$('.setup--bot .mp-back')) {
        await page.click('.setup--bot .mp-back');
        await page.waitForSelector('.home', { timeout: 4_000 }).catch(() => {});
        await wait(360);
        await capture(page, viewport.name, 'home');

        // How to Play (Tutorial) from the home link
        if (await clickByText(page, '.home__link', 'how to play')) {
          await page.waitForSelector('.tutorial', { timeout: 4_000 }).catch(() => {});
          await wait(360);
          if (await page.$('.tutorial')) await capture(page, viewport.name, 'tutorial');
          await page.evaluate(() => document.querySelector('.tutorial__skip')?.click());
          await page.waitForSelector('.home', { timeout: 4_000 }).catch(() => {});
          await wait(300);
        }

        // Pass & Play candidate select
        if (await clickByText(page, '.menu-btn', 'Pass')) {
          await wait(420);
          await capture(page, viewport.name, 'passplay-select');
          await page.evaluate(() => document.querySelector('.mp-back, .setup__back')?.click());
          await page.waitForSelector('.home', { timeout: 4_000 }).catch(() => {});
          await wait(300);
        }

        // Online menu
        if (await clickByText(page, '.menu-btn', 'Online')) {
          await wait(420);
          await capture(page, viewport.name, 'online-menu');
          await page.evaluate(() => document.querySelector('.mp-back, .mp-menu__back, .setup__back')?.click());
          await page.waitForSelector('.home', { timeout: 4_000 }).catch(() => {});
          await wait(300);
        }

        // Daily
        if (await clickByText(page, '.menu-btn', 'Daily')) {
          await page.waitForSelector('.setup--daily', { timeout: 4_000 }).catch(() => {});
          await wait(380);
          await capture(page, viewport.name, 'daily');
          await page.evaluate(() => document.querySelector('.setup--daily .mp-back')?.click());
          await page.waitForSelector('.home', { timeout: 4_000 }).catch(() => {});
          await wait(300);
        }

        // Shop gate (guest)
        if (await clickByText(page, '.menu-btn', 'Shop')) {
          await wait(450);
          await capture(page, viewport.name, 'shop-gate');
        }
      }
    }
  }
  await page.close();
}

/** Best-effort: drive a 4-player game through election → tally → victory. */
async function auditEndgame(browser, viewport) {
  console.log(`\n▶ ${viewport.name}: endgame drive (election → tally → victory)`);
  const page = await browser.newPage();
  await load(page, viewport);
  if (!(await startSoloGame(page))) { await page.close(); return; }
  if (await page.$('.versus')) { await page.click('.versus'); await wait(400); }
  // bump to 3 opponents for a faster, eliminating endgame
  if (await page.$('.native-corner--left')) {
    await page.click('.native-corner--left');
    await page.waitForSelector('.setup--bot', { timeout: 4_000 }).catch(() => {});
    await page.evaluate(() => {
      const grp = document.querySelectorAll('.setup__count')[0];
      [...(grp?.querySelectorAll('.setup__count-btn') ?? [])].find((b) => b.textContent.trim() === '3')?.click();
    });
    await wait(250);
    const started = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.setup--bot .setup__start, .setup--bot .cand-select__start')]
        .find((el) => !el.disabled && el.offsetParent !== null);
      if (b instanceof HTMLElement) { b.click(); return true; }
      return false;
    });
    if (started) {
      await wait(700); await applyNative(page);
      if (await page.$('.versus')) { await page.click('.versus'); await wait(400); }
    } else {
      console.log('  – endgame: could not restart 4-player bot setup');
    }
  }
  let gotElection = false, gotTally = false;
  for (let i = 0; i < 240; i += 1) {
    if (await page.$('.victory-podium')) break;
    if (!gotTally && (await page.$('.tally-view'))) { gotTally = true; await capture(page, viewport.name, 'tally'); }
    const elec = await page.$('.election-overlay');
    if (elec) {
      if (!gotElection) { gotElection = true; await capture(page, viewport.name, 'election-overlay'); }
      await page.click('.election-overlay__btn').catch(() => {}); await wait(650); continue;
    }
    const btn = await page.$('.native-turn-button:not([disabled])');
    if (btn) { await btn.click(); await wait(520); continue; }
    await wait(380);
  }
  if (await page.$('.victory-podium')) await capture(page, viewport.name, 'victory');
  else console.log(`  – victory: not reached (election=${gotElection} tally=${gotTally})`);
  await page.close();
}

/** Pass-and-play 2-human game → end a turn → handoff curtain. */
async function auditHandoff(browser, viewport) {
  console.log(`\n▶ ${viewport.name}: pass-and-play handoff`);
  const page = await browser.newPage();
  await load(page, viewport);
  if (!(await startSoloGame(page))) { await page.close(); return; }
  if (await page.$('.versus')) { await page.click('.versus'); await wait(400); }
  // Exit to menu, choose Pass & Play, start a 2-human game
  if (await page.$('.native-corner--left')) {
    await page.click('.native-corner--left');
    await page.waitForSelector('.setup--bot', { timeout: 4_000 }).catch(() => {});
    await page.evaluate(() => document.querySelector('.setup--bot .mp-back')?.click());
    await page.waitForSelector('.home', { timeout: 4_000 }).catch(() => {});
    await wait(300);
  }
  await clickByText(page, '.menu-btn', 'Pass');
  await wait(500);
  // CandidateSelect: assign candidates to the open seats (tap unlocked rail cards),
  // then press Start.
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.setup__roster .cand-card:not(.is-locked)')];
    for (const c of cards.slice(0, 4)) c.click();
  });
  await wait(300);
  const started = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.setup__start, .cand-select__start')]
      .find((el) => !el.disabled && el.offsetParent !== null);
    if (b instanceof HTMLElement) { b.click(); return true; }
    return false;
  });
  if (started) {
    await wait(700); await applyNative(page);
    if (await page.$('.versus')) { await page.click('.versus'); await wait(400); }
    const btn = await page.$('.native-turn-button:not([disabled])');
    if (btn) {
      await btn.click();
      for (let i = 0; i < 8 && !(await page.$('.handoff')); i += 1) await wait(300);
      if (await page.$('.handoff')) await capture(page, viewport.name, 'handoff');
      else console.log('  – handoff: not shown (setup may need 2 humans)');
    }
  } else {
    console.log('  – handoff: could not start pass-and-play');
  }
  await page.close();
}

/** Labeled-injection fallback for account/backend-gated screens. */
async function auditInjected(browser, viewport) {
  console.log(`\n▶ ${viewport.name}: injected fallbacks (labeled)`);
  const page = await browser.newPage();
  await load(page, viewport);

  const playerRow = (name, candidate, color, badge = '') => `
    <div class="mp-player-row" style="--p-color:${color}">
      <span class="mp-player-token cand-token">${name.slice(0, 2).toUpperCase()}</span>
      <span class="mp-player-name">${name}</span>
      <span class="mp-player-cand">${candidate}</span>
      ${badge ? `<span class="mp-player-badge">${badge}</span>` : ''}
    </div>`;

  // Online lobby waiting host — real class composition for the compact native layout.
  await page.evaluate((rows) => {
    document.body.innerHTML = `
      <div class="setup native-screen mp-screen mp-screen--waiting mp-screen--waiting-host">
        <div class="setup__header"><h1 class="setup__title">Waiting for players to join…</h1></div>
        <div class="mp-wait">
          <div class="mp-wait__code-label">Your room code</div>
          <div class="mp-wait__code">7075</div>
          <p class="mp-wait__hint">Share this code with friends — they each join on their own device.</p>
          <div class="mp-players">${rows}<div class="mp-player-row mp-player-row--empty">Open seat</div></div>
          <div class="mp-bot-panel">
            <div class="mp-bot-panel__head"><span>Computer Seats</span><strong>1/3</strong></div>
            <div class="mp-bot-panel__controls">
              <div class="mp-bot-difficulty"><button class="mp-bot-difficulty__btn">Easy</button><button class="mp-bot-difficulty__btn is-active">Medium</button><button class="mp-bot-difficulty__btn">Hard</button><button class="mp-bot-difficulty__btn">Impossible</button></div>
              <button class="mp-bot-add">Add Computer</button>
            </div>
            <div class="mp-bot-list"><div class="mp-bot-chip"><span class="mp-bot-chip__avatar cand-token">AI</span><span class="mp-bot-chip__text"><strong>Donald Trump</strong><em>medium</em></span><button class="mp-bot-chip__remove">Remove</button></div></div>
          </div>
        </div>
        <div class="setup__foot mp-wait-actions"><button class="setup__start">Waiting for 1 more player(s)…</button><button class="mp-back">← Leave</button></div>
      </div>`;
  }, [
    playerRow('Dannytooley01', 'Bobby Tooley', '#22c55e', 'Host'),
    playerRow('Kamala Fan', 'Kamala Harris', '#3b82f6'),
    playerRow('AI_1', 'Donald Trump', '#ef4444', 'Computer'),
  ].join(''));
  await wait(150);
  await capture(page, viewport.name, 'online-waiting-host', { injected: true });

  // Online lobby waiting guest.
  await page.evaluate((rows) => {
    document.body.innerHTML = `
      <div class="setup native-screen mp-screen mp-screen--waiting mp-screen--waiting-guest">
        <div class="setup__header"><h1 class="setup__title">Waiting for the host…</h1></div>
        <div class="mp-wait">
          <div class="mp-wait__code-label">Your room code</div>
          <div class="mp-wait__code">1907</div>
          <p class="mp-wait__hint">Sit tight — the game starts when the host is ready.</p>
          <div class="mp-players">${rows}<div class="mp-player-row mp-player-row--empty">Open seat</div><div class="mp-player-row mp-player-row--empty">Open seat</div></div>
        </div>
        <div class="setup__foot mp-wait-actions"><button class="mp-back">← Leave</button></div>
      </div>`;
  }, [
    playerRow('Dannytooley01', 'Bobby Tooley', '#22c55e', 'Host'),
    playerRow('Trump Card', 'Donald Trump', '#ef4444'),
  ].join(''));
  await wait(150);
  await capture(page, viewport.name, 'online-waiting-guest', { injected: true });

  // Online candidate picking with existing players.
  await page.evaluate((existingRows) => {
    const card = (name, tag, color, state = '') => `
      <button class="shop-card${state}" style="--p-color:${color}">
        <div class="shop-card__top"><div class="shop-card__portrait"></div><div><span class="shop-card__name">${name}</span><span class="shop-card__tag">${tag}</span></div></div>
        <div class="shop-card__foot"><span class="shop-card__stats-hint">View stats ›</span></div>
      </button>`;
    document.body.innerHTML = `
      <div class="setup native-screen mp-screen mp-screen--picking">
        <div class="setup__header"><h1 class="setup__title">Room 7075</h1></div>
        <div class="cand-select-body">
          <div class="mp-existing-players"><span class="mp-existing-players__label">Already here</span>${existingRows}</div>
          <p class="shop__sub cand-select-body__hint">Tap a candidate to review their bonuses, then choose. Greyed-out candidates are already taken.</p>
          <div class="shop__grid shop-rail">
            ${card('Bobby Tooley', 'Taken', '#22c55e', ' is-locked')}
            ${card('Donald Trump', 'Media shockwave', '#ef4444')}
            ${card('Kamala Harris', 'Ground game', '#3b82f6')}
            ${card('JFK', 'Charisma machine', '#f59e0b')}
          </div>
        </div>
        <div class="setup__foot"><button class="setup__start">Join Game</button><button class="mp-back">← Use a different code</button></div>
      </div>`;
  }, playerRow('Dannytooley01', 'Bobby Tooley', '#22c55e', 'Host'));
  await wait(150);
  await capture(page, viewport.name, 'online-picking', { injected: true });

  // Online joining with public lobby list.
  await page.evaluate(() => {
    const row = (code, count, cta) => `<li><button class="mp-public__row"><span class="mp-public__code">Room ${code}</span><span class="mp-public__count">${count} players</span><span class="mp-public__cta">${cta}</span></button></li>`;
    document.body.innerHTML = `
      <div class="setup native-screen mp-screen mp-screen--joining">
        <div class="setup__header"><h1 class="setup__title">Join a Game</h1></div>
        <div class="mp-join">
          <p class="mp-join__hint">Got a code? Enter it below</p>
          <div class="mp-join__row"><input class="mp-join__input" value="7075" /><button class="setup__start">Join Game</button></div>
          <div class="mp-public">
            <div class="mp-public__head"><span class="mp-public__title">Open public games</span><button class="mp-public__refresh">↻ Refresh</button></div>
            <ul class="mp-public__list">${row('7075', '3/4', 'Join →')}${row('1907', '2/4', 'Join →')}${row('4512', '4/4', 'Full')}</ul>
          </div>
          <button class="mp-back">← Back</button>
        </div>
      </div>`;
  });
  await wait(150);
  await capture(page, viewport.name, 'online-joining', { injected: true });

  // Signed-in shop interior (recruit tab) — real markup, account-gated route.
  await page.evaluate(() => {
    document.body.innerHTML = `
      <div class="shop native-screen">
        <div class="shop__header"><button class="mp-back">← Back</button><h1 class="shop__title">Campaign Shop</h1><span class="shop__balance">9,000</span></div>
        <div class="shop__tabs native-only" role="tablist"><button class="shop__tab is-active">Recruit</button><button class="shop__tab">Funds</button><button class="shop__tab">Cosmetics</button><button class="shop__tab">Earn</button></div>
        <div class="shop__body"><section class="shop__pane shop__pane--recruit is-active"><h2 class="shop__section">Recruit Candidates</h2><div class="shop__grid shop-rail">
        ${Array.from({ length: 6 }).map((_, i) => `<div class="shop-card"><div class="shop-card__top"><div class="shop-card__portrait"></div><div><span class="shop-card__name">Candidate ${i + 1}</span><span class="shop-card__tag">A tagline here</span></div></div><div class="shop-card__cash">$300k starting cash</div><button class="shop-card__buy">1,500 Funds</button></div>`).join('')}
        </div></section></div>
      </div>`;
  });
  await wait(150);
  await capture(page, viewport.name, 'shop-recruit', { injected: true });

  // Election tally roll-call — verifies the safe-area insets added this pass.
  await page.evaluate(() => {
    const player = (n, c, ev) => `<div class="tally-hud__player" style="--p-color:${c}"><div class="tally-hud__top"><span class="tally-hud__portrait">${n.slice(0, 2).toUpperCase()}</span><span class="tally-hud__name">${n}</span></div><span class="tally-hud__ev">${ev} EV</span><div class="tally-hud__bar"><div class="tally-hud__bar-fill" style="width:${Math.round((ev / 538) * 100)}%"></div></div></div>`;
    document.body.innerHTML = `<div class="tally-view"><div class="tally-hud"><span class="tally-hud__title">ELECTORAL ROLL-CALL</span>${player('Bobby Tooley', '#22c55e', 232)}${player('Donald Trump', '#ef4444', 180)}${player('Kamala Harris', '#3b82f6', 126)}</div><div class="tally-stage"><div class="tally-card" style="--p-color:#22c55e"><div class="tally-card__header"><span class="tally-card__state-name">California</span><span class="tally-card__ev-badge">54 EV</span></div><div class="tally-card__rungs-row" style="--p-color:#22c55e"><span class="tally-card__rung-label">Bobby Tooley</span><div class="tally-card__rung-bar-wrap"><div class="tally-card__rung-bar" style="width:80%"></div></div><span>13/16</span></div><div class="tally-card__winner-label" style="--p-color:#22c55e">BOBBY TOOLEY WINS +54 EV</div></div></div></div>`;
  });
  await wait(150);
  await capture(page, viewport.name, 'tally', { injected: true });

  // Pass-and-play handoff curtain.
  await page.evaluate(() => {
    document.body.innerHTML = `<div class="handoff" style="--p-color:#ef4444"><div class="handoff__panel"><span class="handoff__icon">▊ ▊ ▊</span><div class="handoff__pass">Handoff — pass device to</div><div class="handoff__name">Donald Trump</div><div class="handoff__note">Allocations are blind. Don't let the previous player see.</div><button class="handoff__btn">Ready to Play →</button></div></div>`;
  });
  await wait(150);
  await capture(page, viewport.name, 'handoff', { injected: true });
  await page.close();
}

async function auditPortraitGate(browser) {
  console.log(`\n▶ ${PORTRAIT.name}: rotate gate`);
  const page = await browser.newPage();
  await load(page, PORTRAIT);
  await wait(200);
  const hasGate = !!(await page.$('.orient-gate'));
  await capture(page, PORTRAIT.name, 'rotate-gate');
  if (!hasGate) manifest.push({ viewport: PORTRAIT.name, screen: 'rotate-gate', status: 'overflow', note: 'gate missing' });
  await page.close();
}

await mkdir(OUT_DIR, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  await waitForServer(server);
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const viewport of VIEWPORTS) await auditSession(browser, viewport);
    await auditEndgame(browser, REP);
    await auditHandoff(browser, REP);
    await auditInjected(browser, REP);
    await auditPortraitGate(browser);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}

// ── Manifest / report ────────────────────────────────────────────────────────
await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
const screens = [...new Set(manifest.map((m) => m.screen))].sort();
const overflows = manifest.filter((m) => m.status === 'overflow' || m.status === 'injected-overflow');
console.log(`\n${manifest.length} captures across ${screens.length} distinct screens → ${OUT_DIR}`);
console.log(`Screens: ${screens.join(', ')}`);
if (overflows.length) {
  console.log(`\n${overflows.length} overflow violation(s):`);
  for (const o of overflows) console.log(`  • ${o.viewport}/${o.screen}: v=${o.v} h=${o.h}`);
  process.exitCode = 1;
} else {
  console.log('\nNo overflow violations across audited screens.');
}
