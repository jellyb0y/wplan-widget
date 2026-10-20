// Иконка и меню в menu-bar. Перестраивается на каждое изменение состояния.
import { Tray, Menu, nativeImage, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import { Store } from './store';
import { minutesInTz } from './time';

const ASSETS = path.join(__dirname, '..', 'assets');

function icon(name: string): Electron.NativeImage {
  const img = nativeImage.createFromPath(path.join(ASSETS, name));
  img.setTemplateImage(true); // macOS сам перекрасит под тему
  return img;
}

/** "HH:MM:SS" → "HH:MM". */
function hm(t: string | null | undefined): string {
  if (!t) return '—';
  const m = /^(\d{1,2}:\d{2})/.exec(t);
  return m ? m[1] : t;
}

/** "HH:MM:SS" или "HH:MM" → минуты. */
function toMinutes(t: string | null | undefined): number {
  if (!t) return 0;
  const p = t.split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

/** минуты → "H:MM". */
function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** секунды → "H:MM". */
function secToHm(sec: number): string {
  return fmtMin(sec / 60);
}

/** "HH:MM" или "HH:MM:SS" → минуты от начала суток. */
function clockToMinutes(t: string): number {
  const p = t.split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

/** минуты от начала суток → "HH:MM" (с переносом за сутки). */
function minToClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export interface TrayCallbacks {
  onStart: () => void;
  onFinish: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onToggleAutoclose: (v: boolean) => void;
  onToggleOvertime: (v: boolean) => void;
  onQuit: () => void;
}

export class TrayUI {
  private tray: Tray;

  constructor(private store: Store, private cb: TrayCallbacks) {
    this.tray = new Tray(icon('idleTemplate.png'));
    this.tray.setToolTip('WPlan Tracker');
    this.store.on('change', () => this.render());
    // автообновление при наведении на иконку (не чаще раза в 15с) — вместо кнопки «Обновить»
    let lastHoverRefresh = 0;
    this.tray.on('mouse-enter', () => {
      const now = Date.now();
      if (now - lastHoverRefresh > 15_000) {
        lastHoverRefresh = now;
        this.cb.onRefresh();
      }
    });
    this.render();
  }

  private render(): void {
    const s = this.store.state;
    this.tray.setImage(icon(s.status === 'working' ? 'workingTemplate.png' : 'idleTemplate.png'));

    let template: MenuItemConstructorOptions[];

    if (s.status === 'logged_out') {
      this.tray.setToolTip('WPlan — не выполнен вход');
      template = [
        { label: 'WPlan Tracker', enabled: false },
        { type: 'separator' },
        { label: 'Войти в WPlan…', click: this.cb.onLogin },
        { type: 'separator' },
        { label: 'Выход', click: this.cb.onQuit },
      ];
    } else {
      const statusLine =
        s.status === 'error'
          ? `Ошибка: ${s.error ?? 'неизвестно'}`
          : s.status === 'loading'
            ? 'Загрузка…'
            : s.dayState?.isStart
              ? s.today && !s.today.isWorkingDay
                ? 'Сегодня нерабочий день'
                : 'День не начат'
              : `Работаю${s.dayState?.startedAt ? ' с ' + hm(timeOf(s.dayState.startedAt)) : ''}`;

      // кнопку показываем по известному состоянию дня, даже если было обновление с ошибкой
      const dayKnown = !!s.dayState && s.dayState.isVisible;
      const showStart = dayKnown && s.dayState!.isStart;
      const showFinish = dayKnown && !s.dayState!.isStart;
      const working = showFinish; // день идёт
      const notStarted = showStart; // день доступен к старту

      // Статистика как в виджете personal-data (данные из personalReport).
      //  ВЫКЛ переработок: остаток/уход до полной нормы (plannedLeaveTimeToday из API).
      //  ВКЛ: цель = минимум workingHours (4:00), если доступного остатка переработок
      //  (overworkTimeTotal) ≥ (полная−минимум), иначе цель = полная норма.
      const r = s.report;
      const overtimeOn = this.store.settings.overtimeTracking;
      const nowMin = minutesInTz(this.store.tz());
      const startMin = s.dayState?.startedAt ? clockToMinutes(timeOf(s.dayState.startedAt)) : null;
      const row = (label: string): MenuItemConstructorOptions => ({ label, enabled: false });

      const statRows: MenuItemConstructorOptions[] = [];
      if (working && r) {
        const workedSec = r.timeWorkedTodaySec;
        const fullNormSec = workedSec + r.timeLeftTodaySec; // полная норма (напр. 8:30)
        const minNormSec = s.worker ? Math.round(s.worker.workingHours * 3600) : fullNormSec;
        const diffSec = Math.max(0, fullNormSec - minNormSec);
        const requiredSec = overtimeOn
          ? r.overworkTotalSec >= diffSec
            ? minNormSec
            : fullNormSec
          : fullNormSec;
        const remainingSec = Math.max(0, requiredSec - workedSec);
        // уход: без переработок — готовое plannedLeaveTimeToday; с переработками — сейчас+остаток
        const departureMin =
          !overtimeOn && r.plannedLeaveTodayIso
            ? clockToMinutes(timeOf(r.plannedLeaveTodayIso))
            : nowMin + Math.round(remainingSec / 60);

        statRows.push(row(`Начат: ${startMin !== null ? minToClock(startMin) : '—'}`));
        statRows.push(row(`Отработано: ${secToHm(workedSec)}`));
        statRows.push(
          row(remainingSec > 0 ? `Осталось: ${secToHm(remainingSec)}` : 'Можно уходить')
        );
        statRows.push(row(`Уход: ~${minToClock(departureMin)}`));
      } else if (notStarted && r) {
        const fullNormSec = r.timeWorkedTodaySec + r.timeLeftTodaySec;
        statRows.push(row(`Норма сегодня: ${secToHm(fullNormSec)}`));
      }

      this.tray.setToolTip(`WPlan — ${s.fio ?? ''} · ${statusLine}`);

      template = [
        { label: s.fio ?? 'WPlan', enabled: false },
        { label: statusLine, enabled: false },
        { type: 'separator' },
        ...(showStart
          ? [{ label: 'Начать день', click: this.cb.onStart } as MenuItemConstructorOptions]
          : []),
        ...(showFinish
          ? [{ label: 'Завершить день', click: this.cb.onFinish } as MenuItemConstructorOptions]
          : []),
        ...(statRows.length ? [{ type: 'separator' } as MenuItemConstructorOptions, ...statRows] : []),
        { type: 'separator' },
        {
          label: 'Учёт переработок',
          type: 'checkbox',
          checked: this.store.settings.overtimeTracking,
          click: (mi) => this.cb.onToggleOvertime(mi.checked),
        },
        { type: 'separator' },
        { label: 'Настройки…', click: this.cb.onOpenSettings },
        { type: 'separator' },
        { label: 'Выход', click: this.cb.onQuit },
      ];
    }

    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  destroy(): void {
    this.tray.destroy();
  }
}

/** Из ISO "2026-10-20T09:29:30" взять часть времени "09:29:30". */
function timeOf(iso: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : iso;
}
