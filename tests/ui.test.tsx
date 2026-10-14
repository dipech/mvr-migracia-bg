import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppState } from '../src/types';
import { NOW, state, serving, snapshot } from './fixtures';

const stored = vi.hoisted(() => ({ data: null as AppState | null }));
vi.mock('../src/engine', () => ({
  engine: { subscribe: () => () => {}, getSnapshot: () => ({ data: stored.data!, error: '', storageError: '', loading: false, demo: false }) },
  errorText: (e: Error) => e.message,
}));
import App from '../src/App';

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  stored.data = state();
  const live = serving('current', 'P809');
  stored.data.snapshot = snapshot([stored.data.tracked[0].last!, live.ticket], [live.desk]);
  stored.data.lastSuccess = NOW;
  stored.data.tracked[0].forecast = { at: NOW, ahead: 12, officialAhead: 10, officialSeconds: 100, seconds: 200, low: 100, high: 300, samples: 123, confidence: 'preliminary', reason: '', notes: [] };
  vi.stubGlobal('location', { hash: '#/ticket/1' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('puts the current number next to the ticket and moves windows and reminders to their specified positions', () => {
  const html = renderToStaticMarkup(<App/>);
  expect(html).toContain('Сейчас: P809');
  const labels = ['Ваши окна', 'Информация о талоне', 'Открыть сайт Миграции', 'Напомним, когда приблизится очередь', 'Сервис не несёт ответственности'];
  for (let i = 1; i < labels.length; i++) expect(html.indexOf(labels[i])).toBeGreaterThan(html.indexOf(labels[i - 1]));
  for (const removed of ['Предварительная оценка', '123 наблюдений', 'Как менялся прогноз', 'Личный помощник', 'Не официальный сайт МВД', 'Только на вашем устройстве']) expect(html).not.toContain(removed);
  expect(html.match(/>Настройки</g)).toHaveLength(1);
  expect(html).not.toContain('aria-label="Настройки"');
});
it('removes the live maximum after 15 seconds but labels the last known window values', () => {
  vi.setSystemTime(NOW + 15000);
  const html = renderToStaticMarkup(<App/>);
  expect(html).toContain('Сейчас: —');
  expect(html).toContain('Данные устарели');
  expect(html).toContain('Последние известные значения');
});
it('removes import/export and local-history UI while retaining settings and reset', () => {
  vi.stubGlobal('location', { hash: '#/settings' });
  const html = renderToStaticMarkup(<App/>);
  for (const removed of ['Экспортировать', 'Импортировать', 'Локальная история', 'Без аккаунта', 'Удобное ожидание без лишнего']) expect(html).not.toContain(removed);
  for (const retained of ['Сбросить приложение', 'Звук уведомлений', 'Не выключать экран', 'Системные уведомления']) expect(html).toContain(retained);
});
it('uses a neutral home screen without promotional claims or address', () => {
  vi.stubGlobal('location', { hash: '#/' }); stored.data!.tracked = [];
  const html = renderToStaticMarkup(<App/>);
  expect(html).toContain('Отсканируйте QR на талоне или вставьте ссылку');
  for (const removed of ['Меньше неизвестности', 'Следите за очередью', 'МАРИЯ ЛУИЗА', 'под контролем', 'Живой прогноз', 'Не пропустите']) expect(html).not.toContain(removed);
});
