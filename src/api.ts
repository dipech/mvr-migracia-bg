import { normalizeDesks, normalizeTickets, num, object } from './normalize';
import { dayKey } from './time';
import type { QueueSnapshot, TrackedTicket } from './types';
export const ORIGIN = 'https://mvr-migracia.sky.bg';
export function parseQr(input: string): string {
  const s = input.trim();
  if (/^[A-Za-z0-9]{6,64}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.origin !== ORIGIN || u.pathname !== '/customer.html' || u.username || u.password) throw new Error();
    const qr = u.searchParams.get('qr');
    if (qr && /^[A-Za-z0-9]{6,64}$/.test(qr)) return qr;
  } catch { /* A QR must never select the fetch origin. */ }
  throw new Error('Нужна ссылка с QR талона Миграции или сам код. Номер вроде C228 не подходит.');
}
export async function getJson(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const url = new URL(path, ORIGIN); Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Миграция отвечает HTTP ${response.status}. Повторим запрос автоматически.`);
  return response.json();
}
export async function metadata(qr: string, existing?: TrackedTicket, signal?: AbortSignal): Promise<TrackedTicket> {
  const r = object(await getJson('/customer.json', { qr }, signal));
  if (num(r.error) === 1) throw new Error('Талон с таким QR не найден');
  if (num(r.error) === 2) throw new Error('Срок доступа к талону истёк');
  if (num(r.error) !== 0 || !r.ticket_id || !r.service_id || !r.ticket) throw new Error('Неполный ответ о талоне');
  const service = object(await getJson('/service_on_desk.json', { service: String(r.service_id) }, signal));
  if (!Array.isArray(service.desks)) throw new Error('Не удалось определить окна услуги');
  const desks = service.desks.map(d => num(object(d).number));
  if (desks.some(n => n === null)) throw new Error('Некорректные номера окон');
  const now = Date.now();
  return { qr, id: String(r.ticket_id), number: String(r.ticket), service: String(r.service).trim(), serviceId: String(r.service_id),
    desks: desks as number[], day: existing?.day ?? dayKey(now), addedAt: existing?.addedAt ?? now, metadataAt: now,
    last: existing?.last ?? null, forecast: existing?.forecast ?? null, alerts: existing?.alerts ?? { thresholds: [], called: false }, predictions: existing?.predictions ?? [] };
}
export async function snapshot(qr: string, signal?: AbortSignal): Promise<QueueSnapshot> {
  const [tickets, desks] = await Promise.all([getJson('/online-tickets.json', { filter: '2', qr }, signal), getJson('/online-desks.json', { qr }, signal)]);
  const at = Date.now(), day = dayKey(at);
  return { at, tickets: normalizeTickets(tickets, day), desks: normalizeDesks(desks, day) };
}
