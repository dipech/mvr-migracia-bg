import { describe, it, expect } from 'vitest';
import { currentDesk, maxCurrentNumber, isSnapshotFresh } from '../src/current';
import { NOW, serving, tracked, snapshot, ticket, desk } from './fixtures';

describe('current desk number',()=>{
  it('compares numeric suffixes and includes called and servicing tickets',()=>{
    const a=serving('a','P9',21),b=serving('b','P100',22,1);
    expect(maxCurrentNumber(tracked({desks:[21,22]}),snapshot([a.ticket,b.ticket],[a.desk,b.desk]),NOW)).toBe('P100');
  });
  it('ignores other series and windows outside the ticket service',()=>{
    const values=[serving('a','P42',21),serving('b','P999',23),serving('c','C999',22)];
    expect(maxCurrentNumber(tracked({desks:[21,22]}),snapshot(values.map(v=>v.ticket),values.map(v=>v.desk)),NOW)).toBe('P42');
  });
  it('links repeated printed numbers by ID instead of selecting the historical record',()=>{
    const live=serving('new','P809');
    const old=ticket('old',{number:'P809',status:9,desk:21,finished:NOW-10000});
    const s=snapshot([old,live.ticket],[live.desk]);
    expect(currentDesk(live.desk,s).ticket?.id).toBe('new');
    expect(maxCurrentNumber(tracked(),s,NOW)).toBe('P809');
  });
  it('does not use another ID with the same number when the window record is outdated',()=>{
    const live=serving('new','P809');
    const s=snapshot([ticket('old',{status:9,number:'P809',desk:21}),live.ticket],[{...live.desk,ticketId:'old'}]);
    expect(currentDesk(s.desks[0],s).inconsistent).toBe(true);
    expect(maxCurrentNumber(tracked(),s,NOW)).toBeNull();
  });
  it('flags missing or conflicting window/ticket status and wrong window numbers',()=>{
    const a=serving('a','P42');
    for(const s of [snapshot([],[a.desk]), snapshot([{...a.ticket,status:9}],[a.desk]), snapshot([{...a.ticket,desk:22}],[a.desk]), snapshot([a.ticket],[{...a.desk,status:7}])]) {
      expect(currentDesk(s.desks[0],s).label).toBe('Данные уточняются');
    }
  });
  it('flags an idle window if the queue says it still has an active ticket',()=>{
    const a=serving('a','P42');
    expect(currentDesk(desk(),snapshot([a.ticket])).inconsistent).toBe(true);
  });
  it('has no maximum when idle, stale, from a different day or without a snapshot',()=>{
    expect(maxCurrentNumber(tracked(),snapshot(),NOW)).toBeNull();
    const a=serving('a','P42'),s=snapshot([a.ticket],[a.desk]);
    expect(maxCurrentNumber(tracked(),s,NOW+14999)).toBe('P42');
    expect(maxCurrentNumber(tracked(),s,NOW+15000)).toBeNull();
    expect(maxCurrentNumber(tracked({day:'2026-10-13'}),s,NOW)).toBeNull();
    expect(maxCurrentNumber(tracked(),null,NOW)).toBeNull();
    expect(isSnapshotFresh(s,NOW-1000)).toBe(false);
  });
});
