import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Activity, ArrowLeft, ArrowRight, Bell, BellRing, Check, ChevronDown, ChevronRight, ExternalLink, Eye, LayoutGrid, Plus, QrCode, RefreshCw, ScanLine, Settings2, Smartphone, Trash2, Volume2, WifiOff, X } from 'lucide-react';
import { engine, errorText } from './engine';
import { enableSound } from './alerts';
import { clock, dayKey, duration, minutes } from './time';
import { statusLabel } from './normalize';
import { ticketIntervals } from './history';
import { currentDesk, isSnapshotFresh, maxCurrentNumber, STALE_AFTER } from './current';
const Scanner = lazy(() => import('./Scanner').then(m => ({default:m.Scanner})));
import type { AppState, DeskInterval, TrackedTicket } from './types';
import './style.css';
function useRoute(){const [route,setRoute]=useState(location.hash.slice(1)||'/');useEffect(()=>{const change=()=>setRoute(location.hash.slice(1)||'/');window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);return route;}
const navigate=(route:string)=>{location.hash=route;};
function useNow(){const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);return now;}
function SectionTitle({label,extra}:{label:string;extra?:React.ReactNode}){return <div className="section-title"><h2>{label}</h2>{extra}</div>;}
function Status({ticket}:{ticket:TrackedTicket}){const status=ticket.last?.status;return <span className={`status status-${status??'none'}`}><span/>{statusLabel(status)}</span>;}
function TicketCard({ticket,now}:{ticket:TrackedTicket;now:number}){const f=ticket.forecast,old=ticket.day!==dayKey(now);return <button className="ticket-card" onClick={()=>navigate(`/ticket/${ticket.id}`)}><div className="ticket-card-top"><span className="ticket-number">{ticket.number}</span><Status ticket={ticket}/></div><p className="service-text">{ticket.service}</p><div className="ticket-card-bottom"><div><span className="small-label">{old?'ПОСЛЕДНИЙ СТАТУС':'ПРИМЕРНО ПЕРЕД ВАМИ'}</span><strong>{old?ticket.day:f?.ahead==null?'—':`${f.ahead} талонов`}</strong></div><div className="card-time"><span className="small-label">{old?'АРХИВ':'НАШ ПРОГНОЗ'}</span><strong>{f?.seconds!=null?clock(f.at+f.seconds*1000):'—'}<ChevronRight size={18}/></strong></div></div>{ticket.error&&<p className="card-error">{ticket.error}</p>}</button>;}
export function Home({data,now,onAdd,demo}:{data:AppState;now:number;onAdd:()=>void;demo:boolean}) {
  const current=data.tracked.filter(t=>t.day===data.day), past=data.tracked.filter(t=>t.day!==data.day);
  return <>
    <div className="page-heading compact"><h1>Мои талоны</h1></div>
    {!data.tracked.length ? <>
      <section className="empty-card simple-empty">
        <QrCode size={44}/><h2>Добавьте талон</h2>
        <p>Отсканируйте QR на талоне или вставьте ссылку.</p>
        <button className="button primary full" onClick={onAdd}><ScanLine size={21}/> Добавить талон</button>
      </section>
      <button className="demo-link" onClick={()=>{void engine.demo();navigate('/');}}>Демонстрационный режим <ArrowRight size={16}/></button>
    </> : <>
      <button className="button primary full" onClick={onAdd}><Plus size={18}/> Добавить талон</button>
      <div className="ticket-list">{current.map(t=><TicketCard key={t.id} ticket={t} now={now}/>)}</div>
      {past.length>0&&<><SectionTitle label="Прошлые посещения"/><div className="ticket-list">{past.map(t=><TicketCard key={t.id} ticket={t} now={now}/>)}</div></>}
      <div className="info-card"><Smartphone size={22}/><div><strong>Фоновое обновление</strong><p>На iPhone сбор данных может остановиться при блокировке экрана.</p><button className="text-button" onClick={()=>navigate('/settings')}>Настроить удержание экрана <ArrowRight size={15}/></button></div></div>
      {demo&&<p className="privacy-note">Вымышленные данные для демонстрации.</p>}
    </>}
  </>;
}
function Accuracy({ticket}:{ticket:TrackedTicket}){if(!ticket.last?.called||!ticket.predictions.length)return null;const pts=ticket.predictions.filter(p=>p.at<ticket.last!.called!);if(!pts.length)return null;const error=(official:boolean)=>{const p=pts.filter(p=>!official||p.officialSeconds!==null);return p.length?p.reduce((s,x)=>s+Math.abs(x.at+(official?x.officialSeconds!:x.seconds)*1000-ticket.last!.called!),0)/p.length/1000:null;};return <section className="panel"><SectionTitle label="Проверка прогноза"/><p className="muted">Средняя абсолютная ошибка до фактического вызова. {pts.length} сохранённых оценок.</p><div className="facts"><div><span>Наш прогноз</span><strong>{minutes(error(false))} мин</strong></div><div><span>Миграция</span><strong>{minutes(error(true))} мин</strong></div></div></section>;}
export function TicketDetail({ticket,data,now,onAdd,sourceError=''}:{ticket:TrackedTicket;data:AppState;now:number;onAdd:()=>void;sourceError?:string}) {
  const f=ticket.forecast, t=ticket.last, old=ticket.day!==dayKey(now);
  const stale=!!ticket.error||!!f&&now-f.at>=STALE_AFTER;
  const current=maxCurrentNumber(ticket,data.snapshot,now);
  return <>
    <button className="back-link" onClick={()=>navigate('/')}><ArrowLeft size={16}/> Мои талоны</button>
    <div className="detail-heading">
      <div className="ticket-heading-numbers">
        <div><div className="eyebrow">ВАШ ТАЛОН</div><h1>{ticket.number}</h1></div>
        <div className="current-number" aria-label={`Сейчас: ${current??'—'}`}><span>Сейчас:</span><strong>{current??'—'}</strong></div>
      </div>
      <Status ticket={ticket}/>
    </div>
    <p className="detail-service">{ticket.service}</p>
    {t&&[1,2].includes(t.status)&&<div className="callout"><BellRing/><div><strong>{t.status===1?'Вас вызывают!':'Ваш талон обслуживается'}</strong><p>{t.desk?`Подойдите к окну № ${t.desk}`:'Проверьте табло Миграции'}</p></div></div>}
    {ticket.error&&<div className="error-box" role="status">{ticket.error}</div>}
    {old&&<div className="info-strip">Посещение {ticket.day}. Статус больше не обновляется.</div>}
    {!old&&t?.status===0&&<>
      <section className={`forecast-hero ${stale?'stale':''}`}>
        <div className="hero-top"><span className="eyebrow">НАШ ПРОГНОЗ ВЫЗОВА</span><Activity size={19}/></div>
        <div className="eta">{f?.seconds!=null?clock(f.at+f.seconds*1000):'—'}<span>{f?.seconds!=null?`ещё ≈ ${minutes(f.seconds)} мин`:'Собираем данные'}</span></div>
        {f?.low!=null&&f.high!=null?<p className="range">Ориентир {clock(f.at+f.low*1000)} — {clock(f.at+f.high*1000)}</p>:<p className="range">{f?.reason||'Прогноз появится после обновления очереди'}</p>}
        {stale&&<div className="hero-bottom">Данные устарели</div>}
      </section>
      <div className="metric-grid">
        <section className="metric"><div className="small-label">ПЕРЕД ВАМИ · ОЦЕНКА</div><div className="metric-value">{f?.ahead??'—'}<span>талонов</span></div><p>По времени выдачи и окнам</p></section>
        <section className="metric"><div className="small-label">ПРОГНОЗ МИГРАЦИИ</div><div className="metric-value small">{f?.officialSeconds!=null?clock(f.at+f.officialSeconds*1000):'—'}</div><p>{f?.officialSeconds!=null?`≈ ${minutes(f.officialSeconds)} мин · ${f.officialAhead} перед вами`:'Пока нет данных'}</p></section>
      </div>
      <details className="explanation"><summary>Как считается прогноз <ChevronDown size={16}/></summary><p>Моделируем освобождение окон по времени обслуживания и неявкам. Диапазон охватывает 10–90% из 300 расчётных сценариев и не гарантирует время вызова. Приоритеты могут изменить порядок.</p><p>Счётчик Миграции зависит от порядка записей в ответе API. Наша оценка использует время выдачи талонов и совместимость окон.</p>{f?.notes.map(n=><p key={n}>• {n}</p>)}</details>
    </>}
    <Desks data={data} now={now} filter={ticket.desks} onAdd={onAdd} sourceError={sourceError}/>
    <section className="panel"><SectionTitle label="Информация о талоне"/><div className="facts"><div><span>Выдан</span><strong>{clock(t?.taken)}</strong></div><div><span>Ожидание по Миграции</span><strong>{t?.waitMinutes!=null?`${t.waitMinutes} мин`:'—'}</strong></div><div><span>Вызван</span><strong>{clock(t?.called)}{t?.desk?` · окно ${t.desk}`:''}</strong></div><div><span>Начало обслуживания</span><strong>{clock(t?.arrived)}</strong></div><div><span>Завершён</span><strong>{clock(t?.finished)}</strong></div></div></section>
    <Accuracy ticket={ticket}/>
    <div className="ticket-actions"><a className="button secondary full" href={`https://mvr-migracia.sky.bg/customer.html?qr=${encodeURIComponent(ticket.qr)}`} target="_blank" rel="noreferrer">Открыть сайт Миграции <ExternalLink size={16}/></a><button className="text-button danger remove-ticket" onClick={()=>{if(confirm('Удалить этот талон из отслеживаемых?'))void engine.remove(ticket.id).then(()=>navigate('/'));}}><Trash2 size={15}/> Удалить талон</button></div>
    {!old&&t?.status===0&&<section className="thresholds"><div><Bell size={17}/><strong>Напомним, когда приблизится очередь</strong></div><div className="threshold-pills">{[20,10,5,3].map(n=><span className={ticket.alerts.thresholds.includes(n)?'done':''} key={n}>{ticket.alerts.thresholds.includes(n)&&<Check size={12}/>} {n} талонов</span>)}</div><p>Сообщения на экране. Звук включается в настройках.</p></section>}
  </>;
}
const intervalLabels:Record<DeskInterval['state'],string>={'serving':'Обслуживание','called':'Вызов','no-show':'Неявка','idle':'Ожидание клиента','closed':'Не принимает','unknown':'Нет наблюдений'};
export function Desks({data,now,filter,onAdd,sourceError=''}:{data:AppState;now:number;filter?:number[];onAdd:()=>void;sourceError?:string}) {
  const desks=(data.snapshot?.desks??[]).filter(d=>!filter||filter.includes(d.number)).sort((a,b)=>a.number-b.number);
  const fresh=isSnapshotFresh(data.snapshot,now);
  const hasToday=data.tracked.some(t=>t.day===dayKey(now));
  const all=[...ticketIntervals(data.records,data.snapshot?.at??now),...data.intervals.filter(i=>['idle','closed','unknown'].includes(i.state))];
  const [showAll,setShowAll]=useState(false);
  const visible=filter||showAll?desks:desks.filter(d=>[4,5,7].includes(d.status??0));
  return <section className="desks-section"><SectionTitle label={filter?'Ваши окна':'Окна Миграции'} extra={fresh?<span className="muted small">{desks.filter(d=>[4,5,7].includes(d.status??0)&&!currentDesk(d,data.snapshot!).inconsistent).length} принимают</span>:undefined}/>
    {!fresh&&<div className="desk-freshness" role="status"><strong>{data.snapshot?'Данные устарели':'Нет актуальных данных'}</strong><p>{!hasToday?'Нет QR текущего дня. Добавьте новый талон для обновления окон.':sourceError||'Ожидаем успешное обновление.'}</p>{data.snapshot&&<p>Последние известные значения на {clock(data.snapshot.at)}.</p>}<button className="text-button" onClick={onAdd}><Plus size={15}/> Добавить талон</button></div>}
    {!filter&&desks.length>0&&<button className="text-button desk-filter" onClick={()=>setShowAll(!showAll)}>{showAll?'Только принимающие':'Показать все окна'}</button>}{!desks.length?<div className="panel empty-small"><LayoutGrid/><p>Добавьте действующий талон,<br/>чтобы получать данные окон.</p></div>:visible.map(d=>{
    const records=all.filter(i=>i.desk===d.number).sort((a,b)=>b.start-a.start);
    const end=data.snapshot?.at??now, start=end-3600000;
    const current=currentDesk(d,data.snapshot!);
    const label=current.label;
    return <details className="desk-card" key={d.number}><summary><span className="desk-number">{d.number}</span><span className="desk-main"><strong>Окно {d.number}</strong><span><i className={fresh&&!current.inconsistent&&[4,5,7].includes(d.status??0)?'live-dot':'offline-dot'}/>{label}</span></span><span className="desk-current"><strong>{current.inconsistent?'—':current.ticket?.number??'—'}</strong><span>{!fresh?`на ${clock(data.snapshot!.at)}`:current.ticket&&d.called?`с ${clock(d.called)}`:current.inconsistent?'сверяем данные':'нет талона'}</span></span><ChevronDown size={16}/></summary><div className="desk-expanded"><div className="small-label">ПОСЛЕДНИЙ ЧАС · НАЖМИТЕ НА ИНТЕРВАЛ</div><div className="timeline" aria-label={`История окна ${d.number} за час`}>{records.filter(i=>i.end>start&&i.start<end).map((i,index)=><button key={index} className={`timeline-segment ${i.state}`} style={{left:`${Math.max(0,(i.start-start)/3600000)*100}%`,width:`${Math.max(.4,(Math.min(end,i.end)-Math.max(start,i.start))/3600000*100)}%`}} aria-label={`${i.ticketNumber||intervalLabels[i.state]} ${clock(i.start)}–${clock(i.end)}`} title={`${i.ticketNumber} · ${intervalLabels[i.state]} · ${duration((i.end-i.start)/1000)}`} onClick={()=>alert(`${i.ticketNumber||'Окно '+d.number} · ${intervalLabels[i.state]}\n${clock(i.start)} — ${clock(i.end)}\n${i.uncertain?'Границы приблизительные':'Время из API'}`)}/>)}</div><div className="chart-labels"><span>{clock(start)}</span><span>{clock(end)}</span></div><div className="legend"><span><i className="serving"/>Приём</span><span><i className="called"/>Вызов</span><span><i className="no-show"/>Неявка</span><span><i className="unknown"/>Нет данных</span></div><div className="history-table"><div className="history-row table-head"><span>Талон / событие</span><span>Начало</span><span>Время</span></div>{records.slice(0,40).map((i,index)=><div className="history-row" key={index}><span><strong>{i.ticketNumber||'—'}</strong><small>{intervalLabels[i.state]}</small></span><span>{clock(i.start)}</span><span>{i.uncertain?'≈ ':''}{duration((i.end-i.start)/1000)}</span></div>)}</div><p className="privacy-note">«≈» — неполные наблюдения или повторный вызов. Длительность текущего приёма показана на момент обновления.</p></div></details>;
  })}</section>;
}
export function Settings({data,wakeState}:{data:AppState;wakeState:string}) {
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const run=async(fn:()=>Promise<unknown>)=>{setError('');try{await fn();}catch(e){setError(errorText(e));}};
  return <><div className="page-heading compact"><h1>Настройки</h1></div><section className="panel settings-panel"><div className="setting-row"><Volume2/><div><strong>Звук уведомлений</strong><p>Включите заново после открытия Safari, чтобы разрешить воспроизведение.</p></div><button aria-label="Звук уведомлений" role="switch" aria-checked={data.settings.sound} className={`toggle ${data.settings.sound?'on':''}`} onClick={()=>void run(async()=>{if(!data.settings.sound)await enableSound();await engine.settings({sound:!data.settings.sound});})}/></div>{data.settings.sound&&<button className="text-button" onClick={()=>void run(enableSound)}>Проверить и разрешить звук</button>}<div className="setting-row"><Smartphone/><div><strong>Не выключать экран</strong><p>{wakeState}. Работает, пока приложение видно.</p></div><button aria-label="Не выключать экран" role="switch" aria-checked={data.settings.wakeLock} className={`toggle ${data.settings.wakeLock?'on':''}`} onClick={()=>void run(()=>engine.settings({wakeLock:!data.settings.wakeLock}))}/></div><div className="setting-row"><Bell/><div><strong>Системные уведомления</strong><p>Если поддерживаются браузером. На iPhone основной канал — сообщения внутри приложения.</p></div><button aria-label="Системные уведомления" role="switch" aria-checked={data.settings.notifications} className={`toggle ${data.settings.notifications?'on':''}`} onClick={()=>void run(async()=>{if(data.settings.notifications){await engine.settings({notifications:false});return;}if(!('Notification'in window))throw new Error('В этом режиме Safari системные уведомления недоступны. Используйте сообщения на экране и звук.');const p=await Notification.requestPermission();if(p!=='granted')throw new Error('Разрешение не получено. Сообщения внутри приложения остаются включены.');await engine.settings({notifications:true});})}/></div></section>
  <div className="info-card"><Eye/><div><strong>В фоне нет гарантированного обновления</strong><p>Блокировка iPhone или переключение приложения может остановить опрос. При возвращении мы сразу обновим данные. Установка на домашний экран не отменяет это ограничение.</p></div></div>
  <button className="text-button danger reset-app" onClick={()=>{if(confirm('Удалить все талоны, настройки и историю с этого устройства?'))void run(async()=>{await engine.clear();setNotice('Приложение сброшено');});}}><Trash2 size={16}/> Сбросить приложение</button>
  <section className="panel install-panel"><Smartphone/><h3>Добавьте на экран «Домой»</h3><p>В Safari откройте меню «Поделиться» → «На экран “Домой”». Приложение будет открываться отдельным окном.</p></section>{error&&<p className="error-box" role="alert">{error}</p>}{notice&&<p className="info-strip" role="status">{notice}</p>}</>;
}
export default function App(){
  const view=useSyncExternalStore(engine.subscribe,engine.getSnapshot,engine.getSnapshot),{data}=view,route=useRoute(),now=useNow();
  const [scan,setScan]=useState(false),[dismissed,setDismissed]=useState<Set<string>>(new Set()),[wakeState,setWakeState]=useState('Выключено');
  const wake=useRef<WakeLockSentinel|null>(null);
  useEffect(()=>{engine.start();},[]);
  useEffect(()=>{
    let alive=true;
    const acquire=async()=>{
      if(!data.settings.wakeLock){await wake.current?.release();wake.current=null;setWakeState('Выключено');return;}
      if(!('wakeLock'in navigator)){setWakeState('Недоступно в этом браузере');return;}
      if(document.visibilityState!=='visible')return;
      try{await wake.current?.release();const lock=await navigator.wakeLock.request('screen');if(!alive){await lock.release();return;}wake.current=lock;setWakeState('Экран остаётся включённым');lock.addEventListener('release',()=>{if(alive)setWakeState('Удержание экрана приостановлено');});}catch{if(alive)setWakeState('Система не разрешила удержание экрана');}
    };void acquire();document.addEventListener('visibilitychange',acquire);return()=>{alive=false;document.removeEventListener('visibilitychange',acquire);void wake.current?.release();wake.current=null;};
  },[data.settings.wakeLock]);
  useEffect(()=>{window.scrollTo(0,0);},[route]);
  const tab=route==='/settings'?'settings':route==='/desks'?'desks':'tickets';
  const selected=route.startsWith('/ticket/')?data.tracked.find(t=>t.id===route.slice(8)):null;
  const fresh=isSnapshotFresh(data.snapshot,now);
  const latestMessage=data.messages.filter(m=>!dismissed.has(m.id)&&now-m.at<3600000).at(-1);
  return <div className="app-shell"><header className="topbar"><button className="brand" onClick={()=>navigate('/')}><span className="brand-icon"><ScanLine size={22}/></span><span>на очереди<span className="brand-dot">.</span></span></button><span className="header-label">МИГРАЦИЯ</span></header>
  {view.demo&&<div className="demo-banner"><span><Eye size={15}/> Демонстрационный режим</span><button onClick={()=>{engine.exitDemo();navigate('/');}}>Выйти <X size={15}/></button></div>}
  <main>{data.tracked.length>0&&<div className="connection-line"><span><i className={fresh?'live-dot':'offline-dot'}/>{view.loading?'Обновляем…':data.lastSuccess?`Обновлено в ${clock(data.lastSuccess)}`:'Ожидаем данные'}{data.lastSuccess&&!fresh?' · устарело':''}</span><button className={view.loading?'spinning':''} aria-label="Обновить сейчас" disabled={view.loading||view.demo} onClick={()=>void engine.refresh()}><RefreshCw size={15}/></button></div>}
  {view.error&&<div className="error-box" role="status"><WifiOff size={18}/>{view.error}</div>}{view.storageError&&<div className="error-box" role="alert">{view.storageError}<button className="text-button" onClick={()=>navigate('/settings')}>Открыть настройки</button></div>}
  {latestMessage&&<div className="notification" role="alert"><BellRing size={21}/><button className="notification-text" onClick={()=>navigate(`/ticket/${latestMessage.ticketId}`)}>{latestMessage.text}</button><button className="icon-button" aria-label="Скрыть уведомление" onClick={()=>setDismissed(new Set([...dismissed,latestMessage.id]))}><X size={18}/></button></div>}
  {selected?<TicketDetail ticket={selected} data={data} now={now} onAdd={()=>setScan(true)} sourceError={view.error}/>:tab==='settings'?<Settings data={data} wakeState={wakeState}/>:tab==='desks'?<><div className="page-heading compact"><h1>Окна</h1></div><Desks data={data} now={now} onAdd={()=>setScan(true)} sourceError={view.error}/></>:<Home data={data} now={now} onAdd={()=>setScan(true)} demo={view.demo}/>}
  <footer className="page-footer disclaimer">Информация основана на прогнозе, который может ошибаться. Сервис не несёт ответственности за её точность и последствия использования. Используйте на свой страх и риск.</footer></main>
  <nav className="bottom-nav" aria-label="Основная навигация"><button className={tab==='tickets'?'active':''} onClick={()=>navigate('/')}><QrCode size={21}/><span>Мои талоны</span></button><button className={tab==='desks'?'active':''} onClick={()=>navigate('/desks')}><LayoutGrid size={21}/><span>Окна</span></button><button className={tab==='settings'?'active':''} onClick={()=>navigate('/settings')}><Settings2 size={21}/><span>Настройки</span></button></nav>
  {scan&&<Suspense fallback={<div className="modal-backdrop"><div className="modal">Открываем сканер…</div></div>}><Scanner onClose={()=>setScan(false)} onAdd={async value=>{const id=await engine.add(value);setScan(false);navigate(`/ticket/${id}`);}}/></Suspense>}</div>;
}
