// WPlan GraphQL client. ВАЖНО: запускать через `node --use-system-ca`,
// иначе TLS падает с SELF_SIGNED_CERT_IN_CHAIN (внутренний корп. Sub-CA).
// Разведка протокола и примеры — см. API.md.

const BASE = process.env.WPLAN_BASE ?? 'https://wplan.office.lan';
const GQL = `${BASE}/ru-RU/api/graphql`;

export class WplanClient {
  #cookies = {};
  #bearer = '';
  fio = null;

  #cookieHeader() {
    return Object.entries(this.#cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  #store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      this.#cookies[kv.slice(0, i)] = kv.slice(i + 1);
    }
  }

  async gql(query, variables = {}) {
    const res = await fetch(GQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: this.#cookieHeader(),
        ...(this.#bearer ? { Authorization: `Bearer ${this.#bearer}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
    this.#store(res);
    const body = await res.json().catch(() => ({}));
    if (body.errors?.length) {
      throw new Error('GraphQL: ' + body.errors.map((e) => e.message).join('; '));
    }
    return body.data;
  }

  // username: голый логин, напр. "ivanov.i" — @office.lan дописывается при domain=true
  async login({ username, password, domain = true, twoFactorCode = '', accessToken2Fa = '' }) {
    this.#store(await fetch(`${BASE}/sign-in`)); // получить стартовые cookie
    const data = await this.gql(
      `mutation Login($u:String!,$p:String!,$tfc:String,$at2:String,$src:Float){
         jwtLogin(username:$u,password:$p,twoFactorCode:$tfc,accessToken2Fa:$at2,
                  code:"",redirectUri:"",source:$src){ _id fio login role accessToken } }`,
      {
        u: domain ? `${username}@office.lan` : username,
        p: password,
        tfc: twoFactorCode,
        at2: accessToken2Fa,
        src: domain ? 1 : 2,
      }
    );
    this.#bearer = data.jwtLogin.accessToken;
    this.fio = data.jwtLogin.fio;
    return data.jwtLogin;
  }

  // { isVisible, isStart }. isStart:true → день НЕ начат; false → день идёт.
  async dayButtonState() {
    const d = await this.gql(`query{ startOrFinishDayButtonState{ isVisible isStart } }`);
    return d.startOrFinishDayButtonState;
  }

  async startOrFinishDay(isStart) {
    return this.gql(`mutation($s:Boolean!){ startOrFinishDay(isStart:$s) }`, { s: isStart });
  }

  async workerStartInfo() {
    const d = await this.gql(
      `query{ workerStartInfo{ workerId workingHours timeZoneIanaName timeZoneRus startWork
              schedule{ id daysOff remoteDays } } }`
    );
    return d.workerStartInfo;
  }

  async eventsForDate(date /* YYYY-MM-DD */) {
    const d = await this.gql(`query($d:String!){ workTimeEventsForDate(date:$d){ startTime endTime } }`, { d: date });
    return d.workTimeEventsForDate;
  }

  async scheduleMonth(month /* YYYY-MM-01 */, workerId) {
    const d = await this.gql(
      `query($m:String!,$w:Float!){ personalSchedulesMonth(workerId:$w,month:$m){
         date dayType isHoliday isWithPersonalSchedule workTime } }`,
      { m: month, w: workerId }
    );
    return d.personalSchedulesMonth;
  }
}
