import { metadata, parseQr, snapshot, TicketAccessError } from './api';
import { updateAlerts, playSound, systemNotification } from './alerts';
import { makeForecast } from './forecast';
import { currentDesk, POLL_INTERVAL, RETRY_INTERVALS } from './current';
import { mergeRecords, observeDesks } from './history';
import { emptyState, loadState, rollDay, saveState, STORAGE_KEY } from './storage';
import type { AlertMessage, AppState, QueueSnapshot, TrackedTicket } from './types';
import { dayKey } from './time';
import { demoState } from './demo';

interface View {
  data: AppState; error: string; storageError: string;
  loading: boolean; demo: boolean; lastAttempt: number | null;
}
const initial = loadState();
let view: View = { data: initial.state, error: '', storageError: initial.error, loading: false, demo: false, lastAttempt: null };
let protectedStorage = !!initial.error;
const listeners = new Set<() => void>();
const emit = (patch: Partial<View>) => { view = { ...view, ...patch }; listeners.forEach(f => f()); };
const NEXT_POLL = 'migration-queue:next-poll';
const FAILURES = 'migration-queue:failures';
const LAST_REQUEST = 'migration-queue:last-request';
const REQUEST_SCOPE = 'migration-queue:request-scope';
const unavailable = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false, running = false;

async function locked<T>(fn: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request('migration-queue:writer', fn);
  throw new Error('Этот браузер не поддерживает безопасную синхронизацию вкладок. Откройте приложение в актуальном Safari или Chrome.');
}
function latest(): AppState {
  if (view.demo) return view.data;
  const stored = loadState();
  if (stored.error) { protectedStorage = true; throw new Error(stored.error); }
  // Keep observations in memory when the latest write exceeded storage quota.
  if (view.storageError && !protectedStorage) return rollDay(view.data);
  return stored.state;
}
function commit(data: AppState) {
  if (view.demo) { emit({ data }); return; }
  if (protectedStorage) throw new Error('Сохранение защищено от перезаписи. Используйте «Сбросить приложение» в настройках.');
  const result = saveState(data);
  emit({ data: result.state, storageError: result.error });
}
function schedule() {
  clearTimeout(timer);
  if (!running || view.demo) return;
  let due = 0;
  try { due = Number(localStorage.getItem(NEXT_POLL) || 0); } catch { /* Storage error is shown in the UI. */ }
  const delay = Math.max(1000, Math.min(60000, due - Date.now()));
  timer = setTimeout(() => void poll(), delay);
}

async function poll(force = false) {
  const requestedAt = Date.now();
  if (busy || view.demo || protectedStorage || document.visibilityState === 'hidden') { schedule(); return; }
  busy = true;
  try {
    await locked(async () => {
      if (view.demo || document.visibilityState === 'hidden') return;
      let data = latest();
      if (data.day !== view.data.day) commit(data);
      // The QR remains useful for the live board after its owner's service is complete.
      const today = data.tracked.filter(t => t.day === data.day);
      if (!today.length) {
        emit({ data, loading: false, error: data.tracked.length ? 'Нет QR текущего дня. Добавьте новый талон для обновления окон.' : '' });
        return;
      }
      const nextAt = Number(localStorage.getItem(NEXT_POLL) || 0);
      const requestScope = today.map(t => t.id).sort().join(',');
      const updatedWhileWaiting = Number(localStorage.getItem(LAST_REQUEST) || 0) >= requestedAt
        && localStorage.getItem(REQUEST_SCOPE) === requestScope;
      if ((!force && Date.now() < nextAt) || (force && updatedWhileWaiting)) { emit({ data }); return; }
      emit({ loading: true, lastAttempt: Date.now() });
      localStorage.setItem(LAST_REQUEST, String(Date.now()));
      localStorage.setItem(REQUEST_SCOPE, requestScope);
      try {
        const refreshed = await Promise.all(today.map(async t => {
          if (unavailable.has(t.qr)) return { ...t, error: unavailable.get(t.qr) };
          if (Date.now() - t.metadataAt < 60000) return t;
          try { return await metadata(t.qr, t); }
          catch (e) {
            if (e instanceof TicketAccessError) unavailable.set(t.qr, errorText(e));
            return { ...t, error: errorText(e) };
          }
        }));
        const metadataById = new Map(refreshed.map(t => [t.id, t]));
        data = { ...data, tracked: data.tracked.map(t => metadataById.get(t.id) ?? t) };
        const responses: QueueSnapshot[] = [];
        const perTicket = new Map<string, QueueSnapshot>();
        for (const t of refreshed) {
          if (unavailable.has(t.qr)) continue;
          const shared = responses.find(r => r.tickets.some(ticket => ticket.id === t.id));
          if (shared) { perTicket.set(t.id, shared); continue; }
          try {
            const response = await snapshot(t.qr);
            perTicket.set(t.id, response);
            responses.push(response);
          } catch (e) { t.error = errorText(e); }
        }
        // Use one complete current response for the board, never a union of old windows.
        const fresh = responses.at(-1);
        if (!fresh) {
          commit(data);
          throw new Error(refreshed.find(t => t.error)?.error || 'Не удалось обновить очередь. Добавьте действующий талон.');
        }
        if (dayKey(fresh.at) !== data.day) { commit(rollDay(data, fresh.at)); return; }
        let records = data.records;
        for (const response of responses) records = mergeRecords(records, response.tickets);
        const intervals = observeDesks(data.intervals, data.snapshot, fresh);
        const messages: AlertMessage[] = [];
        const updated = data.tracked.map(t => {
          if (t.day !== data.day) return t;
          if (unavailable.has(t.qr)) return { ...t, error: unavailable.get(t.qr) };
          const source = perTicket.get(t.id);
          const found = source?.tickets.find(r => r.id === t.id);
          if (!source || !found) return { ...t, error: t.error || 'Талон отсутствует в ответе. Последний статус сохранён.' };
          const inconsistent = t.desks.some(n => {
            const desk = source.desks.find(d => d.number === n);
            return !desk || currentDesk(desk, source).inconsistent;
          });
          // Keep the last estimate during an inconsistent poll, without firing new alerts.
          if (inconsistent && found.status === 0) return { ...t, last: found, error: 'Данные окон уточняются.' };
          const forecast = found.status === 0 && !inconsistent ? makeForecast(t, source, records, intervals) : null;
          const predictions = [...t.predictions];
          if (forecast?.seconds != null && forecast.ahead !== null) predictions.push({ at: source.at, seconds: forecast.seconds, officialSeconds: forecast.officialSeconds, ahead: forecast.ahead });
          const result = updateAlerts({ ...t, last: found, forecast, predictions, error: inconsistent && found.status === 0 ? 'Данные окон уточняются.' : undefined }, fresh.at);
          if (result.message) messages.push(result.message);
          return result.ticket;
        });
        data = { ...data, tracked: updated, snapshot: fresh, records, intervals, messages: [...data.messages, ...messages].slice(-100), lastSuccess: fresh.at };
        commit(data);
        if (!view.storageError) for (const message of messages) {
          if (data.settings.sound) playSound();
          if (data.settings.notifications) void systemNotification(message.text);
        }
        localStorage.setItem(FAILURES, '0');
        localStorage.setItem(NEXT_POLL, String(Date.now() + POLL_INTERVAL));
        emit({ error: '' });
      } catch (e) {
        const failures = Math.max(0, Number(localStorage.getItem(FAILURES) || 0));
        localStorage.setItem(FAILURES, String(failures + 1));
        localStorage.setItem(NEXT_POLL, String(Date.now() + RETRY_INTERVALS[Math.min(failures, RETRY_INTERVALS.length - 1)]));
        emit({ error: errorText(e) });
      } finally { emit({ loading: false }); }
    });
  } catch (e) { emit({ error: errorText(e), loading: false }); }
  finally { busy = false; schedule(); }
}

function onStorage(e: StorageEvent) {
  if (e.key === STORAGE_KEY && !view.demo && !busy) {
    const state = loadState();
    emit({ data: state.state, storageError: state.error });
  }
}
const onOnline = () => void poll(true);
const onVisibility = () => { if (document.visibilityState === 'visible') void poll(true); };
export function errorText(error: unknown): string {
  return error instanceof Error ? (error.name === 'TypeError' ? 'Нет связи с Миграцией. Проверьте интернет; повторим запрос автоматически.' : error.message) : 'Не удалось выполнить действие';
}
export const engine = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  getSnapshot: () => view,
  start() {
    if (running) return;
    running = true;
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    void poll();
  },
  stop() {
    running = false; clearTimeout(timer);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
  },
  refresh: () => poll(true),
  async add(input: string) {
    const qr = parseQr(input);
    const duplicate = view.data.tracked.find(t => t.qr === qr);
    if (duplicate) return duplicate.id;
    if (view.demo) throw new Error('Выйдите из примера, чтобы добавить настоящий талон');
    const result = await metadata(qr);
    await locked(async () => {
      const data = latest();
      if (!data.tracked.some(t => t.qr === qr)) commit({ ...data, tracked: [...data.tracked, result] });
    });
    void poll(true); return result.id;
  },
  async settings(patch: Partial<AppState['settings']>) {
    if (view.demo) { commit({ ...view.data, settings: { ...view.data.settings, ...patch } }); return; }
    await locked(async () => { const data = latest(); commit({ ...data, settings: { ...data.settings, ...patch } }); });
  },
  async remove(id: string) {
    if (view.demo) { commit({ ...view.data, tracked: view.data.tracked.filter(t => t.id !== id) }); return; }
    await locked(async () => { const data = latest(); commit({ ...data, tracked: data.tracked.filter(t => t.id !== id) }); });
  },
  async clear() {
    await locked(async () => {
      protectedStorage = false; unavailable.clear();
      localStorage.removeItem(NEXT_POLL); localStorage.removeItem(FAILURES); localStorage.removeItem(LAST_REQUEST);
      localStorage.removeItem(REQUEST_SCOPE);
      const result = saveState(emptyState());
      emit({ data: result.state, storageError: result.error, error: '', demo: false });
    });
  },
  async demo() { await locked(async () => { clearTimeout(timer); emit({ data: demoState(), demo: true, error: '', storageError: '', loading: false }); }); },
  exitDemo() { const state = loadState(); emit({ data: state.state, demo: false, error: '', storageError: state.error }); void poll(true); },
};
