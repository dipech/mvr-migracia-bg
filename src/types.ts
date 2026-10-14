export interface QueueTicket {
  id: string; number: string; service: string; status: number; statusText: string;
  desks: number[]; desk: number | null; priority: string;
  taken: number | null; called: number | null; arrived: number | null; finished: number | null;
  forecastSeconds: number | null; waitMinutes: number | null; calls: number;
}
export interface Desk {
  number: number; status: number | null; statusText: string; ticketId: string | null;
  ticketNumber: string; service: string; called: number | null; dailyPeople: number;
}
export interface QueueSnapshot { at: number; tickets: QueueTicket[]; desks: Desk[] }
export interface Forecast {
  at: number; ahead: number | null; officialAhead: number | null;
  officialSeconds: number | null; seconds: number | null; low: number | null; high: number | null;
  samples: number; confidence: 'preliminary' | 'observed'; reason: string; notes: string[];
}
export interface AlertState { thresholds: number[]; called: boolean }
export interface PredictionPoint { at: number; seconds: number; officialSeconds: number | null; ahead: number }
export interface TrackedTicket {
  qr: string; id: string; number: string; service: string; serviceId: string; desks: number[];
  day: string; addedAt: number; metadataAt: number; last: QueueTicket | null;
  forecast: Forecast | null; alerts: AlertState; predictions: PredictionPoint[]; error?: string;
}
export type IntervalState = 'serving' | 'called' | 'no-show' | 'idle' | 'closed' | 'unknown';
export interface DeskInterval {
  desk: number; ticketId: string | null; ticketNumber: string; service: string;
  start: number; end: number; state: IntervalState; source: 'observed' | 'api'; uncertain: boolean;
}
export interface AlertMessage { id: string; ticketId: string; text: string; at: number }
export interface AppState {
  version: 1; day: string; tracked: TrackedTicket[]; snapshot: QueueSnapshot | null;
  records: QueueTicket[]; intervals: DeskInterval[]; messages: AlertMessage[];
  settings: { sound: boolean; wakeLock: boolean; notifications: boolean };
  lastSuccess: number | null;
}
