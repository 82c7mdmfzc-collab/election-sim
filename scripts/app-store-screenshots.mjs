/**
 * Generate polished App Store screenshots from real Elector gameplay.
 *
 * The script starts Vite, drives the native-layout app through guest solo play,
 * captures live UI moments, then wraps those captures in App Store marketing
 * layouts at the exact Apple Connect dimensions already used by the repo.
 *
 * Run: node scripts/app-store-screenshots.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = process.cwd();
const PORT = 4182;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT_DIR = path.join(ROOT, 'app-store/app-screenshots/en-US');
const WORK_DIR = '/tmp/elector-app-store-screens';

const PREFS = {
  tutorialSeen: true,
  muted: true,
  lastAwardedGameId: null,
  selectedVictoryMessage: 'classic',
  pendingReferralCode: null,
  firstRunCoachDismissed: true,
  blockedPlayers: [],
  notifPermissionAsked: true,
};

const DEVICES = {
  iphone: {
    viewport: { width: 1368, height: 630, isMobile: true, hasTouch: true },
    output: { width: 2736, height: 1260 },
    suffix: 'APP_IPHONE_67',
  },
  ipad: {
    viewport: { width: 1366, height: 1024, isMobile: true, hasTouch: true },
    output: { width: 2732, height: 2048 },
    suffix: 'APP_IPAD_PRO_3GEN_129',
  },
};

const SCENARIOS = {
  race: {
    order: '01',
    slug: 'race-to-270',
    kicker: 'Strategy Game',
    title: 'Race to 270',
    body: 'Campaign across every state, spend wisely, and win the Electoral College.',
    note: 'Live campaign map',
    accent: '#ff991c',
    crop: { boardScale: 1.05, ipadScale: 1.08 },
    chips: ['50 states', '270 EV', 'Turn-based'],
  },
  coalitions: {
    order: '02',
    slug: 'coalitions',
    kicker: 'Bonus Control',
    title: 'Build winning coalitions',
    body: 'Claim support blocs that swing the map before your rivals do.',
    note: 'Real coalition screen',
    accent: '#4f9cff',
    crop: { boardScale: 1.14, ipadScale: 1.18 },
    chips: ['Support blocs', 'Wallet bonuses', 'Map pressure'],
  },
  rivals: {
    order: '03',
    slug: 'rivals',
    kicker: 'Solo or Multiplayer',
    title: 'Battle friends or bots',
    body: 'Jump into fast tactical matchups with real candidates and sharp choices.',
    note: 'Actual matchup',
    accent: '#22c55e',
    crop: { boardScale: 1.95, ipadScale: 2.15 },
    chips: ['Solo', 'Pass & Play', 'Online'],
  },
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(proc) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (proc.exitCode != null) throw new Error('vite exited before serving');
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await wait(250);
  }
  throw new Error(`timed out waiting for ${URL}`);
}

async function preparePage(page, viewport) {
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((prefs) => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    window.localStorage.setItem('election-sim-prefs-v1', JSON.stringify(prefs));
    window.localStorage.removeItem('election-sim-storage-v5');
  }, PREFS);

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate((prefs) => {
    document.documentElement.classList.add('native');
    localStorage.setItem('election-sim-prefs-v1', JSON.stringify(prefs));
    localStorage.removeItem('election-sim-storage-v5');
  }, PREFS);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate((prefs) => {
    document.documentElement.classList.add('native');
    localStorage.setItem('election-sim-prefs-v1', JSON.stringify(prefs));
  }, PREFS);
  await wait(400);
}

async function clickText(page, selector, text) {
  return page.evaluate((sel, wantedText) => {
    const wanted = wantedText.toLowerCase();
    const el = [...document.querySelectorAll(sel)]
      .find((node) => (node.textContent ?? '').toLowerCase().includes(wanted));
    if (!(el instanceof HTMLElement)) return false;
    el.click();
    return true;
  }, selector, text);
}

async function startGuestCampaign(page) {
  await page.addScriptTag({
    type: 'module',
    content: `
      import { useGameStore } from '/src/game/store.ts';
      import { CANDIDATE_MAP } from '/src/game/candidates.ts';
      try {
        const store = useGameStore.getState();
        store.reset();
        store.startGame(
          [CANDIDATE_MAP.tooley, CANDIDATE_MAP.trump, CANDIDATE_MAP.harris],
          null,
          { trump: 'medium', harris: 'hard' },
        );
        window.__electorStarted = true;
      } catch (error) {
        window.__electorStartError = String(error?.stack || error);
      }
    `,
  });
  await page.waitForFunction(() => window.__electorStarted || window.__electorStartError, { timeout: 10_000 });
  const startError = await page.evaluate(() => window.__electorStartError || null);
  if (startError) throw new Error(startError);
  await page.waitForSelector('.versus', { timeout: 10_000 });
  await wait(700);
}

async function seedColorfulMidgame(page) {
  await page.addScriptTag({
    type: 'module',
    content: `
      import { useGameStore } from '/src/game/store.ts';
      useGameStore.getState().clearVersus();
    `,
  });
  await page.waitForSelector('.shell', { timeout: 10_000 });
  await page.addScriptTag({
    type: 'module',
    content: `
      import { useGameStore } from '/src/game/store.ts';
      import { recomputeDominance } from '/src/game/engine.ts';
      import { STATE_GROUPS, NATIONAL_GROUPS } from '/src/game/config.ts';
      try {
        const assignments = {
          tooley: { CA: 16, WA: 12, CO: 12, PA: 12, GA: 12, VA: 12, AZ: 6, MI: 7, NC: 5 },
          trump: { TX: 16, FL: 16, OH: 12, AL: 12, TN: 12, WI: 12, NC: 4, GA: 3 },
          harris: { NY: 16, IL: 12, MA: 12, NJ: 12, MN: 12, NV: 8, AZ: 4, PA: 3 },
        };
        const national = {
          tooley: { 'Youth Vote': 5, Environmental: 4 },
          trump: { 'Gun Lobby': 5, 'Big Conservative': 4 },
          harris: { "Women's Vote": 5, Environmental: 3 },
        };

        const current = useGameStore.getState();
        let seq = current.seqCounter;
        const rungs = Object.fromEntries(Object.entries(current.rungs).map(([sid, byPlayer]) => [sid, { ...byPlayer }]));
        const reachSeq = Object.fromEntries(Object.entries(current.reachSeq).map(([sid, byPlayer]) => [sid, { ...byPlayer }]));
        const natRungs = Object.fromEntries(Object.entries(current.natRungs).map(([gid, byPlayer]) => [gid, { ...byPlayer }]));
        const natReachSeq = Object.fromEntries(Object.entries(current.natReachSeq).map(([gid, byPlayer]) => [gid, { ...byPlayer }]));
        const securedBy = { ...current.securedBy };

        for (const [playerId, states] of Object.entries(assignments)) {
          for (const [stateId, count] of Object.entries(states)) {
            rungs[stateId] = { ...(rungs[stateId] ?? {}), [playerId]: count };
            reachSeq[stateId] = { ...(reachSeq[stateId] ?? {}), [playerId]: ++seq };
          }
        }
        for (const [playerId, groups] of Object.entries(national)) {
          for (const [groupId, count] of Object.entries(groups)) {
            natRungs[groupId] = { ...(natRungs[groupId] ?? {}), [playerId]: count };
            natReachSeq[groupId] = { ...(natReachSeq[groupId] ?? {}), [playerId]: ++seq };
          }
        }
        for (const stateId of ['CA', 'WA', 'CO', 'PA', 'GA', 'VA']) securedBy[stateId] = 'tooley';
        for (const stateId of ['TX', 'FL', 'OH', 'AL', 'TN', 'WI']) securedBy[stateId] = 'trump';
        for (const stateId of ['NY', 'IL', 'MA', 'NJ', 'MN', 'NV']) securedBy[stateId] = 'harris';

        const players = current.players.map((player) => ({
          ...player,
          nationalCash: player.id === 'tooley' ? 680 : player.id === 'trump' ? 540 : 610,
          groupWallets: Object.fromEntries(STATE_GROUPS.map((group) => [
            group.id,
            player.id === 'tooley' && ['High Tech', 'Swing States'].includes(group.id)
              ? group.bonusPayout
              : player.id === 'trump' && ['Oil and Gas', 'Old South'].includes(group.id)
                ? group.bonusPayout
                : player.id === 'harris' && ['Town and Gown'].includes(group.id)
                  ? group.bonusPayout
                  : 0,
          ])),
        }));
        const prevDominance = Object.fromEntries(STATE_GROUPS.map((group) => [group.id, null]));
        const dominance = recomputeDominance(rungs, reachSeq, players, prevDominance);

        useGameStore.setState({
          turn: 9,
          seqCounter: seq,
          players,
          rungs,
          reachSeq,
          securedBy,
          natRungs,
          natReachSeq,
          stateGroupDominance: dominance,
          prevDominance,
          phase: 'PLANNING',
          activePlayerIndex: 0,
          pendingByPlayer: Object.fromEntries(players.map((player) => [player.id, []])),
          workingCash: Object.fromEntries(players.map((player) => [
            player.id,
            { nationalCash: player.nationalCash, groupWallets: { ...player.groupWallets } },
          ])),
          submitted: Object.fromEntries(players.map((player) => [player.id, false])),
          lastIncome: Object.fromEntries(players.map((player) => [player.id, 0])),
          lastTurnReport: null,
          lastRoundPurchases: [],
          electionResult: null,
          electionScheduled: false,
          hungColleges: 0,
          viewingGame: true,
          versusPending: false,
          natSecuredBy: Object.fromEntries(NATIONAL_GROUPS.map((group) => [group.id, null])),
        });
        window.__electorSeeded = true;
      } catch (error) {
        window.__electorSeedError = String(error?.stack || error);
      }
    `,
  });
  await page.waitForFunction(() => window.__electorSeeded || window.__electorSeedError, { timeout: 10_000 });
  const seedError = await page.evaluate(() => window.__electorSeedError || null);
  if (seedError) throw new Error(seedError);
  await wait(700);
}

async function captureRawSet(browser, deviceName, device) {
  const page = await browser.newPage();
  await preparePage(page, device.viewport);
  await startGuestCampaign(page);

  const raw = {};
  raw.rivals = path.join(WORK_DIR, `${deviceName}-rivals.png`);
  await page.screenshot({ path: raw.rivals });

  await seedColorfulMidgame(page);
  raw.race = path.join(WORK_DIR, `${deviceName}-race.png`);
  await page.screenshot({ path: raw.race });

  await clickText(page, '.native-round-action', 'Coalitions');
  await wait(500);
  raw.coalitions = path.join(WORK_DIR, `${deviceName}-coalitions.png`);
  await page.screenshot({ path: raw.coalitions });

  await page.close();
  return raw;
}

async function dataUri(file) {
  const bytes = await readFile(file);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function stripesCss() {
  return `
    background:
      radial-gradient(circle at 9% 19%, rgba(255,255,255,.23) 0 2px, transparent 2.5px),
      radial-gradient(circle at 22% 56%, rgba(255,255,255,.18) 0 2px, transparent 2.5px),
      radial-gradient(circle at 78% 38%, rgba(255,255,255,.18) 0 2px, transparent 2.5px),
      radial-gradient(circle at 91% 82%, rgba(255,255,255,.22) 0 2px, transparent 2.5px),
      repeating-linear-gradient(116deg, transparent 0 72px, rgba(180,210,255,.17) 73px, rgba(180,210,255,.17) 76px, transparent 77px 154px),
      linear-gradient(137deg, #07111f 0%, #081527 47%, #102037 100%);
  `;
}

function renderLayout({ deviceName, output, scenario, imageUri }) {
  const isIpad = deviceName === 'ipad';
  const scale = isIpad ? scenario.crop.ipadScale : scenario.crop.boardScale;
  const deviceClass = isIpad ? 'device device--ipad' : 'device device--iphone';
  const imgClass = scenario.slug === 'rivals' ? 'screen screen--rivals' : 'screen';

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: ${output.width}px; height: ${output.height}px; overflow: hidden; }
      body {
        ${stripesCss()}
        color: #f8fbff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .frame {
        position: relative;
        width: ${output.width}px;
        height: ${output.height}px;
        isolation: isolate;
      }
      .frame::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(90deg, rgba(2,8,23,.68) 0%, rgba(2,8,23,.18) 42%, rgba(2,8,23,.2) 100%),
          radial-gradient(circle at 71% 68%, color-mix(in srgb, ${scenario.accent} 32%, transparent), transparent 36%);
        opacity: .95;
        z-index: -1;
      }
      .copy {
        position: absolute;
        left: ${isIpad ? 146 : 126}px;
        top: ${isIpad ? 132 : 94}px;
        width: ${isIpad ? 1550 : 650}px;
        text-wrap: balance;
      }
      .kicker {
        display: inline-flex;
        align-items: center;
        height: ${isIpad ? 70 : 58}px;
        padding: 0 ${isIpad ? 34 : 30}px;
        border: 2px solid rgba(110,165,255,.92);
        border-radius: 999px;
        background: rgba(29,77,143,.78);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 14px 30px rgba(0,0,0,.28);
        color: #f7fbff;
        font-size: ${isIpad ? 38 : 34}px;
        font-weight: 950;
        letter-spacing: .01em;
        text-transform: uppercase;
      }
      h1 {
        margin: ${isIpad ? 88 : 72}px 0 0;
        font-size: ${isIpad ? 126 : 106}px;
        line-height: .92;
        letter-spacing: 0;
        font-weight: 1000;
        text-shadow: 0 10px 30px rgba(0,0,0,.42);
      }
      p {
        margin: ${isIpad ? 18 : 12}px 0 0;
        max-width: ${isIpad ? 1370 : 640}px;
        color: #c8d4e8;
        font-size: ${isIpad ? 48 : 40}px;
        line-height: 1.16;
        font-weight: 500;
      }
      .rule {
        display: flex;
        gap: 0;
        margin-top: ${isIpad ? 34 : 30}px;
        width: ${isIpad ? 690 : 520}px;
        height: ${isIpad ? 13 : 12}px;
        border-radius: 999px;
        overflow: hidden;
        box-shadow: 0 0 28px rgba(79,156,255,.18);
      }
      .rule span:first-child { flex: 1.9; background: #ff951a; }
      .rule span:last-child { flex: 1.1; background: #4a97ff; }
      .chips {
        display: flex;
        gap: ${isIpad ? 18 : 14}px;
        margin-top: ${isIpad ? 46 : 38}px;
        flex-wrap: wrap;
      }
      .chip {
        padding: ${isIpad ? 16 : 12}px ${isIpad ? 24 : 20}px;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 999px;
        background: rgba(255,255,255,.08);
        color: #e7eefb;
        font-size: ${isIpad ? 26 : 23}px;
        font-weight: 800;
      }
      .device {
        position: absolute;
        overflow: hidden;
        background: #0b1424;
        border: ${isIpad ? 6 : 5}px solid #6aa5ff;
        box-shadow:
          0 42px 95px rgba(0,0,0,.55),
          0 0 0 ${isIpad ? 18 : 14}px rgba(5,15,31,.9),
          inset 0 0 0 2px rgba(255,255,255,.08);
      }
      .device--iphone {
        left: 790px;
        top: 360px;
        width: 1730px;
        height: 812px;
        border-radius: 86px;
      }
      .device--ipad {
        left: 500px;
        top: 700px;
        width: 1900px;
        height: 1285px;
        border-radius: 78px;
      }
      .device--ipad::after,
      .device--iphone::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background:
          linear-gradient(145deg, rgba(255,255,255,.16), transparent 24%),
          linear-gradient(0deg, rgba(0,0,0,.18), transparent 28%);
        mix-blend-mode: screen;
      }
      .screen {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center center;
        transform: scale(${scale});
        filter: saturate(1.18) contrast(1.08) brightness(1.02);
      }
      .screen--rivals {
        transform: scale(${scale});
        filter: saturate(1.28) contrast(1.18) brightness(1.1);
      }
      .badge {
        position: absolute;
        right: ${isIpad ? 144 : 122}px;
        bottom: ${isIpad ? 72 : 62}px;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: ${isIpad ? 15 : 13}px ${isIpad ? 25 : 23}px;
        border-radius: 999px;
        border: 2px solid #ff991c;
        background: rgba(7,17,31,.74);
        color: #f3f7ff;
        font-size: ${isIpad ? 30 : 28}px;
        font-weight: 760;
        box-shadow: 0 18px 44px rgba(0,0,0,.34);
      }
      .badge i {
        display: block;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        background: #ff991c;
      }
      .note {
        position: absolute;
        left: ${isIpad ? 148 : 126}px;
        bottom: ${isIpad ? 88 : 70}px;
        color: rgba(232,240,255,.56);
        font-size: ${isIpad ? 25 : 23}px;
        font-weight: 800;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <section class="copy">
        <div class="kicker">${scenario.kicker}</div>
        <h1>${scenario.title}</h1>
        <p>${scenario.body}</p>
        <div class="rule"><span></span><span></span></div>
        <div class="chips">${scenario.chips.map((chip) => `<span class="chip">${chip}</span>`).join('')}</div>
      </section>
      <div class="${deviceClass}">
        <img class="${imgClass}" src="${imageUri}" alt="" />
      </div>
      <div class="note">Elector</div>
      <div class="badge">${scenario.note}<i></i></div>
    </div>
  </body>
  </html>`;
}

async function compose(browser, deviceName, device, scenarioKey, rawFile) {
  const scenario = SCENARIOS[scenarioKey];
  const imageUri = await dataUri(rawFile);
  const page = await browser.newPage();
  await page.setViewport({ width: device.output.width, height: device.output.height, deviceScaleFactor: 1 });
  await page.setContent(renderLayout({ deviceName, output: device.output, scenario, imageUri }), {
    waitUntil: 'load',
  });
  await wait(250);
  const out = path.join(OUT_DIR, `${device.suffix}-${scenario.order}-${scenario.slug}.png`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: device.output.width, height: device.output.height } });
  await page.close();
}

await rm(WORK_DIR, { recursive: true, force: true });
await mkdir(WORK_DIR, { recursive: true });
await mkdir(OUT_DIR, { recursive: true });

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(server);
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const [deviceName, device] of Object.entries(DEVICES)) {
      console.log(`Capturing ${deviceName} gameplay moments…`);
      const raw = await captureRawSet(browser, deviceName, device);
      for (const key of Object.keys(SCENARIOS)) {
        await compose(browser, deviceName, device, key, raw[key]);
        console.log(`  wrote ${device.suffix}-${SCENARIOS[key].order}-${SCENARIOS[key].slug}.png`);
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
