// Настройки приложения: дефолты + хранение в JSON в userData.
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface Settings {
  /** Хост WPlan, напр. https://wplan.office.lan */
  host: string;
  /** Локаль в пути GraphQL, напр. ru-RU */
  locale: string;
  /** Домен входа: дописывается как @<domain> и шлётся source=1. Пусто → без суффикса (source=2). */
  loginDomain: string;

  /** Поллинг состояния, минут. */
  pollMinutes: number;

  /** Напоминания о завершении дня (HH:mm), если день ещё идёт. */
  endReminderTimes: string[];
  /** Слать ли напоминание о старте дня утром. */
  startReminderEnabled: boolean;
  /** Время утреннего напоминания о старте (HH:mm). */
  startReminderTime: string;

  /** Поздравлять, если завтра нерабочий день. */
  tomorrowOffEnabled: boolean;
  /** Время такого уведомления (HH:mm, время WPlan). */
  tomorrowOffTime: string;

  /** Автоклос включён. */
  autocloseEnabled: boolean;
  /** Время страховочного автоклоса (HH:mm), «конец суток». */
  autocloseTime: string;
  /** Показывать окно отмены перед автоклосом. */
  autocloseConfirm: boolean;
  /** Сколько секунд даётся на отмену. */
  autocloseConfirmSeconds: number;
  /** Учитывать переработки (см. план): ВКЛ → автоклос только в конце суток. */
  overtimeTracking: boolean;

  /** Автозапуск при входе в систему. */
  openAtLogin: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  host: 'https://wplan.office.lan',
  locale: 'ru-RU',
  loginDomain: 'office.lan',
  pollMinutes: 3,
  endReminderTimes: ['18:00', '20:00', '22:00'],
  startReminderEnabled: true,
  startReminderTime: '10:00',
  tomorrowOffEnabled: true,
  tomorrowOffTime: '13:00',
  autocloseEnabled: true,
  autocloseTime: '23:55',
  autocloseConfirm: true,
  autocloseConfirmSeconds: 60,
  overtimeTracking: true,
  openAtLogin: true,
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    console.error('saveSettings failed', e);
  }
}
