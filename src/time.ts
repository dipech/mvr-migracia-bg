export const ZONE = 'Europe/Sofia';
export function dayKey(at = Date.now()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (k: string) => p.find(v => v.type === k)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function parseTime(input: unknown, day: string): number | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const t = input.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (!t) return null;
  const [h, m, s] = t.slice(1).map(Number);
  if ((h === 0 && m === 0 && s === 0) || h > 23 || m > 59 || s > 59) return null;
  const d = input.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const [year, month, date] = (d ? `${d[3]}-${d[2]}-${d[1]}` : day).split('-').map(Number);
  const utc = Date.UTC(year, month - 1, date, h, m, s);
  // Resolve Sofia's UTC offset for the event date, including DST.
  let result = utc;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(result);
    const value = (type: string) => Number(parts.find(p => p.type === type)?.value);
    let delta = value('hour') * 3600 + value('minute') * 60 + value('second') - (h * 3600 + m * 60 + s);
    if (delta > 43200) delta -= 86400;
    if (delta < -43200) delta += 86400;
    result -= delta * 1000;
  }
  return Number.isFinite(result) ? result : null;
}
export function clock(at: number | null | undefined): string {
  return at == null ? '—' : new Intl.DateTimeFormat('ru', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(at);
}
export function minutes(seconds: number | null): string {
  return seconds === null ? '—' : seconds < 60 ? '< 1' : String(Math.round(seconds / 60));
}
export function duration(seconds: number): string {
  const mins = Math.max(0, Math.round(seconds / 60));
  return mins < 60 ? `${mins} мин` : `${Math.floor(mins / 60)} ч ${mins % 60} мин`;
}
