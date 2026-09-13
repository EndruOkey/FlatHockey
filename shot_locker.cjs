const { chromium } = require('./node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000/');
  await page.evaluate(() => localStorage.setItem('hockey_tutorial_done','1'));
  await page.reload();
  await page.waitForTimeout(1500);
  await page.click('#splash-guest-btn');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const badge = document.getElementById('nav-online-badge');
    badge.style.display = 'flex';
    badge.querySelector('span:last-child').textContent = '3 online';
  });
  // Crop just the nav bar
  await page.screenshot({ path: 'C:/Users/EndruOkey/AppData/Local/Temp/screen_nav.png', clip: { x: 0, y: 0, width: 1440, height: 64 } });
  console.log('done');
  await browser.close();
})();
