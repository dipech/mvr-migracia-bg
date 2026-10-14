import type { AlertMessage, TrackedTicket } from './types';
export function updateAlerts(ticket: TrackedTicket, now: number): { ticket: TrackedTicket; message: AlertMessage | null } {
  const alerts = { thresholds: [...ticket.alerts.thresholds], called: ticket.alerts.called };
  let text = '';
  if (ticket.last && [1, 2].includes(ticket.last.status) && !alerts.called) {
    alerts.called = true; text = `${ticket.number}: вас вызывают${ticket.last.desk ? ` к окну № ${ticket.last.desk}` : ''}!`;
  } else if (ticket.last?.status === 0 && ticket.forecast?.ahead != null) {
    const crossed = [20, 10, 5, 3].filter(n => ticket.forecast!.ahead! <= n && !alerts.thresholds.includes(n));
    if (crossed.length) { alerts.thresholds.push(...crossed); text = `${ticket.number}: перед вами примерно ${ticket.forecast.ahead} талонов. Будьте рядом.`; }
  }
  return { ticket: { ...ticket, alerts }, message: text ? { id: `${ticket.id}-${alerts.called ? 'called' : Math.min(...alerts.thresholds)}`, ticketId: ticket.id, text, at: now } : null };
}
let context: AudioContext | null = null;
export async function enableSound() {
  context ??= new AudioContext();
  await context.resume();
  playSound();
}
export function playSound() {
  if (!context || context.state !== 'running') return;
  const oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.frequency.setValueAtTime(740, context.currentTime);
  oscillator.frequency.setValueAtTime(980, context.currentTime + 0.18);
  gain.gain.setValueAtTime(0.14, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.55);
  oscillator.start(); oscillator.stop(context.currentTime + 0.6);
}
export async function systemNotification(text: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await registration.showNotification('Очередь в миграцию', { body: text, icon: './icon-192.png', tag: 'migration-queue' });
    else new Notification('Очередь в миграцию', { body: text });
  } catch { /* In-app alerts remain available when OS notifications are unsupported. */ }
}
