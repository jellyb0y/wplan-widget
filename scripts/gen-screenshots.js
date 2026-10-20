// Рендер окон приложения с демо-данными и сохранение PNG для README.
// Запуск: npx electron scripts/gen-screenshots.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const RENDERER = path.join(__dirname, '..', 'dist', 'renderer');
const PRELOAD = path.join(__dirname, 'screenshot-preload.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(html, w, h, file) {
  const win = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    backgroundColor: '#2b2b30', // имитация фона окна (вместо vibrancy)
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL('file://' + path.join(RENDERER, html));
    await wait(700); // дать шрифтам/переходам и demo-данным отрисоваться
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, file), img.toPNG());
    console.log('saved', file);
  } catch (e) {
    console.error('FAILED', file, e.message);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await wait(300);
  }
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await shot('auth.html', 360, 420, 'auth.png');
  await shot('settings.html', 440, 660, 'settings.png');
  await shot('autoclose.html', 340, 200, 'autoclose.png');
  app.quit();
});
