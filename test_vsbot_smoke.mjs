/**
 * Smoke test: Solo flow. Verifies the menu route, game start, and that the
 * computer opponent autonomously takes its turn.
 * Run against the dev server on :5174.
 */
import puppeteer from 'puppeteer';

const URL = 'http://localhost:5174';
const log = (...a) => console.log('[smoke]', ...a);

const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // Ignore network resource failures (e.g. Supabase anon auth 422 before the
    // backend is configured — the app degrades to a local guest profile).
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2' });

  // Signed-out fresh sessions may show the landing first.
  const continued = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /(Start Solo|Continue as Guest)/i.test(b.textContent ?? ''));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (continued) log('continued as guest');

  // First launch auto-opens the tutorial; returning sessions may already be on the menu.
  const tutorialVisible = await page.waitForSelector('.tutorial__skip', { timeout: 2500 }).then(() => true).catch(() => false);
  if (tutorialVisible) {
    await page.click('.tutorial__skip');
    log('tutorial skipped');
  }

  // Menu → Solo.
  await page.waitForSelector('.home__modes, .setup__start', { timeout: 10000 });
  const alreadyInSolo = await page.evaluate(() => /Solo Campaign/i.test(document.body.textContent ?? ''));
  const clickedBot = alreadyInSolo || (await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^Solo$/i.test((b.textContent ?? '').trim()));
    if (btn) { btn.click(); return true; }
    return false;
  }));
  if (!clickedBot) throw new Error('Solo button not found');
  log('entered Solo setup');

  // Start the game with defaults (1 medium computer opponent).
  await page.waitForSelector('.setup__start');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Start (Campaign|Game)/i.test(b.textContent ?? ''));
    btn.click();
  });

  // We should now be in the GameShell PLANNING phase.
  await page.waitForSelector('.phase-btn--primary', { timeout: 10000 });
  log('game started (PLANNING)');

  // Human submits its (empty) turn → it becomes the computer opponent's turn.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Hand to|Resolve Turn|Submit Turn/i.test(b.textContent ?? ''));
    btn?.click();
  });
  log('human submitted; waiting for the computer opponent to play…');

  // Resolution only renders after EVERY active seat submits, so its appearance
  // proves the computer opponent autonomously allocated + submitted.
  await page.waitForSelector('.round-resolution, .res-card, .resolution', { timeout: 12000 });
  log('✓ resolution reached — the computer opponent took its turn');

  if (errors.length) {
    log('page errors during run:', errors.slice(0, 5));
    throw new Error(`${errors.length} page error(s)`);
  }
  log('SMOKE PASS');
} finally {
  await browser.close();
}
