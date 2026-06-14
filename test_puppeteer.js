import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`[Browser ${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.log(`[Page Error] ${err.message}`);
  });

  await page.goto('http://localhost:5175/');
  await new Promise(r => setTimeout(r, 2000));

  // Click a state path to open the popover
  console.log("Clicking state map region via evaluate...");
  await page.evaluate(() => {
    const el = document.querySelector('.rsm-geography');
    if (el) el.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: 100, clientY: 100}));
  });

  await new Promise(r => setTimeout(r, 500)); // wait for popover

  console.log("Clicking allocate button in popover via evaluate...");
  await page.evaluate(() => {
    const el = document.querySelector('.state-popover__allocate-btn');
    if (el) el.click();
    else console.log("Allocate button not found in evaluate");
  });

  await new Promise(r => setTimeout(r, 1000));
  await browser.close();
})();
