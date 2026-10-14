import type { Desk, QueueSnapshot, QueueTicket, TrackedTicket } from './types';
import { dayKey } from './time';

export const POLL_INTERVAL = 5_000;
export const STALE_AFTER = 15_000;
export const RETRY_INTERVALS = [5_000, 10_000, 20_000, 40_000, 60_000];

export function isSnapshotFresh(snapshot: QueueSnapshot | null, now: number): boolean {
  return snapshot !== null && dayKey(snapshot.at) === dayKey(now)
    && now >= snapshot.at && now - snapshot.at < STALE_AFTER;
}

export interface CurrentDesk {
  ticket: QueueTicket | null;
  inconsistent: boolean;
  label: string;
}

/** A printed number is not an identity: the source reuses numbers within a day. */
export function currentDesk(desk: Desk, snapshot: QueueSnapshot): CurrentDesk {
  const claimed = desk.ticketId ? snapshot.tickets.find(t => t.id === desk.ticketId) : null;
  const active = snapshot.tickets.filter(t => t.desk === desk.number && [1, 2].includes(t.status));
  const busy = desk.status === 5 || desk.status === 7;
  if (busy) {
    if (!claimed || active.length !== 1 || active[0].id !== claimed.id
      || claimed.number !== desk.ticketNumber
      || (desk.status === 5 ? claimed.status !== 2 : claimed.status !== 1)) {
      return { ticket: null, inconsistent: true, label: 'Данные уточняются' };
    }
    return { ticket: claimed, inconsistent: false, label: desk.status === 5 ? 'Обслуживает' : 'Вызывает' };
  }
  if (desk.ticketId || active.length) return { ticket: null, inconsistent: true, label: 'Данные уточняются' };
  return {
    ticket: null, inconsistent: false,
    label: desk.status === 4 ? 'Готов к приёму' : [1, 2, 3].includes(desk.status ?? -1) ? 'Не принимает' : 'Нет данных',
  };
}

export function maxCurrentNumber(ticket: TrackedTicket, snapshot: QueueSnapshot | null, now: number): string | null {
  if (ticket.day !== dayKey(now) || !snapshot || dayKey(snapshot.at) !== dayKey(now)) return null;
  const own = ticket.number.match(/^(\D+)(\d+)$/u);
  if (!own) return null;
  let best: { number: string; numeric: number } | null = null;
  for (const desk of snapshot!.desks) {
    if (!ticket.desks.includes(desk.number)) continue;
    const current = currentDesk(desk, snapshot!).ticket;
    const parsed = current?.number.match(/^(\D+)(\d+)$/u);
    if (!current || !parsed || parsed[1] !== own[1]) continue;
    const numeric = Number(parsed[2]);
    if (Number.isSafeInteger(numeric) && (!best || numeric > best.numeric)) best = { number: current.number, numeric };
  }
  return best?.number ?? null;
}
