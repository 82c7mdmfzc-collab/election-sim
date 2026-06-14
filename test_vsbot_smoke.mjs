/**
 * Smoke test: vs-Bot flow. Verifies the menu route, game start, and that the
 * bot autonomously takes its turn (resolution only fires once every seat submits).
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

  // First launch auto-opens the tutorial — skip it.
  await page.waitForSelector('.tutorial__skip', { timeout: 10000 });
  await page.click('.tutorial__skip');
  log('tutorial skipped');

  // Menu → vs Bot.
  await page.waitForSelector('.setup__actions');
  const clickedBot = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /vs Bot/i.test(b.textContent));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clickedBot) throw new Error('vs Bot button not found');
  log('entered BotSetup');

  // Start the game with defaults (1 medium bot).
  await page.waitForSelector('.setup__start');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Start Game/i.test(b.textContent));
    btn.click();
  });

  // We should now be in the GameShell PLANNING phase.
  await page.waitForSelector('.phase-btn--primary', { timeout: 10000 });
  log('game started (PLANNING)');

  // Human submits its (empty) turn → it becomes the bot's turn.
  await page.click('.phase-btn--primary');
  log('human submitted; waiting for the bot to play…');

  // Resolution only renders after EVERY active seat submits, so its appearance
  // proves the bot autonomously allocated + submitted.
  await page.waitForSelector('.round-resolution, .res-card, .resolution', { timeout: 12000 });
  log('✓ resolution reached — the bot took its turn');

  if (errors.length) {
    log('page errors during run:', errors.slice(0, 5));
    throw new Error(`${errors.length} page error(s)`);
  }
  log('SMOKE PASS');
} finally {
  await browser.close();
}
