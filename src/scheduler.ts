// Планировщик: напоминания о старте/завершении дня и страховочный автоклос.
// Устойчив ко сну: тикаем раз в 30с и проверяем «пройденные» точки, плюс
// немедленный тик на powerMonitor.resume. Каждую точку шлём один раз в день.
import { powerMonitor } from 'electron';
import { Store } from './store';
import { notify } from './notifications';
import { dateInTz, minutesInTz, hhmmToMinutes } from './time';

type FirePoint = {
  key: string;
  time: string; // HH:mm
  graceMinutes: number; // в течение скольки минут после времени ещё уместно сработать
  run: () => void | Promise<void>;
};

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private firedToday = new Set<string>();
  private firedDate = '';

  constructor(
    private store: Store,
    /** Запросить подтверждение автоклоса; resolve(true) = закрывать. */
    private confirmAutoclose: () => Promise<boolean>
  ) {}

  start(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick(), 30_000);
    powerMonitor.on('resume', () => void this.tick());
    powerMonitor.on('unlock-screen', () => void this.tick());
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private resetIfNewDay(tzDate: string): void {
    if (tzDate !== this.firedDate) {
      this.firedDate = tzDate;
      this.firedToday.clear();
    }
  }

  private points(): FirePoint[] {
    const s = this.store.settings;
    const pts: FirePoint[] = [];

    if (s.startReminderEnabled) {
      pts.push({
        key: 'start',
        time: s.startReminderTime,
        graceMinutes: 120,
        run: () => {
          const st = this.store.state;
          if (st.today?.isWorkingDay && st.dayState?.isStart) {
            notify({
              title: 'WPlan',
              body: 'Пора начать рабочий день',
              onClick: () => void this.store.startDay(),
            });
          }
        },
      });
    }

    for (const t of s.endReminderTimes) {
      pts.push({
        key: `end-${t}`,
        time: t,
        graceMinutes: 90,
        run: () => {
          const st = this.store.state;
          if (st.today?.isWorkingDay && st.dayState && !st.dayState.isStart) {
            notify({
              title: 'WPlan',
              body: 'Пора завершить рабочий день. Нажмите, чтобы завершить.',
              onClick: () => void this.store.finishDay(),
            });
          }
        },
      });
    }

    if (s.tomorrowOffEnabled) {
      pts.push({
        key: 'tomorrow-off',
        time: s.tomorrowOffTime,
        graceMinutes: 180,
        run: async () => {
          const st = this.store.state;
          if (!st.today?.isWorkingDay) return; // сегодня и так нерабочий — не поздравляем
          if (!st.worker) return;
          const tz = this.store.tz();
          const tomorrow = dateInTz(tz, new Date(Date.now() + 864e5));
          let off = false;
          try {
            off = await this.store.getApi().isNonWorkingDay(st.worker.workerId, tomorrow);
          } catch {
            return;
          }
          if (!off) return;
          const dow = new Date(tomorrow + 'T00:00:00Z').getUTCDay(); // 0=вс, 6=сб
          const weekend = dow === 0 || dow === 6;
          notify({
            title: '🎉 Завтра не работаем',
            body: weekend
              ? 'Завтра выходной — хорошего отдыха!'
              : 'Завтра нерабочий день — отдыхайте!',
          });
        },
      });
    }

    if (s.autocloseEnabled) {
      pts.push({
        key: 'autoclose',
        time: s.autocloseTime,
        graceMinutes: 240, // можно сработать позже (напр. после пробуждения), пока сегодня
        run: async () => {
          const st = this.store.state;
          if (!st.dayState || st.dayState.isStart) return; // день уже не открыт
          if (s.autocloseConfirm) {
            const ok = await this.confirmAutoclose();
            if (!ok) return;
          }
          await this.store.finishDay();
          notify({ title: 'WPlan', body: 'День автоматически завершён', silent: true });
        },
      });
    }

    return pts;
  }

  private async tick(): Promise<void> {
    if (this.store.isLoggedOut()) return;
    // всё считаем в часовом поясе WPlan (напр. Asia/Nicosia)
    const tz = this.store.tz();
    this.resetIfNewDay(dateInTz(tz));
    const nowMin = minutesInTz(tz);

    for (const p of this.points()) {
      if (this.firedToday.has(p.key)) continue;
      const ptMin = hhmmToMinutes(p.time);
      const diffMin = nowMin - ptMin;
      if (diffMin >= 0 && diffMin <= p.graceMinutes) {
        this.firedToday.add(p.key);
        try {
          await p.run();
        } catch (e) {
          console.error('scheduler point failed', p.key, e);
        }
      }
    }
  }
}
