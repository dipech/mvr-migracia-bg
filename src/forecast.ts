import type { DeskInterval, Forecast, QueueSnapshot, QueueTicket, TrackedTicket } from './types';
const intersects = (a: number[], b: number[]) => a.some(n => b.includes(n));
export function queueOrder(a: QueueTicket, b: QueueTicket): number {
  return (a.taken ?? Infinity) - (b.taken ?? Infinity) || a.id.localeCompare(b.id, undefined, { numeric: true });
}
interface Sample { seconds: number; desk: number; service: string; at: number }
function samplesFrom(records: QueueTicket[], now: number): Sample[] {
  return records.flatMap(t => {
    if (![8, 9].includes(t.status) || t.called === null || t.finished === null || t.desk === null || t.finished > now || t.called > t.finished) return [];
    const seconds = (t.finished - t.called) / 1000;
    // Repeated calls only expose their last timestamp, not full occupancy.
    if (t.calls > 1 || seconds < 1 || seconds > 4 * 3600) return [];
    return [{ seconds, desk: t.desk, service: t.service, at: t.finished }];
  });
}
function quantile(values: number[], q: number) { return values[Math.min(values.length - 1, Math.floor((values.length - 1) * q))]; }
export function makeForecast(tracked: TrackedTicket, snapshot: QueueSnapshot, records: QueueTicket[], intervals: DeskInterval[], random = Math.random): Forecast {
  const now = snapshot.at;
  const base: Forecast = { at: now, ahead: null, officialAhead: null, officialSeconds: null, seconds: null, low: null, high: null, samples: 0, confidence: 'preliminary', reason: '', notes: [] };
  const target = snapshot.tickets.find(t => t.id === tracked.id);
  if (!target) return { ...base, reason: 'Талон отсутствует в последнем ответе. Последний статус сохранён.' };
  if (target.status !== 0) return { ...base, reason: target.status === 1 || target.status === 2 ? 'Ваш талон уже вызван' : 'Прогноз доступен для ожидающего талона' };
  const eligible = tracked.desks.length ? tracked.desks : target.desks;
  const active = snapshot.desks.filter(d => eligible.includes(d.number) && d.status !== null && [4, 5, 7].includes(d.status));
  const beforeInApi = snapshot.tickets.slice(0, snapshot.tickets.findIndex(t => t.id === target.id)).filter(t => t.status <= 0 && intersects(t.desks, eligible));
  base.officialAhead = beforeInApi.length;
  const officialActive = snapshot.desks.filter(d => eligible.includes(d.number) && (d.status ?? 0) >= 4).length;
  base.officialSeconds = beforeInApi.every(t => t.forecastSeconds !== null) ? beforeInApi.reduce((sum, t) => sum + Math.max(0, t.forecastSeconds!), 0) / Math.max(1, officialActive) : null;
  if (target.taken === null || snapshot.tickets.some(t => t.status === 0 && intersects(t.desks, eligible) && t.taken === null)) return { ...base, reason: 'Не хватает времени выдачи для восстановления очереди' };
  base.ahead = snapshot.tickets.filter(t => t.status === 0 && t.id !== target.id && intersects(t.desks, eligible) && queueOrder(t, target) < 0).length;
  if (!active.length) return { ...base, reason: 'Подходящие окна сейчас не принимают. Время возобновления неизвестно.' };
  // Include other windows serving competing tickets, so shared work is not all assigned to the target's windows.
  let connected = new Set(eligible);
  let expanded = true;
  const waiting = snapshot.tickets.filter(t => t.status === 0 && t.taken !== null && queueOrder(t, target) <= 0).sort(queueOrder);
  while (expanded) { expanded = false; for (const t of waiting) if (t.desks.some(d => connected.has(d))) for (const d of t.desks) if (!connected.has(d)) { connected.add(d); expanded = true; } }
  const workers = snapshot.desks.filter(d => connected.has(d.number) && d.status !== null && [4, 5, 7].includes(d.status));
  const jobs = waiting.filter(t => t.desks.some(d => connected.has(d)));
  const samples = samplesFrom(records, now);
  const serviceSamples = samples.filter(s => s.service === target.service);
  base.samples = serviceSamples.length;
  if (serviceSamples.length < 10) base.notes.push('Мало завершённых наблюдений по услуге');
  if (jobs.some(t => !['Нормален', 'Normal'].includes(t.priority)) || snapshot.tickets.some(t => [3, 4].includes(t.status) && intersects(t.desks, eligible))) base.notes.push('Приоритеты или перенаправления могут изменить порядок');
  if (intervals.some(i => i.state === 'unknown' && i.end > now - 3600000 && eligible.includes(i.desk))) base.notes.push('Есть пропуски наблюдений');
  const pool = (service: string, desk: number) => {
    const all = samples.filter(s => s.service === service), local = all.filter(s => s.desk === desk);
    return (local.length >= 10 ? local : all).slice(-100);
  };
  let usedFallback = false, uncertainResidual = false;
  const draw = (service: string, desk: number, fallback: number | null, elapsed = 0): number | null => {
    const all = pool(service, desk), conditional = all.filter(s => s.seconds > elapsed);
    if (all.length >= 10 && conditional.length >= (elapsed > 0 ? 3 : 1)) {
      // Exponential recency weights, half-life one hour.
      const weights = conditional.map(s => Math.pow(0.5, (now - s.at) / 3600000));
      let r = random() * weights.reduce((a, b) => a + b, 0), index = 0;
      while (index < weights.length - 1 && (r -= weights[index]) > 0) index++;
      return Math.max(1, conditional[index].seconds - elapsed);
    }
    usedFallback = true;
    if (elapsed > 0) uncertainResidual = true;
    const mean = fallback !== null && fallback > 0 ? fallback : all.length ? all.reduce((a, s) => a + s.seconds, 0) / all.length : null;
    if (mean === null) return null;
    // Conservative positive residual when the current job has exceeded the prior.
    const residual = Math.max(30, mean - elapsed, elapsed > mean ? mean * 0.5 : 0);
    return residual * (0.5 + random());
  };
  const turnover = (desk: number): number => {
    const gaps = intervals.filter(i => i.source === 'observed' && i.desk === desk && i.state === 'idle' && i.end > i.start && i.end < now).map(i => (i.end - i.start) / 1000).filter(s => s <= 300);
    return gaps.length ? gaps[Math.floor(random() * gaps.length)] : 0;
  };
  const results: number[] = [];
  for (let run = 0; run < 300; run++) {
    const times = new Map<number, number>();
    for (const d of workers) {
      if (d.status === 4 && !d.ticketId) { times.set(d.number, 0); continue; }
      const current = snapshot.tickets.find(t => t.id === d.ticketId);
      if (!current || !d.ticketId || (current.called === null && d.called === null)) return { ...base, reason: 'Окно занято, но данных о текущем талоне недостаточно' };
      const elapsed = Math.max(0, (now - (current.called ?? d.called!)) / 1000);
      const remaining = draw(current.service, d.number, current.forecastSeconds, elapsed);
      if (remaining === null) return { ...base, reason: 'Недостаточно данных о длительности обслуживания' };
      times.set(d.number, remaining + turnover(d.number));
    }
    for (const [jobIndex, job] of jobs.entries()) {
      const possible = workers.filter(d => job.desks.includes(d.number)).sort((a, b) => times.get(a.number)! - times.get(b.number)! || jobs.slice(jobIndex + 1).filter(t => t.desks.includes(a.number)).length - jobs.slice(jobIndex + 1).filter(t => t.desks.includes(b.number)).length || a.number - b.number);
      if (!possible.length) continue;
      const desk = possible[0], start = times.get(desk.number)!;
      if (job.id === target.id) { results.push(start); break; }
      const seconds = draw(job.service, desk.number, job.forecastSeconds);
      if (seconds === null) return { ...base, reason: 'Недостаточно данных о конкурирующих услугах' };
      times.set(desk.number, start + seconds + turnover(desk.number));
    }
  }
  if (!results.length) return { ...base, reason: 'Не удалось определить доступное окно' };
  results.sort((a, b) => a - b);
  if (usedFallback) base.notes.push('Часть длительностей оценена по данным Миграции');
  if (uncertainResidual) base.notes.push('Текущее обслуживание дольше доступных наблюдений');
  return { ...base, seconds: quantile(results, 0.5), low: quantile(results, 0.1), high: quantile(results, 0.9), confidence: !usedFallback && !base.notes.length ? 'observed' : 'preliminary', reason: '' };
}
