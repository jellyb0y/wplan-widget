// Работа со временем в часовом поясе WPlan (напр. Asia/Nicosia).
// Все напоминания/автоклос и вычисление «сегодня» считаем в tz сотрудника,
// а не в локальном времени Mac.

function parts(tz: string, d = new Date()): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** Часовой пояс Mac как запасной вариант. */
export function machineTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Дата YYYY-MM-DD в указанном tz. */
export function dateInTz(tz: string, d = new Date()): string {
  const p = parts(tz, d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Минуты от начала суток (0..1439) в указанном tz. */
export function minutesInTz(tz: string, d = new Date()): number {
  const p = parts(tz, d);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** "HH:mm" → минуты. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Знаковое "HHHH:MM:SS" (часы могут быть большими, возможен минус) → минуты. */
export function hmsToMinutes(s: string | null | undefined): number {
  if (!s) return 0;
  const neg = s.trim().startsWith('-');
  const p = s.replace('-', '').split(':').map(Number);
  const min = (p[0] || 0) * 60 + (p[1] || 0) + (p[2] || 0) / 60;
  return neg ? -min : min;
}
