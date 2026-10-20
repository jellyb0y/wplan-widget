// Общие типы приложения. Протокол WPlan — см. ~/projects/wplan-bot/API.md.

/** Состояние дня из WPlan (источник правды — сервер). */
export interface DayState {
  /** Кнопка видима (день доступен к старту/завершению). */
  isVisible: boolean;
  /** true → день НЕ начат (кнопка «Начать»); false → день идёт (кнопка «Завершить»). */
  isStart: boolean;
  /** Время старта сегодняшнего дня (ISO), если найдено. */
  startedAt: string | null;
}

/** Мини-статистика (из personalPresenceReport). Время — строки "HH:MM:SS". */
export interface PresenceStats {
  workTimeToday: string | null;
  workTimePeriod: string;
  divergence: string; // отклонение от нормы за период (может быть "")
  periodStart: string;
  periodEnd: string;
}

/** Инфо о сегодняшнем дне. */
export interface TodayInfo {
  date: string;
  isWorkingDay: boolean;
  isHoliday: boolean;
}

/**
 * Данные виджета «Рабочее время» из personalReport (как на personal-data).
 * Время — в секундах; plannedLeaveTodayIso — ISO расчётного времени ухода (полная норма).
 */
export interface WorkReport {
  timeWorkedTodaySec: number;
  timeLeftTodaySec: number; // остаток до полной нормы (8:30)
  plannedLeaveTodayIso: string | null; // расчётное время ухода (полная норма)
  overworkTotalSec: number; // «переработка по периоду» = доступный остаток переработок
  isHolidayToday: boolean;
  isAtWorkNow: boolean;
}

/** Инфо о сотруднике (workerStartInfo). */
export interface WorkerInfo {
  workerId: number;
  workingHours: number;
  timeZoneIanaName: string | null;
  timeZoneRus: string | null;
  startWork: string | null;
}

/** Учётные данные. */
export interface Credentials {
  username: string; // голый логин, напр. "ivanov.i"
  password: string;
}

/** Результат логина. */
export interface LoginResult {
  id: string;
  fio: string;
  login: string;
  role: string;
}

/** Общий статус приложения для UI/иконки. */
export type AppStatus = 'working' | 'not_started' | 'error' | 'logged_out' | 'loading';
