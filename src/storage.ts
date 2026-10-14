import type { AppState, QueueTicket } from './types';
import { dayKey } from './time';
export const STORAGE_KEY = 'migration-queue:v1';
export function emptyState(now = Date.now()): AppState {
  return { version: 1, day: dayKey(now), tracked: [], snapshot: null, records: [], intervals: [], messages: [], settings: { sound: false, wakeLock: false, notifications: false }, lastSuccess: null };
}
export function rollDay(state: AppState, now = Date.now()): AppState {
  if (state.day === dayKey(now)) return state;
  return { ...state, day: dayKey(now), snapshot: null, records: [], intervals: [], messages: [], lastSuccess: null,
    tracked: state.tracked.map(t => ({ ...t, forecast: null, predictions: [], error: undefined })) };
}
const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const nullableNum = (x: unknown) => x === null || finite(x);
const string = (x: unknown): x is string => typeof x === 'string';
const numbers = (x: unknown) => Array.isArray(x) && x.every(finite);
function validTicket(t: unknown): t is QueueTicket {
  if (!plain(t)) return false;
  return ['id','number','service','statusText','priority'].every(k => string(t[k])) && finite(t.status) && numbers(t.desks) && ['desk','taken','called','arrived','finished','forecastSeconds','waitMinutes'].every(k => nullableNum(t[k])) && finite(t.calls);
}
export function validateState(value: unknown): AppState {
  if (!plain(value) || value.version !== 1 || !string(value.day) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !Array.isArray(value.tracked) || !Array.isArray(value.records) || !Array.isArray(value.intervals) || !Array.isArray(value.messages) || !plain(value.settings)) throw new Error('Неподдерживаемый формат сохранения');
  if (!['sound','wakeLock','notifications'].every(k => typeof (value.settings as Record<string, unknown>)[k] === 'boolean') || !nullableNum(value.lastSuccess)) throw new Error('Повреждены настройки');
  if (!value.records.every(validTicket)) throw new Error('Повреждена история талонов');
  for (const t of value.tracked) {
    if (!plain(t) || !['qr','id','number','service','serviceId','day'].every(k => string(t[k])) || !/^[A-Za-z0-9]{6,64}$/.test(t.qr as string) || !numbers(t.desks) || !finite(t.addedAt) || !finite(t.metadataAt) || (t.last !== null && !validTicket(t.last)) || !plain(t.alerts) || !numbers(t.alerts.thresholds) || typeof t.alerts.called !== 'boolean' || !Array.isArray(t.predictions)) throw new Error('Повреждён сохранённый талон');
    if (!t.predictions.every(p => plain(p) && finite(p.at) && finite(p.seconds) && nullableNum(p.officialSeconds) && finite(p.ahead))) throw new Error('Повреждены прогнозы');
    if (t.forecast !== null && (!plain(t.forecast) || !finite(t.forecast.at) || !['ahead','officialAhead','officialSeconds','seconds','low','high'].every(k => nullableNum((t.forecast as Record<string, unknown>)[k])) || !finite(t.forecast.samples) || !['observed','preliminary'].includes(String(t.forecast.confidence)) || !string(t.forecast.reason) || !Array.isArray(t.forecast.notes) || !t.forecast.notes.every(string))) throw new Error('Повреждён прогноз');
  }
  if (value.snapshot !== null) {
    const s = value.snapshot;
    if (!plain(s) || !finite(s.at) || !Array.isArray(s.tickets) || !s.tickets.every(validTicket) || !Array.isArray(s.desks) || !s.desks.every(d => plain(d) && finite(d.number) && nullableNum(d.status) && (d.ticketId === null || string(d.ticketId)) && ['statusText','ticketNumber','service'].every(k => string(d[k])) && nullableNum(d.called) && finite(d.dailyPeople))) throw new Error('Повреждены данные очереди');
  }
  if (!value.intervals.every(i => plain(i) && finite(i.desk) && finite(i.start) && finite(i.end) && i.end >= i.start && ['serving','called','no-show','idle','closed','unknown'].includes(String(i.state)) && ['observed','api'].includes(String(i.source)) && (i.ticketId === null || string(i.ticketId)) && string(i.ticketNumber) && string(i.service) && typeof i.uncertain === 'boolean')) throw new Error('Повреждена история окон');
  if (!value.messages.every(m => plain(m) && string(m.id) && string(m.text) && string(m.ticketId) && finite(m.at))) throw new Error('Повреждены уведомления');
  // Whitelist the complete known shape: discard foreign QR fields and arbitrary properties.
  const ticket = (t: QueueTicket): QueueTicket => ({ id:t.id, number:t.number, service:t.service, status:t.status, statusText:t.statusText, desks:[...t.desks], desk:t.desk, priority:t.priority, taken:t.taken, called:t.called, arrived:t.arrived, finished:t.finished, forecastSeconds:t.forecastSeconds, waitMinutes:t.waitMinutes, calls:t.calls });
  const state = value as unknown as AppState;
  return { version:1, day:state.day, settings:{ sound:state.settings.sound, wakeLock:state.settings.wakeLock, notifications:state.settings.notifications }, lastSuccess:state.lastSuccess,
    records:state.records.map(ticket), tracked:state.tracked.map(t => ({ qr:t.qr, id:t.id, number:t.number, service:t.service, serviceId:t.serviceId, desks:[...t.desks], day:t.day, addedAt:t.addedAt, metadataAt:t.metadataAt, last:t.last ? ticket(t.last):null, ...(typeof t.error === 'string' ? {error:t.error} : {}), forecast:t.forecast ? { at:t.forecast.at, ahead:t.forecast.ahead, officialAhead:t.forecast.officialAhead, officialSeconds:t.forecast.officialSeconds, seconds:t.forecast.seconds, low:t.forecast.low, high:t.forecast.high, samples:t.forecast.samples, confidence:t.forecast.confidence, reason:t.forecast.reason, notes:[...t.forecast.notes] }:null, alerts:{ thresholds:[...t.alerts.thresholds], called:t.alerts.called }, predictions:t.predictions.map(p=>({at:p.at,seconds:p.seconds,officialSeconds:p.officialSeconds,ahead:p.ahead})) })),
    snapshot:state.snapshot ? { at:state.snapshot.at, tickets:state.snapshot.tickets.map(ticket), desks:state.snapshot.desks.map(d=>({number:d.number,status:d.status,statusText:d.statusText,ticketId:d.ticketId,ticketNumber:d.ticketNumber,service:d.service,called:d.called,dailyPeople:d.dailyPeople})) }:null,
    intervals:state.intervals.map(i=>({desk:i.desk,ticketId:i.ticketId,ticketNumber:i.ticketNumber,service:i.service,start:i.start,end:i.end,state:i.state,source:i.source,uncertain:i.uncertain})),
    messages:state.messages.map(m=>({id:m.id,ticketId:m.ticketId,text:m.text,at:m.at})) };
}
export function loadState(): { state: AppState; error: string } {
  try { const raw = localStorage.getItem(STORAGE_KEY); return { state: raw ? rollDay(validateState(JSON.parse(raw))) : emptyState(), error: '' }; }
  catch { return { state: emptyState(), error: 'Не удалось прочитать сохранение. Оно не перезаписано. Для восстановления используйте «Сбросить приложение» в настройках.' }; }
}
export function compactState(state: AppState): AppState {
  return { ...state, tracked:state.tracked.map(t => ({ ...t, predictions:t.predictions.filter((p,i,a) => i === 0 || i === a.length - 1 || p.ahead !== a[i-1].ahead || Math.floor(p.at / 60000) !== Math.floor(a[i-1].at / 60000)) })) };
}
export function saveState(state: AppState): { state: AppState; error: string } {
  let candidate = state;
  let json = JSON.stringify(candidate);
  if (json.length * 2 > 3_500_000) { candidate = compactState(state); json = JSON.stringify(candidate); }
  try { localStorage.setItem(STORAGE_KEY, json); return { state:candidate, error:'' }; }
  catch { return { state:candidate, error:'Не удалось сохранить данные: хранилище заполнено или недоступно. Новые наблюдения пока остаются в памяти. При необходимости используйте «Сбросить приложение» в настройках.' }; }
}
