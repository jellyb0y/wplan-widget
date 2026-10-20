// Dev-проверка API-слоя внутри Electron (net/session доступны только тут).
// Запуск: WPLAN_USERNAME=ivanov.i WPLAN_PASSWORD=... npm run probe
// День НЕ начинаем и НЕ завершаем — только чтение.
import { app } from 'electron';
import { WplanApi } from './wplanApi';
import { DEFAULT_SETTINGS } from './settings';
import { dateInTz, machineTz } from './time';

app.whenReady().then(async () => {
  const username = process.env.WPLAN_USERNAME;
  const password = process.env.WPLAN_PASSWORD;
  const api = new WplanApi({
    host: process.env.WPLAN_HOST || DEFAULT_SETTINGS.host,
    locale: DEFAULT_SETTINGS.locale,
    loginDomain: DEFAULT_SETTINGS.loginDomain,
  });

  try {
    if (username && password) {
      const u = await api.login({ username, password });
      console.log('LOGIN OK:', u.fio, '|', u.role);
    } else if (await api.isAuthenticated()) {
      console.log('LOGIN: использую сохранённую сессию (cookie)');
    } else {
      console.log('Нет учётки: задай WPLAN_USERNAME/WPLAN_PASSWORD');
      app.exit(1);
      return;
    }

    const info = await api.getWorkerInfo();
    console.log('WORKER:', JSON.stringify(info));

    const tz = info.timeZoneIanaName || machineTz();
    const todayStr = dateInTz(tz);
    const monthStart = todayStr.slice(0, 8) + '01';
    console.log('TZ:', tz, '| сегодня по WPlan:', todayStr);

    const state = await api.getDayState(todayStr);
    console.log('DAY STATE:', JSON.stringify(state), state.isStart ? '(день не начат)' : '(день идёт)');

    const report = await api.getWorkReport(monthStart, todayStr);
    console.log('WORK REPORT (месяц..сегодня):', JSON.stringify(report));

    app.exit(0);
  } catch (e) {
    console.error('PROBE ERROR:', (e as Error).message);
    app.exit(1);
  }
});
