/**
 * gen-og-image.mjs — generate the social/Open Graph card (1200×630) from real
 * gameplay. Drives the live app into a game, colorizes the US map, extracts the
 * SVG, then composes it with the Elector wordmark + tagline and screenshots a
 * clean 1200×630 card to public/assets/brand/og-image.png.
 *
 * Run: node scripts/gen-og-image.mjs [siteUrl]
 */
import puppeteer from 'puppeteer';

const URL = process.argv[2] || 'https://election-sim-ten.vercel.app';
const OUT = 'public/assets/brand/og-image.png';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(1200);

  // 1) Skip tutorial if present
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /skip/i.test(x.textContent || ''));
    b?.click();
  });
  await sleep(600);

  // 2) Mode select → Hot-Seat
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /hot-?seat/i.test(x.textContent || ''));
    b?.click();
  });
  await sleep(800);

  // 3) Candidate select → pick first two unlocked (let React re-enable Start), then start
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.cand-card')].filter((c) => !c.className.includes('is-locked'));
    cards.slice(0, 2).forEach((c) => c.click());
  });
  await sleep(500);
  await page.evaluate(() => {
    const start = document.querySelector('.setup__start');
    if (start && !start.disabled) start.click();
  });

  // 4) Wait for the map to render
  await page.waitForSelector('.election-map-container svg path', { timeout: 20000 });
  await sleep(800);

  // 5) Colorize states with a believable spread, then extract the SVG markup
  const svg = await page.evaluate(() => {
    const COLORS = ['#d8233c', '#d8233c', '#2563eb', '#2563eb', '#1fa85b', '#cbd5e1', '#cbd5e1'];
    const paths = document.querySelectorAll('.election-map-container svg path');
    paths.forEach((p) => {
      const c = COLORS[Math.floor(Math.random() * COLORS.length)];
      p.setAttribute('fill', c);
      p.style.fill = c;
      p.style.stroke = '#0f172a';
      p.style.strokeWidth = '0.6';
      p.style.opacity = '1';
    });
    const el = document.querySelector('.election-map-container svg');
    el.setAttribute('width', '800');
    el.setAttribute('height', '500');
    return el.outerHTML;
  });

  // 6) Compose the final OG card
  const html = `<!doctype html><html><head><meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Inter:wght@500;600&display=swap" rel="stylesheet">
  <style>
    * { margin:0; box-sizing:border-box; }
    body { width:1200px; height:630px; overflow:hidden;
      font-family:'Inter',system-ui,sans-serif;
      background:linear-gradient(135deg,#ffffff 0%,#eef1f5 60%,#e7ecf3 100%); position:relative; }
    .bar { position:absolute; top:0; left:0; right:0; height:8px;
      background:linear-gradient(90deg,#ffc23d,#f59022); }
    .wrap { display:flex; height:100%; align-items:center; padding:0 64px; gap:24px; }
    .left { width:46%; }
    .right { width:54%; display:flex; align-items:center; justify-content:center; }
    .right svg { width:100%; height:auto; filter:drop-shadow(0 12px 28px rgba(17,24,39,.18)); }
    .word { font-family:'Outfit',sans-serif; font-weight:800; font-size:104px; line-height:.92;
      letter-spacing:-.02em; color:#1a1e27; }
    .word .o { color:#f59022; }
    .tag { font-family:'Outfit',sans-serif; font-weight:700; font-size:34px; color:#1a1e27; margin-top:14px; }
    .sub { font-size:23px; color:#5c6675; margin-top:16px; line-height:1.4; }
    .pill { display:inline-block; margin-top:26px; background:#f59022; color:#fff;
      font-family:'Outfit',sans-serif; font-weight:800; font-size:22px; padding:12px 22px; border-radius:999px; }
    .url { position:absolute; bottom:28px; left:64px; font-weight:600; font-size:20px; color:#93a0b0; }
  </style></head>
  <body>
    <div class="bar"></div>
    <div class="wrap">
      <div class="left">
        <div class="word">Elect<span class="o">o</span>r</div>
        <div class="tag">Win the Electoral College</div>
        <div class="sub">Campaign across the states, build coalitions, and battle solo, vs bots, or online with friends.</div>
        <div class="pill">Race to 270</div>
      </div>
      <div class="right">${svg}</div>
    </div>
    <div class="url">playelector.com</div>
  </body></html>`;

  // deviceScaleFactor 1 → exactly 1200×630, the OG-recommended size (lean file).
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  // Best-effort wait for webfonts; falls back to system fonts if the CDN is slow.
  await page.evaluate(() => (document.fonts ? document.fonts.ready.catch(() => {}) : null)).catch(() => {});
  await sleep(1200);
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log('OG written →', OUT);
} finally {
  await browser.close();
}
