import { describe,it,expect,vi,afterEach } from 'vitest';
import { parseQr } from '../src/api';
import { normalizeTickets,normalizeDesks } from '../src/normalize';
import { dayKey,parseTime } from '../src/time';
import { makeForecast } from '../src/forecast';
import { updateAlerts } from '../src/alerts';
import { observeDesks,ticketIntervals } from '../src/history';
import { emptyState,rollDay,validateState,saveState,loadState,compactState } from '../src/storage';
import type { QueueTicket,TrackedTicket,QueueSnapshot,Desk } from '../src/types';
const now=Date.parse('2026-10-14T08:00:00Z');
const qt=(id:string,patch:Partial<QueueTicket>={}):QueueTicket=>({id,number:`C${id}`,service:'service',status:0,statusText:'Чака',desks:[10],desk:null,priority:'Нормален',taken:now-3600000+Number(id)*1000,called:null,arrived:null,finished:null,forecastSeconds:60,waitMinutes:60,calls:1,...patch});
const tracked=(id='3'):TrackedTicket=>({qr:'TESTCODE01',id,number:`C${id}`,service:'service',serviceId:'62',desks:[10],day:'2026-10-14',addedAt:now,metadataAt:now,last:qt(id),forecast:null,alerts:{thresholds:[],called:false},predictions:[]});
const desk=(number=10,patch:Partial<Desk>={}):Desk=>({number,status:4,statusText:'',ticketId:null,ticketNumber:'',service:'service',called:null,dailyPeople:5,...patch});
const snap=(tickets:QueueTicket[],desks=[desk()]):QueueSnapshot=>({at:now,tickets,desks});
const sample=(id:string,seconds=60):QueueTicket=>qt(id,{status:9,desk:10,called:now-600000-Number(id)*1000,finished:now-600000-Number(id)*1000+seconds*1000});
const samples=()=>Array.from({length:12},(_,i)=>sample(String(100+i)));
afterEach(()=>{vi.unstubAllGlobals();});
describe('QR and normalization',()=>{
  it('accepts only fixed-origin customer URLs or tokens',()=>{expect(parseQr('https://mvr-migracia.sky.bg/customer.html?qr=TESTCODE01')).toBe('TESTCODE01');expect(parseQr(' TESTCODE01 ')).toBe('TESTCODE01');for(const bad of ['C228','javascript:alert(1)','https://evil.test/customer.html?qr=TESTCODE01','https://mvr-migracia.sky.bg@evil.test/customer.html?qr=TESTCODE01','https://mvr-migracia.sky.bg/other?qr=TESTCODE01'])expect(()=>parseQr(bad)).toThrow();});
  it('normalizes numeric strings, empty timestamps, unknown statuses and discards foreign QR',()=>{const [t]=normalizeTickets({error:0,data:{row1:{ticket_id:'1',ticket_num:'C1',ticket_status_id:'77',service_desk:'[8],[10],[8]',qr_code:'DO_NOT_STORE',date_time_taken:'08:00:00',date_time_called:'00:00:00',forecast_time:'120',desk_number:''}}},'2026-10-14');expect(t.status).toBe(77);expect(t.desks).toEqual([8,10]);expect(t.called).toBeNull();expect(t.forecastSeconds).toBe(120);expect(t.desk).toBeNull();expect(JSON.stringify(t)).not.toContain('DO_NOT_STORE');});
  it('rejects partial and error responses',()=>{expect(()=>normalizeTickets({error:1,data:{}},'2026-10-14')).toThrow();expect(()=>normalizeTickets({data:{row1:{ticket_id:'1'}}},'2026-10-14')).toThrow();expect(()=>normalizeDesks({data:{row1:{}}},'2026-10-14')).toThrow();});
  it('parses Sofia dates across summer and winter offsets',()=>{expect(parseTime('08:00:00','2026-10-14')).toBe(Date.parse('2026-10-14T05:00:00Z'));expect(parseTime('14.12.2026 г. 08:00:00','2026-10-14')).toBe(Date.parse('2026-12-14T06:00:00Z'));expect(parseTime('25:00:00','2026-10-14')).toBeNull();expect(dayKey(Date.parse('2026-10-14T22:30:00Z'))).toBe('2026-10-15');});
});
describe('forecast',()=>{
  it('separates unordered official API position from chronological queue',()=>{const f=makeForecast(tracked(),snap([qt('8'),qt('3'),qt('1'),qt('2')]),samples(),[],()=>.5);expect(f.officialAhead).toBe(1);expect(f.ahead).toBe(2);expect(f.officialSeconds).toBe(60);expect(f.seconds).toBe(120);});
  it('parallel windows reduce waiting and target is not included in its own wait',()=>{const one=makeForecast(tracked(),snap([qt('1'),qt('2'),qt('3')]),samples(),[],()=>.5);const two=makeForecast({...tracked(),desks:[10,11]},snap([qt('1',{desks:[10,11]}),qt('2',{desks:[10,11]}),qt('3',{desks:[10,11]})],[desk(),desk(11)]),samples(),[],()=>.5);expect(two.seconds).toBe(60);expect(two.seconds).toBeLessThan(one.seconds!);});
  it('includes competing services but uses their additional windows',()=>{const jobs=[qt('1',{service:'other',desks:[10,11]}),qt('2'),qt('3')];const f=makeForecast(tracked(),snap(jobs,[desk(),desk(11)]),[...samples(),...samples().map(t=>({...t,id:t.id+'x',service:'other'}))],[],()=>.5);expect(f.ahead).toBe(2);expect(f.seconds).toBe(60);});
  it('never assumes an offline window will reopen',()=>{const f=makeForecast(tracked(),snap([qt('3')],[desk(10,{status:3})]),samples(),[]);expect(f.seconds).toBeNull();expect(f.reason).toContain('не принимают');});
  it('missing target does not become zero queue',()=>{const f=makeForecast(tracked(),snap([qt('1')]),samples(),[]);expect(f.ahead).toBeNull();expect(f.seconds).toBeNull();});
  it('missing time prevents an invented queue position',()=>{const f=makeForecast(tracked(),snap([qt('1',{taken:null}),qt('3')]),samples(),[]);expect(f.ahead).toBeNull();});
  it('long-running service has positive uncertain remaining time',()=>{const current=qt('1',{status:2,desk:10,called:now-3600000});const f=makeForecast(tracked(),snap([current,qt('3')],[desk(10,{status:5,ticketId:'1',called:current.called})]),samples(),[],()=>.5);expect(f.seconds).toBeGreaterThan(0);expect(f.confidence).toBe('preliminary');expect(f.notes.some(n=>n.includes('дольше'))).toBe(true);});
  it('refuses to forecast a busy window with no current ticket',()=>{const f=makeForecast(tracked(),snap([qt('3')],[desk(10,{status:5})]),samples(),[]);expect(f.seconds).toBeNull();});
  it('uses server duration only as a labeled fallback',()=>{const f=makeForecast(tracked(),snap([qt('1'),qt('3')]),[],[],()=>.5);expect(f.seconds).toBe(60);expect(f.confidence).toBe('preliminary');});
  it('does not use future completions in replay',()=>{const history=samples().map(t=>({...t,finished:now+1000}));const f=makeForecast(tracked(),snap([qt('1'),qt('3')]),history,[],()=>.5);expect(f.samples).toBe(0);expect(f.seconds).toBe(60);});
  it('excludes last-call-only durations for repeated calls',()=>{const f=makeForecast(tracked(),snap([qt('1'),qt('3')]),samples().map(t=>({...t,calls:3})),[],()=>.5);expect(f.samples).toBe(0);});
  it('includes no-shows without treating them as full long services',()=>{const f=makeForecast(tracked(),snap([qt('1'),qt('3')]),samples().map(t=>({...t,status:8,finished:t.called!+10000})),[],()=>.5);expect(f.seconds).toBe(10);});
  it('labels unknown priorities and parked tickets',()=>{const f=makeForecast(tracked(),snap([qt('1',{priority:'VIP'}),qt('2',{status:3}),qt('3')]),samples(),[]);expect(f.notes.some(n=>n.includes('Приоритеты'))).toBe(true);});
});
describe('alerts',()=>{
  function at(ahead:number,t=tracked()){return {...t,forecast:{...makeForecast(t,snap([qt('3')]),[],[]),ahead}};}
  it('first low count triggers only the most relevant event and records crossed thresholds',()=>{const r=updateAlerts(at(4),now);expect(r.message?.text).toContain('4 талонов');expect(r.ticket.alerts.thresholds).toEqual([20,10,5]);});
  it('skipped and fluctuating thresholds never duplicate',()=>{const first=updateAlerts(at(19),now);const next=updateAlerts(at(2,first.ticket),now+10000);expect(next.ticket.alerts.thresholds).toEqual([20,10,5,3]);expect(updateAlerts(at(25,next.ticket),now+20000).message).toBeNull();expect(updateAlerts(at(2,next.ticket),now+30000).message).toBeNull();});
  it('actual call overrides count and is delivered once even after reload',()=>{const t={...tracked(),last:qt('3',{status:1,desk:10})};const first=updateAlerts(t,now);expect(first.message?.text).toContain('окну № 10');expect(updateAlerts(JSON.parse(JSON.stringify(first.ticket)),now).message).toBeNull();});
});
describe('history and persistence',()=>{
  it('represents a long observation gap as unknown',()=>{const prev=snap([], [desk()]),next={...prev,at:now+90000};const initial=observeDesks([],null,prev);const rows=observeDesks(initial,prev,next);expect(rows.some(r=>r.state==='unknown'&&r.start===now&&r.end===now+90000)).toBe(true);});
  it('does not turn an inconsistent arrival into exact service time',()=>{const t=qt('1',{desk:10,status:9,called:now-60000,arrived:now-70000,finished:now});const intervals=ticketIntervals([t],now);expect(intervals[0].uncertain).toBe(true);expect(intervals[0].start).toBe(t.called);});
  it('clears day statistics but keeps own ticket and last status',()=>{const s=emptyState(now);s.tracked=[tracked()];s.records=[qt('1')];s.lastSuccess=now;s.snapshot=snap(s.records);const r=rollDay(s,now+86400000);expect(r.records).toEqual([]);expect(r.snapshot).toBeNull();expect(r.tracked[0].last?.number).toBe('C3');expect(r.tracked[0].day).toBe('2026-10-14');});
  it('validates imports and strips unknown personal fields',()=>{const s=emptyState(now);s.tracked=[tracked()];s.records=[{...qt('1'),qr_code:'FOREIGN'} as QueueTicket];expect(JSON.stringify(validateState(s))).not.toContain('FOREIGN');expect(()=>validateState({...s,version:9})).toThrow();expect(()=>validateState({...s,intervals:[{}]})).toThrow();expect(()=>validateState({...s,tracked:[{...tracked(),last:{}}]})).toThrow();});
  it('retains in-memory data and reports quota failures',()=>{vi.stubGlobal('localStorage',{setItem:()=>{throw new Error('quota');},getItem:()=>null});const s=emptyState(now);s.tracked=[tracked()];const r=saveState(s);expect(r.error).toContain('заполнено');expect(r.state.tracked).toHaveLength(1);});
  it('does not overwrite corrupt stored data on reading',()=>{const set=vi.fn();vi.stubGlobal('localStorage',{getItem:()=>'{bad',setItem:set});expect(loadState().error).not.toBe('');expect(set).not.toHaveBeenCalled();});
  it('compacts prediction times but retains queue transitions',()=>{const s=emptyState(now),t=tracked();t.predictions=[0,10,20,30,40].map((n,i)=>({at:now+n*1000,seconds:100,officialSeconds:90,ahead:i<3?10:9}));s.tracked=[t];const c=compactState(s).tracked[0].predictions;expect(c.some(p=>p.at===now+30000)).toBe(true);expect(c.length).toBeLessThan(5);});
});
