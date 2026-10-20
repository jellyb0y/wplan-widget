// GraphQL-клиент WPlan на Electron Session.fetch.
// Session.fetch использует сетевой стек Chromium → системный Keychain доверяет
// внутреннему корп. Sub-CA автоматически (в отличие от Node, где нужен --use-system-ca),
// и хранит cookie (connect.sid) персистентно в партиции 'persist:wplan'.
// Протокол — см. ~/projects/wplan-bot/API.md.
import { session, Session } from 'electron';
import { Credentials, DayState, LoginResult, WorkerInfo, WorkReport } from './types';

export class AuthError extends Error {}
export class ApiError extends Error {}

export class WplanApi {
  private ses: Session;
  private host: string;
  private locale: string;
  private loginDomain: string; // напр. "office.lan"; пусто → без суффикса

  constructor(opts: { host: string; locale: string; loginDomain: string }) {
    this.host = opts.host.replace(/\/+$/, '');
    this.locale = opts.locale;
    this.loginDomain = opts.loginDomain.trim();
    this.ses = session.fromPartition('persist:wplan');
  }

  update(opts: { host: string; locale: string; loginDomain: string }): void {
    this.host = opts.host.replace(/\/+$/, '');
    this.locale = opts.locale;
    this.loginDomain = opts.loginDomain.trim();
  }

  private get gqlUrl(): string {
    return `${this.host}/${this.locale}/api/graphql`;
  }

  private async xsrfHeader(): Promise<Record<string, string>> {
    try {
      const cookies = await this.ses.cookies.get({ name: 'XSRF-TOKEN' });
      if (cookies[0]?.value) {
        return { 'X-XSRF-TOKEN': decodeURIComponent(cookies[0].value) };
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.ses.fetch(this.gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await this.xsrfHeader()) },
        body: JSON.stringify({ query, variables }),
      });
    } catch (e) {
      throw new ApiError(`Сеть/TLS: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };
    if (body.errors?.length) {
      const msg = body.errors.map((e) => e.message).join('; ');
      if (/INVALID_USER_OR_PASSWORD|INVALID_TOKEN|UNAUTHORIZED|unauthenticated|token.*(expired|invalid)|jwt/i.test(msg)) {
        throw new AuthError(msg);
      }
      throw new ApiError(msg);
    }
    if (!body.data) throw new ApiError('Пустой ответ GraphQL');
    return body.data;
  }

  /** Вход. username — голый логин; @office.lan/source выставляются по useOfficeDomain. */
  async login(creds: Credentials): Promise<LoginResult> {
    const data = await this.gql<{
      jwtLogin: { _id: string; fio: string; login: string; role: string } | null;
    }>(
      `mutation Login($u:String!,$p:String!,$src:Float){
         jwtLogin(username:$u,password:$p,twoFactorCode:"",accessToken2Fa:"",
                  code:"",redirectUri:"",source:$src){ _id fio login role } }`,
      {
        u: this.loginDomain ? `${creds.username}@${this.loginDomain}` : creds.username,
        p: creds.password,
        src: this.loginDomain ? 1 : 2,
      }
    ).catch((e) => {
      // jwtLogin возвращает INVALID_USER_OR_PASSWORD с кодом INTERNAL_SERVER_ERROR
      if (/INVALID_USER_OR_PASSWORD/i.test((e as Error).message)) {
        throw new AuthError('Неверный логин или пароль');
      }
      throw e;
    });
    if (!data.jwtLogin) throw new AuthError('Вход не выполнен');
    const u = data.jwtLogin;
    return { id: u._id, fio: u.fio, login: u.login, role: u.role };
  }

  /** Текущий пользователь (ФИО/логин/роль) — работает и по cookie-сессии. */
  async getCurrentUser(): Promise<LoginResult | null> {
    const d = await this.gql<{
      currentUser: { _id: string; fio: string; login: string; role: string } | null;
    }>(`query{ currentUser{ _id fio login role } }`);
    if (!d.currentUser) return null;
    const u = d.currentUser;
    return { id: u._id, fio: u.fio, login: u.login, role: u.role };
  }

  /** Залогинены ли (есть рабочая сессия). */
  async isAuthenticated(): Promise<boolean> {
    try {
      await this.gql(`query{ startOrFinishDayButtonState{ isVisible } }`);
      return true;
    } catch (e) {
      if (e instanceof AuthError) return false;
      throw e;
    }
  }

  /**
   * Данные виджета «Рабочее время» (как на странице personal-data) из personalReport.
   * period = [startDate, endDate] (обычно 1-е число месяца … сегодня в tz WPlan):
   * overworkTimeTotal за этот период = «Переработка по периоду» = доступный остаток
   * переработок (WPlan сам учитывает месячный сброс). plannedLeaveTimeToday —
   * расчётное время ухода по полной норме.
   */
  async getWorkReport(startDate: string, endDate: string): Promise<WorkReport> {
    const d = await this.gql<{
      personalReport: {
        timeWorkedToday: number;
        timeLeftToday: number;
        plannedLeaveTimeToday: string | null;
        overworkTimeTotal: number;
        isHolidayToday: boolean;
        isAtWorkNow: boolean;
      };
    }>(
      `query($s:String!,$e:String!){ personalReport(startDate:$s,endDate:$e){
         timeWorkedToday timeLeftToday plannedLeaveTimeToday overworkTimeTotal
         isHolidayToday isAtWorkNow } }`,
      { s: startDate, e: endDate }
    );
    const r = d.personalReport;
    return {
      timeWorkedTodaySec: r.timeWorkedToday || 0,
      timeLeftTodaySec: r.timeLeftToday || 0,
      plannedLeaveTodayIso: r.plannedLeaveTimeToday ?? null,
      overworkTotalSec: r.overworkTimeTotal || 0,
      isHolidayToday: !!r.isHolidayToday,
      isAtWorkNow: !!r.isAtWorkNow,
    };
  }

  /** today — дата YYYY-MM-DD в часовом поясе WPlan. */
  async getDayState(today: string): Promise<DayState> {
    const d = await this.gql<{ startOrFinishDayButtonState: { isVisible: boolean; isStart: boolean } }>(
      `query{ startOrFinishDayButtonState{ isVisible isStart } }`
    );
    const st = d.startOrFinishDayButtonState;
    let startedAt: string | null = null;
    if (!st.isStart) {
      // день идёт — взять время старта последнего интервала за сегодня
      try {
        const ev = await this.gql<{ workTimeEventsForDate: Array<{ startTime: string; endTime: string | null }> }>(
          `query($d:String!){ workTimeEventsForDate(date:$d){ startTime endTime } }`,
          { d: today }
        );
        const last = ev.workTimeEventsForDate.at(-1);
        startedAt = last?.startTime ?? null;
      } catch {
        /* не критично */
      }
    }
    return { isVisible: st.isVisible, isStart: st.isStart, startedAt };
  }

  /** Начать (true) или завершить (false) день. */
  async startOrFinishDay(isStart: boolean): Promise<void> {
    await this.gql(`mutation($s:Boolean!){ startOrFinishDay(isStart:$s) }`, { s: isStart });
  }

  async getWorkerInfo(): Promise<WorkerInfo> {
    const d = await this.gql<{
      workerStartInfo: {
        workerId: number;
        workingHours: number;
        timeZoneIanaName: string | null;
        timeZoneRus: string | null;
        startWork: string | null;
      };
    }>(
      `query{ workerStartInfo{ workerId workingHours timeZoneIanaName timeZoneRus startWork } }`
    );
    return d.workerStartInfo;
  }

  /**
   * Нерабочий ли указанный день (выходной/праздник) — по WorkerDaySummary.dayType.
   * dayType===2 и непустая dailyNorm = рабочий день; иначе (dayType 0, пустая норма) — нерабочий.
   * (personalPresenceReport.isHoliday ненадёжен: меняется от диапазона запроса.)
   */
  async isNonWorkingDay(workerId: number, date: string): Promise<boolean> {
    const d = await this.gql<{ workerDaySummary: { dayType: number; dailyNorm: string } }>(
      `query($w:Float!,$d:String!){ workerDaySummary(workerId:$w,date:$d){ dayType dailyNorm } }`,
      { w: workerId, d: date }
    );
    const s = d.workerDaySummary;
    return s.dayType !== 2 || !s.dailyNorm;
  }

  async logout(): Promise<void> {
    try {
      await this.gql(`mutation{ logout }`);
    } catch {
      /* ignore */
    }
    try {
      await this.ses.clearStorageData({ storages: ['cookies'] });
    } catch {
      /* ignore */
    }
  }
}
