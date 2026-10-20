// Состояние приложения: единый источник для UI. Источник правды — WPlan API.
import { EventEmitter } from 'events';
import { WplanApi, AuthError } from './wplanApi';
import { dateInTz, machineTz } from './time';
import { loadSettings, saveSettings, Settings } from './settings';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  hasCredentials,
} from './credentials';
import { AppStatus, Credentials, DayState, TodayInfo, WorkerInfo, WorkReport } from './types';

export interface AppState {
  status: AppStatus;
  fio: string | null;
  login: string | null;
  role: string | null;
  dayState: DayState | null;
  report: WorkReport | null;
  today: TodayInfo | null;
  worker: WorkerInfo | null;
  error: string | null;
}

export class Store extends EventEmitter {
  settings: Settings;
  private api: WplanApi;
  private pollTimer: NodeJS.Timeout | null = null;
  state: AppState = {
    status: 'loading',
    fio: null,
    login: null,
    role: null,
    dayState: null,
    report: null,
    today: null,
    worker: null,
    error: null,
  };

  constructor() {
    super();
    this.settings = loadSettings();
    this.api = new WplanApi(this.apiOpts());
  }

  private apiOpts() {
    return {
      host: this.settings.host,
      locale: this.settings.locale,
      loginDomain: this.settings.loginDomain,
    };
  }

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  isLoggedOut(): boolean {
    return this.state.status === 'logged_out';
  }

  /** Старт приложения: восстановить сессию и начать поллинг. */
  async init(): Promise<void> {
    await this.ensureSessionAndRefresh();
    this.startPolling();
  }

  private async ensureSessionAndRefresh(): Promise<void> {
    try {
      if (await this.api.isAuthenticated()) {
        await this.refresh();
        return;
      }
      // пробуем войти сохранённой учёткой
      const creds = hasCredentials() ? loadCredentials() : null;
      if (creds) {
        await this.api.login(creds);
        await this.refresh();
        return;
      }
      this.set({ status: 'logged_out', fio: null, error: null });
    } catch (e) {
      if (e instanceof AuthError) {
        this.set({ status: 'logged_out', error: null });
      } else {
        this.set({ status: 'error', error: (e as Error).message });
      }
    }
  }

  /** Явный вход по логину/паролю из окна авторизации. */
  async login(creds: Credentials): Promise<void> {
    const res = await this.api.login(creds); // кинет AuthError при неверных данных
    saveCredentials(creds);
    this.set({ fio: res.fio, login: res.login, role: res.role });
    await this.refresh();
  }

  async logout(): Promise<void> {
    await this.api.logout();
    clearCredentials();
    this.set({ status: 'logged_out', fio: null, login: null, role: null, dayState: null, report: null, today: null });
  }

  /** Часовой пояс WPlan (сотрудника), иначе — tz машины. */
  tz(): string {
    return this.state.worker?.timeZoneIanaName || machineTz();
  }

  /** Полное обновление состояния с сервера. Даты считаем в tz WPlan. */
  async refresh(reauth = true): Promise<void> {
    try {
      // worker нужен первым — из него берём часовой пояс и workerId
      const worker = this.state.worker ?? (await this.api.getWorkerInfo());
      const tz = worker.timeZoneIanaName || machineTz();
      const today = dateInTz(tz);

      // личность подтягиваем один раз (работает и по cookie-сессии)
      let { fio, login, role } = this.state;
      if (!fio) {
        const cu = await this.api.getCurrentUser();
        if (cu) ({ fio, login, role } = cu);
      }

      // personalReport за [1-е число месяца … сегодня] — как виджет на personal-data.
      // overworkTimeTotal за этот период = доступный остаток переработок (WPlan сам
      // учитывает месячный сброс); plannedLeaveTimeToday = расчётное время ухода.
      const monthStart = today.slice(0, 8) + '01';
      const [dayState, report] = await Promise.all([
        this.api.getDayState(today),
        this.api.getWorkReport(monthStart, today),
      ]);
      const todayInfo: TodayInfo = {
        date: today,
        isWorkingDay: !report.isHolidayToday,
        isHoliday: report.isHolidayToday,
      };

      const status: AppStatus = dayState.isStart ? 'not_started' : 'working';
      this.set({ status, dayState, worker, today: todayInfo, report, fio, login, role, error: null });
    } catch (e) {
      if (e instanceof AuthError) {
        // сессия/токен протухли — тихо перелогиниваемся сохранённой учёткой
        if (reauth) {
          const creds = hasCredentials() ? loadCredentials() : null;
          if (creds) {
            try {
              const res = await this.api.login(creds);
              this.set({ fio: res.fio, login: res.login, role: res.role });
              await this.refresh(false);
              return;
            } catch {
              /* падаем в logged_out ниже */
            }
          }
        }
        this.set({ status: 'logged_out', error: null });
      } else {
        this.set({ status: 'error', error: (e as Error).message });
      }
    }
  }

  async startDay(): Promise<void> {
    await this.api.startOrFinishDay(true);
    await this.refresh();
  }

  async finishDay(): Promise<void> {
    await this.api.startOrFinishDay(false);
    await this.refresh();
  }

  /** Применить новые настройки (напр. смена хоста) и переинициализировать клиент. */
  async applySettings(next: Settings): Promise<void> {
    const hostChanged =
      next.host !== this.settings.host ||
      next.locale !== this.settings.locale ||
      next.loginDomain !== this.settings.loginDomain;
    this.settings = next;
    saveSettings(next);
    if (hostChanged) {
      this.api.update(this.apiOpts());
      this.set({ worker: null });
      await this.ensureSessionAndRefresh();
    }
    this.startPolling(); // перезапуск с новым интервалом
    this.emit('change', this.state);
  }

  private failures = 0;
  private static readonly MAX_BACKOFF_MS = 30 * 60_000; // потолок 30 мин

  /**
   * Поллинг с экспоненциальным бэкоффом: при сбоях (сеть/сервер/не удалось
   * перелогиниться) задержка растёт base→2·base→4·base… до 30 мин и сбрасывается
   * при первом успехе. Чтобы не долбить упавший бэкенд.
   */
  startPolling(): void {
    this.failures = 0;
    this.scheduleNextPoll(this.baseIntervalMs());
  }

  private baseIntervalMs(): number {
    return Math.max(1, this.settings.pollMinutes) * 60_000;
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    const base = this.baseIntervalMs();
    // разлогинены без сохранённой учётки — ждём ручной вход, бэкенд не трогаем
    if (this.isLoggedOut() && !hasCredentials()) {
      this.scheduleNextPoll(base);
      return;
    }
    await this.refresh(); // сам пытается тихо перелогиниться при AuthError
    const bad = this.state.status === 'error' || this.state.status === 'logged_out';
    if (bad) {
      this.failures = Math.min(this.failures + 1, 10);
      this.scheduleNextPoll(Math.min(base * 2 ** this.failures, Store.MAX_BACKOFF_MS));
    } else {
      this.failures = 0;
      this.scheduleNextPoll(base);
    }
  }

  getApi(): WplanApi {
    return this.api;
  }
}
