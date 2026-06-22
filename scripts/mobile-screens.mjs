/**
 * Mobile screen audit harness (companion to check-mobile-native.mjs).
 *
 * For each target landscape viewport it walks the guest-reachable native screens
 * (landing → in-game board → solo setup → home menu → daily → shop gate), captures
 * a screenshot of each to /tmp/elector-mobile-audit/, and asserts the document does
 * not scroll (no vertical/horizontal overflow). It also captures the portrait
 * rotate-gate, and makes a best-effort attempt to drive a game to GAME_OVER so the
 * victory screen can be eyeballed.
 *
 * Unlike check-mobile-native.mjs (a strict CI gate for the board), this is a local
 * audit/regression tool: it collects overflow violations and reports them at the end
 * rather than aborting on the first failure, so every screenshot is always produced.
 *
 * Run: npm run build && node scripts/mobile-screens.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
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

const violations = [];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(proc) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (proc.exitCode != null) throw new Error('vite preview exited before serving');
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      // keep waiting
    }
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

async function overflow(page) {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return {
      v: el.scrollHeight - el.clientHeight,
      h: el.scrollWidth - el.clientWidth,
    };
  });
}

async function clickByText(page, selector, text) {
  const clicked = await page.evaluate((selectorArg, textArg) => {
    const wanted = textArg.toLowerCase();
    const el = [...document.querySelectorAll(selectorArg)]
      .find((node) => (node.textContent ?? '').toLowerCase().includes(wanted));
    if (!(el instanceof HTMLElement)) return false;
    el.click();
    return true;
  }, selector, text);
  return clicked;
}

/** Screenshot to OUT_DIR and record any document overflow as a violation. */
async function capture(page, viewportName, screen) {
  await wait(200);
  const path = `${OUT_DIR}/${viewportName}-${screen}.png`;
  await page.screenshot({ path });
  const o = await overflow(page);
  if (o.v > 1 || o.h > 1) {
    violations.push(`${viewportName} / ${screen}: overflow v=${o.v} h=${o.h}`);
    console.log(`  ⚠ ${screen}: overflow v=${o.v} h=${o.h}`);
  } else {
    console.log(`  ✓ ${screen}`);
  }
}

/** Best-effort: drive the practice game to GAME_OVER (no spending → bot wins). */
async function driveToVictory(page, viewportName) {
  for (let i = 0; i < 48; i += 1) {
    if (await page.$('.victory-podium')) break;
    const btn = await page.$('.native-turn-button:not([disabled])');
    if (btn) {
      await btn.click();
      await wait(900);
      continue;
    }
    // No actionable turn button this tick (resolution settling / election overlay).
    await wait(700);
  }
  if (await page.$('.victory-podium')) {
    await capture(page, viewportName, 'victory');
  } else {
    console.log('  – victory: not reached within cap (skipped)');
  }
}

async function auditViewport(browser, viewport) {
  console.log(`\n▶ ${viewport.name} (${viewport.width}×${viewport.height})`);
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await applyNative(page);
  await page.reload({ waitUntil: 'networkidle0' });
  await applyNative(page);
  await wait(300);

  // 1. Landing (signed-out front door)
  await capture(page, viewport.name, 'landing');

  // 2. Start → practice board
  if (await page.$('button.landing__guest')) {
    await page.click('button.landing__guest');
    await wait(700);
    await applyNative(page);
    const versus = await page.$('.versus');
    if (versus) { await versus.click(); await wait(400); }
    await page.waitForSelector('.shell', { timeout: 5_000 }).catch(() => {});
    await capture(page, viewport.name, 'board');

    // 2b. Open a bottom sheet to audit it in context
    if (await clickByText(page, '.native-round-action', 'State')) {
      await wait(400);
      await capture(page, viewport.name, 'board-state-sheet');
      await page.click('.native-game-sheet__close').catch(() => {});
      await wait(250);
    }

    // 3. Exit → solo setup
    if (await page.$('.native-corner--left')) {
      await page.click('.native-corner--left');
      await page.waitForSelector('.setup--bot', { timeout: 4_000 }).catch(() => {});
      await wait(400);
      await capture(page, viewport.name, 'setup-bot');

      // 4. Back → home menu
      if (await page.$('.setup--bot .mp-back')) {
        await page.click('.setup--bot .mp-back');
        await page.waitForSelector('.home', { timeout: 4_000 }).catch(() => {});
        await wait(400);
        await capture(page, viewport.name, 'home');

        // 5. Daily tile
        if (await clickByText(page, '.menu-btn', 'Daily')) {
          await page.waitForSelector('.setup--daily', { timeout: 4_000 }).catch(() => {});
          await wait(400);
          await capture(page, viewport.name, 'daily');
          if (await page.$('.setup--daily .mp-back')) {
            await page.click('.setup--daily .mp-back');
            await page.waitForSelector('.home', { timeout: 4_000 }).catch(() => {});
            await wait(300);
          }
        }

        // 6. Shop tile (guests hit the sign-in gate; real shop is account-gated)
        if (await clickByText(page, '.menu-btn', 'Shop')) {
          await wait(500);
          await capture(page, viewport.name, 'shop-gate');
        }
      }
    }
  }
  await page.close();
}

async function auditVictory(browser, viewport) {
  console.log(`\n▶ ${viewport.name}: victory drive (best-effort)`);
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await applyNative(page);
  await page.reload({ waitUntil: 'networkidle0' });
  await applyNative(page);
  await wait(300);
  if (await page.$('button.landing__guest')) {
    await page.click('button.landing__guest');
    await wait(700);
    await applyNative(page);
    const versus = await page.$('.versus');
    if (versus) { await versus.click(); await wait(400); }
    await driveToVictory(page, viewport.name);
  }
  await page.close();
}

async function auditPortraitGate(browser) {
  console.log(`\n▶ ${PORTRAIT.name}: rotate gate`);
  const page = await browser.newPage();
  await page.setViewport({ ...PORTRAIT, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await applyNative(page);
  await page.reload({ waitUntil: 'networkidle0' });
  await applyNative(page);
  await wait(400);
  const hasGate = !!(await page.$('.orient-gate'));
  await capture(page, PORTRAIT.name, 'rotate-gate');
  if (!hasGate) violations.push(`${PORTRAIT.name}: orientation gate did not appear in portrait`);
  await page.close();
}

await mkdir(OUT_DIR, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(server);
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const viewport of VIEWPORTS) {
      await auditViewport(browser, viewport);
    }
    await auditVictory(browser, VIEWPORTS[1]); // one representative size
    await auditPortraitGate(browser);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}

console.log(`\nScreenshots written to ${OUT_DIR}`);
if (violations.length > 0) {
  console.log(`\n${violations.length} overflow/gate violation(s):`);
  for (const v of violations) console.log(`  • ${v}`);
  process.exitCode = 1;
} else {
  console.log('\nNo overflow violations across audited screens.');
}
