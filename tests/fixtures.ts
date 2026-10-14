import type { Desk, QueueTicket, TrackedTicket, QueueSnapshot } from '../src/types';
import { emptyState } from '../src/storage';
export const NOW = Date.parse('2026-10-14T10:00:00Z');
export function ticket(id='1', patch: Partial<QueueTicket> = {}): QueueTicket {
  return { id, number:`P${id}`, service:'test', status:0, statusText:'', desks:[21], desk:null, priority:'Нормален', taken:NOW-3600000,
    called:null, arrived:null, finished:null, forecastSeconds:120, waitMinutes:60, calls:1, ...patch };
}
export function tracked(patch: Partial<TrackedTicket> = {}): TrackedTicket {
  return { qr:'TESTCODE01', id:'1', number:'P870', service:'test', serviceId:'74', desks:[21], day:'2026-10-14',
    addedAt:NOW-10000, metadataAt:NOW, last:ticket(), forecast:null, alerts:{thresholds:[],called:false}, predictions:[], ...patch };
}
export function desk(patch: Partial<Desk> = {}): Desk {
  return { number:21, status:4, statusText:'', ticketId:null, ticketNumber:'', service:'test', called:null, dailyPeople:1, ...patch };
}
export function snapshot(tickets=[ticket()], desks=[desk()], at=NOW): QueueSnapshot { return { at, tickets, desks }; }
export function state() { return {...emptyState(NOW), tracked:[tracked()]}; }
export function serving(id:string, number:string, window=21, status=2) {
  return { ticket:ticket(id,{number,desk:window,status,called:NOW-60000}), desk:desk({number:window,status:status===2?5:7,ticketId:id,ticketNumber:number,called:NOW-60000}) };
}
