// Создание окон: вход, настройки, подтверждение автоклоса.
import { BrowserWindow } from 'electron';
import * as path from 'path';

const PRELOAD = path.join(__dirname, 'preload.js');
const RENDERER = path.join(__dirname, 'renderer');

function baseWindow(opts: {
  width: number;
  height: number;
  html: string;
  resizable?: boolean;
  alwaysOnTop?: boolean;
}): BrowserWindow {
  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    resizable: opts.resizable ?? false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    title: '',
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    backgroundColor: '#00000000',
    show: false,
    alwaysOnTop: opts.alwaysOnTop ?? false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(RENDERER, opts.html));
  win.once('ready-to-show', () => win.show());
  return win;
}

let authWin: BrowserWindow | null = null;
export function openAuthWindow(): BrowserWindow {
  if (authWin && !authWin.isDestroyed()) {
    authWin.show();
    authWin.focus();
    return authWin;
  }
  authWin = baseWindow({ width: 360, height: 420, html: 'auth.html' });
  authWin.on('closed', () => (authWin = null));
  return authWin;
}
export function closeAuthWindow(): void {
  if (authWin && !authWin.isDestroyed()) authWin.close();
  authWin = null;
}

let settingsWin: BrowserWindow | null = null;
export function openSettingsWindow(): BrowserWindow {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = baseWindow({ width: 440, height: 640, html: 'settings.html' });
  settingsWin.on('closed', () => (settingsWin = null));
  return settingsWin;
}
export function closeSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  settingsWin = null;
}

export function openAutocloseWindow(): BrowserWindow {
  return baseWindow({
    width: 340,
    height: 200,
    html: 'autoclose.html',
    alwaysOnTop: true,
  });
}
