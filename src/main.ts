// Точка входа: menu-bar приложение без окна в доке.
import { app, ipcMain, BrowserWindow } from 'electron';
import { Store } from './store';
import { TrayUI } from './tray';
import { Scheduler } from './scheduler';
import { AuthError } from './wplanApi';
import {
  openAuthWindow,
  closeAuthWindow,
  openSettingsWindow,
  closeSettingsWindow,
  openAutocloseWindow,
} from './windows';

let store: Store;
let tray: TrayUI;
let scheduler: Scheduler;
let pendingAutoclose: ((ok: boolean) => void) | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function applyLoginItem(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled });
}

/** Показать окно подтверждения автоклоса; резолв true = закрывать день. */
function confirmAutoclose(): Promise<boolean> {
  return new Promise((resolve) => {
    const win = openAutocloseWindow();
    const seconds = store.settings.autocloseConfirmSeconds;
    pendingAutoclose = (ok) => {
      pendingAutoclose = null;
      if (!win.isDestroyed()) win.close();
      resolve(ok);
    };
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('autoclose:init', seconds);
    });
    win.on('closed', () => {
      if (pendingAutoclose) {
        const r = pendingAutoclose;
        pendingAutoclose = null;
        r(false); // закрыли окно вручную = отмена
      }
    });
  });
}

function wireIpc(): void {
  ipcMain.handle('auth:host', () => store.settings.host.replace(/^https?:\/\//, ''));

  ipcMain.handle('auth:login', async (_e, data: { username: string; password: string }) => {
    try {
      await store.login({ username: data.username, password: data.password });
      closeAuthWindow();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof AuthError ? err.message : (err as Error).message;
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('settings:get', () => ({ ...store.settings }));

  ipcMain.handle('settings:userinfo', () => ({
    fio: store.state.fio,
    login: store.state.login,
    role: store.state.role,
    host: store.settings.host,
    tz: store.tz(),
    authorized: store.state.status !== 'logged_out' && store.state.status !== 'error',
  }));

  ipcMain.handle('settings:save', async (_e, next) => {
    const merged = { ...store.settings, ...next };
    applyLoginItem(merged.openAtLogin);
    await store.applySettings(merged);
    return { ok: true };
  });

  ipcMain.handle('settings:logout', async () => {
    await store.logout();
    closeSettingsWindow();
    openAuthWindow();
    return { ok: true };
  });

  ipcMain.handle('autoclose:result', (_e, ok: boolean) => {
    if (pendingAutoclose) pendingAutoclose(!!ok);
    return { ok: true };
  });
}

function trayCallbacks() {
  return {
    onStart: () => void store.startDay(),
    onFinish: () => void store.finishDay(),
    onRefresh: () => void store.refresh(),
    onOpenSettings: () => openSettingsWindow(),
    onLogin: () => openAuthWindow(),
    onLogout: async () => {
      await store.logout();
      openAuthWindow();
    },
    onToggleAutoclose: (v: boolean) => void store.applySettings({ ...store.settings, autocloseEnabled: v }),
    onToggleOvertime: (v: boolean) => void store.applySettings({ ...store.settings, overtimeTracking: v }),
    onQuit: () => {
      app.quit();
    },
  };
}

app.on('second-instance', () => {
  /* уже запущено — ничего не делаем */
});

// не выходим, когда закрыли окно настроек/входа — живём в menu-bar
app.on('window-all-closed', () => {
  /* keep running */
});

app.whenReady().then(async () => {
  app.setName('WPlan Tracker');
  app.dock?.hide();

  store = new Store();
  applyLoginItem(store.settings.openAtLogin);
  wireIpc();

  tray = new TrayUI(store, trayCallbacks());
  scheduler = new Scheduler(store, confirmAutoclose);

  // открыть окно входа, как только оказались разлогинены
  store.on('change', (s) => {
    if (s.status === 'logged_out') {
      const anyAuth = BrowserWindow.getAllWindows().length > 0;
      if (!anyAuth) openAuthWindow();
    }
  });

  await store.init();
  scheduler.start();

  if (store.isLoggedOut()) openAuthWindow();
});
