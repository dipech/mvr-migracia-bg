import type { Desk, DeskInterval, QueueSnapshot, QueueTicket } from './types';
export function mergeRecords(old: QueueTicket[], fresh: QueueTicket[]): QueueTicket[] {
  const records = new Map(old.map(t => [t.id, t]));
  for (const ticket of fresh) records.set(ticket.id, ticket);
  return [...records.values()];
}
function state(d: Desk): DeskInterval['state'] {
  if (d.status === 7 && d.ticketId) return 'called';
  if (d.status === 5 && d.ticketId) return 'serving';
  if (d.status === 4 && !d.ticketId) return 'idle';
  if (d.status !== null && [1, 2, 3].includes(d.status)) return 'closed';
  return 'unknown';
}
export function observeDesks(history: DeskInterval[], previous: QueueSnapshot | null, next: QueueSnapshot): DeskInterval[] {
  const result = history.map(i => ({ ...i }));
  const gap = previous !== null && next.at - previous.at > 30000;
  for (const d of next.desks) {
    const last = result.findLast(i => i.desk === d.number && i.source === 'observed');
    if (gap && last) result.push({ desk: d.number, ticketId: null, ticketNumber: '', service: '', start: previous!.at, end: next.at, state: 'unknown', source: 'observed', uncertain: true });
    if (!gap && last && last.state === state(d) && last.ticketId === d.ticketId && last.end === previous?.at) last.end = next.at;
    else result.push({ desk: d.number, ticketId: d.ticketId, ticketNumber: d.ticketNumber, service: d.service, start: next.at, end: next.at, state: state(d), source: 'observed', uncertain: true });
  }
  return result;
}
export function ticketIntervals(records: QueueTicket[], now: number): DeskInterval[] {
  return records.flatMap(t => {
    if (t.desk === null || t.called === null || t.called > now) return [];
    const end = t.finished ?? now;
    if (end < t.called || end > now) return [];
    const base = { desk: t.desk, ticketId: t.id, ticketNumber: t.number, service: t.service, source: 'api' as const };
    if (t.status === 8) return [{ ...base, start: t.called, end, state: 'no-show' as const, uncertain: !t.finished || t.calls > 1 }];
    const arrived = t.arrived !== null && t.arrived >= t.called && t.arrived <= end ? t.arrived : null;
    const intervals: DeskInterval[] = [];
    if (arrived !== null) intervals.push({ ...base, start: t.called, end: arrived, state: 'called', uncertain: t.calls > 1 });
    intervals.push({ ...base, start: arrived ?? t.called, end, state: arrived === null && t.status === 1 ? 'called' : 'serving', uncertain: arrived === null || t.calls > 1 });
    return intervals;
  });
}
