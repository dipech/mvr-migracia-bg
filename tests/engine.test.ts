import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NOW, state, snapshot, ticket, desk, tracked, serving } from './fixtures';
import { STORAGE_KEY } from '../src/storage';
import type { QueueSnapshot } from '../src/types';
const mocked=vi.hoisted(()=>({snapshot:vi.fn(), metadata:vi.fn()}));
vi.mock('../src/api',async importOriginal=>({...await importOriginal<typeof import('../src/api')>(),snapshot:mocked.snapshot,metadata:mocked.metadata}));
vi.mock('../src/alerts',async importOriginal=>({...await importOriginal<typeof import('../src/alerts')>(),playSound:vi.fn(),systemNotification:vi.fn()}));
let engines:typeof import('../src/engine')['engine'][]=[];
let store:Map<string,string>, doc:EventTarget & {visibilityState:string};
async function loadEngine(){vi.resetModules();const e=(await import('../src/engine')).engine;engines.push(e);return e;}
async function flush(){await vi.advanceTimersByTimeAsync(0);}
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);engines=[];store=new Map();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value),removeItem:(key:string)=>store.delete(key)});
  vi.stubGlobal('window',new EventTarget());doc=Object.assign(new EventTarget(),{visibilityState:'visible'});vi.stubGlobal('document',doc);
  let tail=Promise.resolve();
  vi.stubGlobal('navigator',{locks:{request:(_name:string,fn:()=>Promise<unknown>)=>{const next=tail.then(fn);tail=next.then(()=>{},()=>{});return next;}}});
  mocked.snapshot.mockReset().mockImplementation(async()=>snapshot([ticket()],[desk()],Date.now()));
  mocked.metadata.mockReset().mockImplementation(async(_qr:string,t:ReturnType<typeof tracked>)=>({...t,metadataAt:Date.now()}));
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state()));
});
afterEach(()=>{engines.forEach(e=>e.stop());vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
describe('live board polling',()=>{
  it('continues every five seconds after all tracked tickets have completed',async()=>{
    const s=state();s.tracked[0].last=ticket('1',{status:9});store.set(STORAGE_KEY,JSON.stringify(s));
    mocked.snapshot.mockImplementation(async()=>snapshot([ticket('1',{status:9})],[desk()],Date.now()));
    const e=await loadEngine();e.start();await flush();expect(mocked.snapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);expect(mocked.snapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(mocked.snapshot).toHaveBeenCalledTimes(2);
    expect(e.getSnapshot().data.tracked[0].forecast).toBeNull();expect(e.getSnapshot().data.snapshot?.at).toBe(NOW+5000);
  });
  it('does not overlap a slow request or duplicate manual refreshes',async()=>{
    let resolve!:(s:QueueSnapshot)=>void;
    mocked.snapshot.mockImplementationOnce(()=>new Promise<QueueSnapshot>(r=>{resolve=r;}));
    const e=await loadEngine();e.start();await flush();await vi.advanceTimersByTimeAsync(10000);await e.refresh();
    expect(mocked.snapshot).toHaveBeenCalledTimes(1);resolve(snapshot());await flush();
  });
  it('replaces live windows, while retaining past observations only in history',async()=>{
    const a=serving('a','P809');const s=state();s.snapshot=snapshot([ticket(),a.ticket],[a.desk,desk({number:22})],NOW-20000);s.records=s.snapshot.tickets;store.set(STORAGE_KEY,JSON.stringify(s));
    const e=await loadEngine();await e.refresh();
    expect(e.getSnapshot().data.snapshot?.desks).toHaveLength(1);
    expect(e.getSnapshot().data.snapshot?.desks[0].ticketId).toBeNull();
    expect(e.getSnapshot().data.records.some(t=>t.id==='a')).toBe(true);
  });
  it('refreshes immediately on returning to a visible page',async()=>{
    const e=await loadEngine();e.start();await flush();doc.visibilityState='hidden';await vi.advanceTimersByTimeAsync(2000);
    doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));await flush();
    expect(mocked.snapshot).toHaveBeenCalledTimes(2);
  });
  it('keeps the previous snapshot on failure and retries at 5,10,20,40,60 seconds',async()=>{
    const s=state();s.snapshot=snapshot();s.lastSuccess=NOW;store.set(STORAGE_KEY,JSON.stringify(s));
    mocked.snapshot.mockRejectedValue(new Error('offline'));
    const e=await loadEngine();e.start();await flush();
    for(const [index,wait] of [5000,10000,20000,40000,60000].entries()) {
      expect(Number(store.get('migration-queue:next-poll'))-Date.now()).toBe(wait);
      await vi.advanceTimersByTimeAsync(wait);expect(mocked.snapshot).toHaveBeenCalledTimes(index+2);
    }
    expect(e.getSnapshot().data.snapshot?.at).toBe(NOW);
  });
  it('shares requests and notifications between two tabs',async()=>{
    const a=await loadEngine(),b=await loadEngine();
    a.start();b.start();await flush();expect(mocked.snapshot).toHaveBeenCalledTimes(1);
    expect(a.getSnapshot().data.messages).toHaveLength(1);expect(b.getSnapshot().data.messages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);expect(mocked.snapshot).toHaveBeenCalledTimes(2);
    expect(b.getSnapshot().data.messages).toHaveLength(1);
  });
  it('coalesces simultaneous forced refreshes across tabs, including failures',async()=>{
    const a=await loadEngine(),b=await loadEngine();a.start();b.start();await flush();
    mocked.snapshot.mockRejectedValue(new Error('offline'));await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([a.refresh(),b.refresh()]);expect(mocked.snapshot).toHaveBeenCalledTimes(2);
  });
  it('stops using expired QR codes and offers a new ticket',async()=>{
    const s=state();s.tracked[0].metadataAt=NOW-60001;store.set(STORAGE_KEY,JSON.stringify(s));
    const e=await loadEngine();const {TicketAccessError}=await import('../src/api');
    mocked.metadata.mockRejectedValue(new TicketAccessError('Срок доступа к талону истёк. Добавьте новый талон.'));
    await e.refresh();expect(mocked.snapshot).not.toHaveBeenCalled();expect(e.getSnapshot().error).toContain('Добавьте новый талон');
  });
  it('coalesces initial forced failures even before any snapshot has been saved',async()=>{
    const a=await loadEngine(),b=await loadEngine();
    mocked.snapshot.mockRejectedValue(new Error('offline'));
    await Promise.all([a.refresh(),b.refresh()]);
    expect(mocked.snapshot).toHaveBeenCalledTimes(1);
  });
  it('does not poll old QR codes after a Sofia day change',async()=>{
    const e=await loadEngine();vi.setSystemTime(NOW+86400000);await e.refresh();
    expect(mocked.snapshot).not.toHaveBeenCalled();expect(e.getSnapshot().error).toContain('Нет QR текущего дня');
  });
  it('does not forecast or alert from contradictory desk records',async()=>{
    const a=serving('a','P809');mocked.snapshot.mockResolvedValue(snapshot([ticket(),{...a.ticket,status:9}],[a.desk]));
    const e=await loadEngine();await e.refresh();
    expect(e.getSnapshot().data.tracked[0].forecast).toBeNull();expect(e.getSnapshot().data.messages).toEqual([]);
    expect(e.getSnapshot().data.tracked[0].error).toBe('Данные окон уточняются.');
  });
});

it('retains the previous forecast on inconsistent replies without new alerts',async()=>{
  const s=state();
  s.tracked[0].forecast={at:NOW-5000,ahead:12,officialAhead:10,officialSeconds:100,seconds:200,low:100,high:300,samples:12,confidence:'preliminary',reason:'',notes:[]};
  store.set(STORAGE_KEY,JSON.stringify(s));
  const a=serving('a','P809');mocked.snapshot.mockResolvedValue(snapshot([ticket(),{...a.ticket,status:9}],[a.desk]));
  const e=await loadEngine();await e.refresh();
  expect(e.getSnapshot().data.tracked[0].forecast).toEqual(s.tracked[0].forecast);
  expect(e.getSnapshot().data.messages).toEqual([]);
});
