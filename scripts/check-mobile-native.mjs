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
