import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 4177;
const URL = `http://127.0.0.1:${PORT}/`;
const VIEWPORTS = [
  { width: 667, height: 375, name: 'small iPhone landscape' },
  { width: 852, height: 393, name: 'notched iPhone landscape' },
  { width: 932, height: 430, name: 'large iPhone landscape' },
  { width: 1024, height: 768, name: 'iPad landscape' },
];

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

async function assertNoDocumentScroll(page, label) {
  const metrics = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      text: document.body.innerText.slice(0, 120),
    };
  });
  const verticalOverflow = metrics.scrollHeight - metrics.clientHeight;
  const horizontalOverflow = metrics.scrollWidth - metrics.clientWidth;
  if (verticalOverflow > 1 || horizontalOverflow > 1) {
    throw new Error(`${label} overflows document: ${JSON.stringify(metrics)}`);
  }
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
  if (!clicked) throw new Error(`Could not click ${selector} containing "${text}"`);
}

async function assertNativeGameBoard(page, label) {
  await page.waitForSelector('.shell', { timeout: 5_000 });
  await assertNoDocumentScroll(page, `${label}: game board`);

  const metrics = await page.evaluate(() => {
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
    const map = document.querySelector('.election-map-container')?.getBoundingClientRect();
    const top = document.querySelector('.shell__top')?.getBoundingClientRect();
    const footer = document.querySelector('.phase-footer')?.getBoundingClientRect();
    const stateBar = document.querySelector('.shell > .shell__top .sg-bar')?.getBoundingClientRect();
    const hud = document.querySelector('.native-game-hud')?.getBoundingClientRect();
    return {
      viewport,
      map: map ? { width: map.width, height: map.height, left: map.left, top: map.top } : null,
      topVisible: !!top && top.width > 0 && top.height > 0,
      footerVisible: !!footer && footer.width > 0 && footer.height > 0,
      stateBarVisible: !!stateBar && stateBar.width > 0 && stateBar.height > 0,
      hudVisible: !!hud && hud.width > 0 && hud.height > 0,
    };
  });

  const hasDebate = await page.evaluate(() => /\bDebate\b/i.test(document.body.innerText));
  if (hasDebate) throw new Error(`${label}: native gameplay still shows Debate`);

  if (!metrics.map) throw new Error(`${label}: map container not found`);
  if (Math.abs(metrics.map.width - metrics.viewport.width) > 1 || Math.abs(metrics.map.height - metrics.viewport.height) > 1) {
    throw new Error(`${label}: map does not fill viewport ${JSON.stringify(metrics)}`);
  }
  if (!metrics.hudVisible) throw new Error(`${label}: native game HUD is not visible`);
  if (metrics.topVisible || metrics.footerVisible || metrics.stateBarVisible) {
    throw new Error(`${label}: legacy game chrome is visible ${JSON.stringify(metrics)}`);
  }

  const visibleWalletStrip = await page.$$eval('.native-group-wallet', (els) =>
    els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length,
  );
  if (visibleWalletStrip > 0) {
    throw new Error(`${label}: native gameplay should use wallet sheet, found visible wallet strip`);
  }

  await page.$eval('.native-active-tray__cash', (el) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  });
  await page.waitForSelector('.native-game-sheet__body--wallet .wallet-drawer', { timeout: 2_000 });
  const walletCells = await page.$$eval('.native-game-sheet__body--wallet .wallet-cell', (els) => els.length);
  if (walletCells < 8) throw new Error(`${label}: expected wallet sheet cells, found ${walletCells}`);
  await assertNoDocumentScroll(page, `${label}: wallet sheet`);
  await page.$eval('.native-game-sheet-backdrop', (el) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  });
  await page.waitForSelector('.native-game-sheet__body--wallet', { hidden: true, timeout: 2_000 });

  await page.click('.map-zoom-btn[aria-label="Zoom in"]');
  await wait(150);
  await assertNoDocumentScroll(page, `${label}: zoom in`);
  await page.click('.map-zoom-btn[aria-label="Reset view"]');
  await wait(150);
  await assertNoDocumentScroll(page, `${label}: zoom reset`);

  await clickByText(page, '.native-round-action', 'Coalitions');
  await page.waitForSelector('.native-game-sheet--state', { timeout: 2_000 });
  const stateProgress = await page.evaluate(() => ({
    rows: document.querySelectorAll('.native-sg-row').length,
    tracks: document.querySelectorAll('.native-sg-row__track').length,
    thresholds: document.querySelectorAll('.native-sg-row__threshold').length,
    memberRows: document.querySelectorAll('.sg-member,.sg-members').length,
    text: document.querySelector('.native-game-sheet--state')?.textContent ?? '',
  }));
  if (stateProgress.rows < 8 || stateProgress.tracks !== stateProgress.rows || stateProgress.thresholds !== stateProgress.rows) {
    throw new Error(`${label}: state group progress rows missing ${JSON.stringify(stateProgress)}`);
  }
  if (stateProgress.memberRows > 0 || /states\s+·|total EV|Lead a state/i.test(stateProgress.text)) {
    throw new Error(`${label}: state drawer still contains verbose state detail ${JSON.stringify(stateProgress)}`);
  }
  const stateDrawer = await page.evaluate(() => {
    const r = document.querySelector('.native-game-sheet--state')?.getBoundingClientRect();
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, viewport } : null;
  });
  if (!stateDrawer || stateDrawer.height < stateDrawer.viewport.height * 0.75 || stateDrawer.width > stateDrawer.viewport.width * 0.5) {
    throw new Error(`${label}: state groups did not open as a side drawer ${JSON.stringify(stateDrawer)}`);
  }
  await assertNoDocumentScroll(page, `${label}: state groups sheet`);
  await page.click('.native-game-sheet__close');
  await page.waitForSelector('.native-game-sheet--state', { hidden: true, timeout: 2_000 });

  await clickByText(page, '.native-round-action', 'National');
  await page.waitForSelector('.native-game-sheet--national', { timeout: 2_000 });
  const nationalDrawer = await page.evaluate(() => {
    const r = document.querySelector('.native-game-sheet--national')?.getBoundingClientRect();
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, viewport } : null;
  });
  if (!nationalDrawer || nationalDrawer.height < nationalDrawer.viewport.height * 0.75 || nationalDrawer.width > nationalDrawer.viewport.width * 0.5) {
    throw new Error(`${label}: national groups did not open as a side drawer ${JSON.stringify(nationalDrawer)}`);
  }
  await assertNoDocumentScroll(page, `${label}: national groups sheet`);
  await page.click('.native-game-sheet__close');
  await page.waitForSelector('.native-game-sheet--national', { hidden: true, timeout: 2_000 });

  await page.click('.native-corner--left');
  await page.waitForSelector('.setup--bot .shop-card', { timeout: 3_000 });
  const soloMenu = await page.evaluate(() => ({
    cards: document.querySelectorAll('.setup--bot .shop-card').length,
    visibleText: document.querySelector('.setup--bot')?.textContent ?? '',
  }));
  if (soloMenu.cards < 2 || !/Solo Campaign|Start Campaign|View stats/i.test(soloMenu.visibleText)) {
    throw new Error(`${label}: solo candidate menu did not render ${JSON.stringify(soloMenu)}`);
  }
  await assertNoDocumentScroll(page, `${label}: solo candidate menu`);
}

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(server);
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ ...viewport, isMobile: true, hasTouch: true });
      await page.goto(URL, { waitUntil: 'networkidle0' });
      await applyNative(page);
      await page.reload({ waitUntil: 'networkidle0' });
      await applyNative(page);
      await wait(250);
      await assertNoDocumentScroll(page, `${viewport.name}: landing`);

      const start = await page.$('button.landing__guest');
      if (start) {
        await start.click();
        await wait(600);
        await applyNative(page);
        await assertNoDocumentScroll(page, `${viewport.name}: practice intro`);
        const versus = await page.$('.versus');
        if (versus) {
          await versus.click();
          await wait(250);
        }
        await assertNativeGameBoard(page, viewport.name);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}

console.log(`Native viewport checks passed for ${VIEWPORTS.length} landscape sizes.`);
