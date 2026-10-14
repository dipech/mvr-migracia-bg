import type { Desk, QueueTicket } from './types';
import { parseTime } from './time';
type Raw = Record<string, unknown>;
export function object(value: unknown): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Неожиданный формат ответа Миграции');
  return value as Raw;
}
export function num(v: unknown): number | null {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
const str = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
export function rows(value: unknown): Raw[] {
  const root = object(value);
  if (Number(root.error || 0) !== 0) throw new Error('Миграция временно не возвращает данные по этому QR');
  if (!root.data || typeof root.data !== 'object') throw new Error('Неполный ответ Миграции');
  const result = Object.values(root.data).map(object);
  if (!result.length) throw new Error('Миграция вернула пустой список');
  return result;
}
export function normalizeTickets(value: unknown, day: string): QueueTicket[] {
  return rows(value).map(r => {
    if (!str(r.ticket_id) || !str(r.ticket_num) || num(r.ticket_status_id) === null || typeof r.service_desk !== 'string') throw new Error('Неполные данные талона');
    return {
      id: str(r.ticket_id), number: str(r.ticket_num), service: str(r.service_name).trim(),
      status: num(r.ticket_status_id)!, statusText: str(r.ticket_status),
      desks: [...new Set([...str(r.service_desk).matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])))],
      desk: num(r.desk_number), priority: str(r.ticket_priority),
      taken: parseTime(r.date_time_taken, day), called: parseTime(r.date_time_called, day),
      arrived: parseTime(r.date_time_arrived, day), finished: parseTime(r.finish_date, day),
      forecastSeconds: num(r.forecast_time), waitMinutes: num(r.ticket_wait_min), calls: num(r.called) ?? 0,
    };
  });
}
export function normalizeDesks(value: unknown, day: string): Desk[] {
  return rows(value).map(r => {
    const number = num(r.number); if (number === null) throw new Error('Неполные данные окна');
    return { number, status: num(r.user_status_id), statusText: str(r.user_status),
      ticketId: str(r.ticket_id) || null, ticketNumber: str(r.ticket_no), service: str(r.service).trim(),
      called: parseTime(r.date_time_called, day), dailyPeople: num(r.daily_people) ?? 0 };
  });
}
export const statuses: Record<number, string> = { 0: 'В очереди', 1: 'Вас вызывают', 2: 'Обслуживается', 3: 'Приостановлен', 4: 'Перенаправлен', 8: 'Неявка', 9: 'Завершён' };
export function statusLabel(status?: number) { return status == null ? 'Загружаем' : statuses[status] ?? `Неизвестный статус (${status})`; }
