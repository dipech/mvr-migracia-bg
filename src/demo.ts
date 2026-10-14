import { emptyState } from './storage';
import type { Desk, QueueTicket, TrackedTicket } from './types';
import { makeForecast } from './forecast';
export function demoState() {
  const now=Date.now(), state=emptyState(now);
  const service='РАЗРЕШЕНИЕ ЗА ПРОДЪЛЖИТЕЛНО ПРЕБИВАВАНЕ (СДВР)';
  const ticket=(n:number,desk:number|null,status:number,called:number|null,finished:number|null):QueueTicket=>({id:String(1000+n),number:`C${n}`,service,status,statusText:'',desks:[10,11,12],desk,priority:'Нормален',taken:now-7200000+n*1000,called,arrived:called===null?null:called+15000,finished,forecastSeconds:420,waitMinutes:68,calls:1});
  const records:QueueTicket[]=[];
  for(let n=1;n<=27;n++) {
    const desk=10+(n%3),start=now-(30-n)*240000;
    records.push(ticket(n,desk,n%6===0?8:9,start,start+(n%6===0?50000:240000+(n%4)*80000)));
  }
  records.push(ticket(28,10,2,now-180000,null),ticket(29,11,2,now-300000,null),ticket(30,12,2,now-90000,null));
  for(let n=31;n<=47;n++) records.push(ticket(n,null,0,null,null));
  const desks:Desk[]=[10,11,12].map((number,i)=>({number,status:5,statusText:'РАБОТИ С КЛИЕНТ',ticketId:String(1028+i),ticketNumber:`C${28+i}`,service,called:records.find(t=>t.id===String(1028+i))!.called,dailyPeople:9+i}));
  state.records=records;state.snapshot={at:now,tickets:records,desks};state.lastSuccess=now;
  const tracked:TrackedTicket={qr:'DEMO0042',id:'1042',number:'C42',service,serviceId:'demo',desks:[10,11,12],day:state.day,addedAt:now-1800000,metadataAt:now,last:records.find(t=>t.id==='1042')!,forecast:null,alerts:{thresholds:[20],called:false},predictions:[]};
  tracked.forecast=makeForecast(tracked,state.snapshot,records,[],()=>0.47);
  state.tracked=[tracked];
  for(const d of desks)state.intervals.push({desk:d.number,ticketId:d.ticketId,ticketNumber:d.ticketNumber,service,start:now-60000,end:now,state:'serving',source:'observed',uncertain:true});
  return state;
}
