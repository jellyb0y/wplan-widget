// Мок-preload для скриншотов окон (подставляет демо-данные вместо реального IPC).
const { contextBridge } = require('electron');

const settings = {
  host: 'https://wplan.office.lan',
  locale: 'ru-RU',
  loginDomain: 'office.lan',
  pollMinutes: 3,
  startReminderEnabled: true,
  startReminderTime: '10:00',
  tomorrowOffEnabled: true,
  tomorrowOffTime: '13:00',
  endReminderTimes: ['18:00', '20:00', '22:00'],
  autocloseEnabled: true,
  autocloseTime: '23:55',
  autocloseConfirm: true,
  autocloseConfirmSeconds: 60,
  overtimeTracking: false,
  openAtLogin: true,
};
const userinfo = {
  fio: 'Иванов Иван Иванович',
  login: 'ivanov.i',
  role: 'Исполнитель',
  host: 'https://wplan.office.lan',
  tz: 'Asia/Nicosia',
  authorized: true,
};

contextBridge.exposeInMainWorld('api', {
  invoke: async (ch) =>
    ch === 'settings:get'
      ? settings
      : ch === 'settings:userinfo'
        ? userinfo
        : ch === 'auth:host'
          ? 'wplan.office.lan'
          : { ok: true },
  on: (ch, cb) => {
    if (ch === 'autoclose:init') setTimeout(() => cb(60), 50);
  },
});
