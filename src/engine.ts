import { metadata, parseQr, snapshot } from './api';
import { updateAlerts, playSound, systemNotification } from './alerts';
import { makeForecast } from './forecast';
import { mergeRecords, observeDesks } from './history';
import { emptyState, loadState, rollDay, saveState, STORAGE_KEY, validateState } from './storage';
import type { AlertMessage, AppState, QueueSnapshot, TrackedTicket } from './types';
import { dayKey } from './time';
import { demoState } from './demo';
interface View { data: AppState; error: string; storageError: string; loading: boolean; demo: boolean; lastAttempt: number | null }
const initial = loadState();
let view: View = { data: initial.state, error: '', storageError: initial.error, loading:false, demo:false, lastAttempt:null };
let protectedStorage = !!initial.error;
const listeners = new Set<() => void>();
const emit = (patch: Partial<View>) => { view = { ...view, ...patch }; listeners.forEach(f => f()); };
const NEXT_POLL = 'migration-queue:next-poll';
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false, failures = 0, running = false;
const active = (t: TrackedTicket, day: string) => t.day === day && ![8,9].includes(t.last?.status ?? 0);
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request('migration-queue:writer', fn);
  throw new Error('Этот браузер не поддерживает безопасную синхронизацию вкладок. Откройте приложение в актуальном Safari или Chrome.');
}
function latest(): AppState {
  if (view.demo) return view.data;
  const stored = loadState();
  if (stored.error) { protectedStorage = true; throw new Error(stored.error); }
  // Preserve unsaved observations if storage quota was exceeded.
  if (view.storageError && !protectedStorage) return rollDay(view.data);
  return stored.state;
}
function commit(data: AppState) {
  if (view.demo) { emit({data}); return; }
  if (protectedStorage) throw new Error('Сохранение защищено от перезаписи. Сначала экспортируйте или очистите повреждённые данные.');
  const result = saveState(data); emit({data:result.state, storageError:result.error});
}
function schedule() { clearTimeout(timer); if (running) timer = setTimeout(() => void poll(), 1000); }
function mergeSnapshots(base: QueueSnapshot, next: QueueSnapshot): QueueSnapshot {
  return { at: Math.max(base.at, next.at), tickets: mergeRecords(base.tickets, next.tickets), desks:[...new Map([...base.desks,...next.desks].map(d=>[d.number,d])).values()] };
}
async function poll(force = false) {
  if (busy || view.demo || protectedStorage) { schedule(); return; }
  busy = true;
  try {
    await locked(async () => {
      if (view.demo) return;
      let data = latest();
      if (data.day !== view.data.day) commit(data);
      const tracked = data.tracked.filter(t=>active(t,data.day));
      if (!tracked.length) { emit({data, loading:false}); return; }
      const nextAt = Number(localStorage.getItem(NEXT_POLL) || 0);
      if (!force && Date.now() < nextAt) { emit({data}); return; }
      emit({loading:true,lastAttempt:Date.now()});
      // A shared durable schedule keeps both successful and failed requests single across tabs.
      localStorage.setItem(NEXT_POLL, String(Date.now() + 60000));
      try {
        const refreshed = await Promise.all(tracked.map(async t => {
          if (Date.now() - t.metadataAt < 60000) return t;
          try { return await metadata(t.qr,t); } catch (e) { return {...t,error:errorText(e)}; }
        }));
        const metadataById = new Map(refreshed.map(t=>[t.id,t]));
        data = {...data,tracked:data.tracked.map(t=>metadataById.get(t.id) ?? t)};
        let fresh: QueueSnapshot | null = null;
        const perTicket = new Map<string,QueueSnapshot>();
        for (const t of refreshed) {
          if (fresh?.tickets.some(r=>r.id===t.id)) { perTicket.set(t.id,fresh); continue; }
          try {
            const response = await snapshot(t.qr);
            // Reject omission of an active window: it must not look like a real closure.
            if (t.desks.some(n => !response.desks.some(d => d.number === n))) throw new Error('В ответе отсутствуют окна услуги');
            perTicket.set(t.id,response); fresh = fresh ? mergeSnapshots(fresh,response) : response;
          } catch (e) { t.error=errorText(e); }
        }
        if (!fresh) throw new Error(refreshed[0]?.error || 'Не удалось обновить очередь');
        if (dayKey(fresh.at) !== data.day) { commit(rollDay(data, fresh.at)); return; }
        const records = mergeRecords(data.records,fresh.tickets);
        const intervals = observeDesks(data.intervals,data.snapshot,fresh);
        const messages: AlertMessage[] = [];
        const updated = data.tracked.map(t => {
          if (!active(t,data.day)) return t;
          // Shared feed is used only if it actually contains this ticket; retain its original API order.
          const source = perTicket.get(t.id) ?? (fresh!.tickets.some(r=>r.id===t.id) ? fresh! : null);
          const found = source?.tickets.find(r=>r.id===t.id);
          if (!source || !found) return {...t,error:'Талон отсутствует в ответе. Последний статус сохранён.',forecast:null};
          if (t.desks.some(n=>!source.desks.some(d=>d.number===n))) return {...t,error:'Неполный список окон. Последние данные сохранены.'};
          const forecast = makeForecast(t,source,records,intervals);
          const predictions = [...t.predictions];
          if (forecast.seconds !== null && forecast.ahead !== null) predictions.push({at:source.at,seconds:forecast.seconds,officialSeconds:forecast.officialSeconds,ahead:forecast.ahead});
          const result = updateAlerts({...t,last:found,forecast,predictions,error:undefined},fresh!.at);
          if (result.message) messages.push(result.message);
          return result.ticket;
        });
        data = {...data,tracked:updated,snapshot:fresh,records,intervals,messages:[...data.messages,...messages].slice(-100),lastSuccess:fresh.at};
        commit(data);
        // A failed persistence must not cause cross-tab/reload notification duplication.
        if (!view.storageError) for (const message of messages) {
          if (data.settings.sound) playSound();
          if (data.settings.notifications) void systemNotification(message.text);
        }
        failures = 0; emit({error:''});
        localStorage.setItem(NEXT_POLL,String(Date.now()+10000));
      } catch (e) {
        failures++; localStorage.setItem(NEXT_POLL,String(Date.now()+Math.min(60000,10000*2**(failures-1))));
        emit({error:errorText(e)});
      } finally { emit({loading:false}); }
    });
  } catch(e) { emit({error:errorText(e),loading:false}); }
  finally { busy=false; schedule(); }
}
export function errorText(error: unknown): string { return error instanceof Error ? (error.name === 'TypeError' ? 'Нет связи с Миграцией. Проверьте интернет; повторим запрос автоматически.' : error.message) : 'Не удалось выполнить действие'; }
export const engine = {
  subscribe(fn:()=>void) { listeners.add(fn); return ()=>{listeners.delete(fn);}; },
  getSnapshot:()=>view,
  start() {
    if (running) return; running=true;
    window.addEventListener('storage',e=>{if (e.key===STORAGE_KEY && !view.demo && !busy) {const s=loadState(); emit({data:s.state,storageError:s.error});}});
    window.addEventListener('online',()=>void poll(true));
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') void poll(true);});
    void poll();
  },
  refresh:()=>poll(true),
  async add(input:string) {
    const qr=parseQr(input);
    const duplicate=view.data.tracked.find(t=>t.qr===qr);
    if(duplicate) return duplicate.id;
    if(view.demo) throw new Error('Выйдите из примера, чтобы добавить настоящий талон');
    const result=await metadata(qr);
    await locked(async()=>{const data=latest(); if(!data.tracked.some(t=>t.qr===qr)) commit({...data,tracked:[...data.tracked,result]});});
    void poll(true); return result.id;
  },
  async settings(patch:Partial<AppState['settings']>) {
    if(view.demo) {commit({...view.data,settings:{...view.data.settings,...patch}});return;}
    await locked(async()=>{const data=latest();commit({...data,settings:{...data.settings,...patch}});});
  },
  async remove(id:string) {
    if(view.demo) {commit({...view.data,tracked:view.data.tracked.filter(t=>t.id!==id)});return;}
    await locked(async()=>{const data=latest();commit({...data,tracked:data.tracked.filter(t=>t.id!==id)});});
  },
  async clear() {await locked(async()=>{protectedStorage=false; localStorage.removeItem(NEXT_POLL);const result=saveState(emptyState());emit({data:result.state,storageError:result.error,error:'',demo:false});});},
  async import(text:string) {
    if(text.length>5_000_000) throw new Error('Файл слишком большой (максимум 5 МБ)');
    const data=rollDay(validateState(JSON.parse(text)));
    await locked(async()=>{protectedStorage=false;emit({demo:false});commit(data);localStorage.removeItem(NEXT_POLL);});
    void poll(true);
  },
  exportRaw() { return view.demo ? JSON.stringify(view.data,null,2) : protectedStorage ? localStorage.getItem(STORAGE_KEY) ?? '{}' : JSON.stringify(view.data,null,2); },
  async demo() {await locked(async()=>{clearTimeout(timer);emit({data:demoState(),demo:true,error:'',storageError:'',loading:false});});},
  exitDemo() {const data=loadState();emit({data:data.state,demo:false,error:'',storageError:data.error});void poll(true);},
};
