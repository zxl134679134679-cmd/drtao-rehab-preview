import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel} from './legacy-test-fixture.mjs';
import {confirmedTestSchedules,confirmTestShift} from './scheduling-test-fixture.mjs';
import {ensureCustomerBooking,confirmCustomerBooking} from './customer-booking.js';
const api=await import('./multi-day-booking.js').catch(()=>({}));
const boss={type:'boss',id:'boss'},customer={type:'customer',id:'c1'},manager={type:'manager',id:'m1'},front={type:'frontdesk',id:'f1'};
const fixture=()=>{const m=confirmedTestSchedules(new DemoModel({now:()=> '2026-10-09T04:00:00.000Z'}));ensureCustomerBooking(m);return m;};
const input=extra=>({clientId:'c1',storeId:'a',project:'基础训练',items:[{date:'2026-10-12',time:'11:30',principalId:'t1'},{date:'2026-10-14',time:'14:00',principalId:'t1'}],requestId:'multi-day-one',...extra});
const snapshot=m=>JSON.stringify([m.state,m.sequence]);
function save(m,data=input(),role=customer){assert.equal(typeof api.saveMultiDayBooking,'function','一次约多天 model API 未实现');return api.saveMultiDayBooking(m,data,role);}
const finance=m=>JSON.stringify([m.state.packages,m.state.services,m.state.receipts,m.state.refunds,m.state.reviews,m.state.clients.map(c=>m.remaining(c.id))]);
function denied(m,data,role,pattern=/./){const before=snapshot(m);assert.throws(()=>save(m,data,role),pattern);assert.equal(snapshot(m),before,'失败整批不得写预约、申请、审计或消耗序列');}

test('customer can request two nonconsecutive days without occupying slots or financial changes',()=>{
 const m=fixture(),before=finance(m),keys=Object.keys(m.state),count=m.state.appointments.length;
 const result=save(m);assert.equal(result.count,2);assert.equal(result.items.length,2);assert.deepEqual(result.items.map(r=>r.status),['pending','pending']);assert.equal(m.state.appointments.length,count);assert.equal(m.state.bookingRequests.length,2);assert.equal(finance(m),before);assert.deepEqual(Object.keys(m.state),keys);
 assert.deepEqual(result.items.map(r=>[r.date,r.time,r.principalId]),input().items.map(r=>[r.date,r.time,r.principalId]));
 for(const row of result.items)for(const field of ['requestId','inputKey','items','batchInputKey'])assert.equal(Object.hasOwn(row,field),false);
 confirmCustomerBooking(m,result.items[0].id,front);assert.equal(m.state.bookingRequests[1].status,'pending');assert.equal(m.state.appointments.length,count+1);
});

test('front desk, boss and authorized therapist can confirm each independent day with their actual identity',()=>{
 for(const role of [front,{type:'therapist',id:'t1'},boss]){const m=fixture(),before=finance(m),count=m.state.appointments.length,result=save(m,input(),role);assert.equal(result.count,2);assert.ok(result.items.every(r=>r.status==='confirmed'));assert.equal(m.state.appointments.length,count+2);assert.equal(m.state.bookingRequests.length,0);assert.equal(finance(m),before);assert.equal(m.state.audit[0].actorType,role.type);assert.equal(m.state.audit[0].actorId,role.id);}
});

test('entire batch is atomic when the last day has a shift or booking conflict, including customer requests',()=>{
 for(const role of [customer,front])for(const mode of ['conflict','shift']){const m=fixture();if(mode==='conflict')m.saveAppointment({clientId:'c3',storeId:'a',date:'2026-10-14',time:'14:30',principalId:'t1',project:'别的服务'},boss);else confirmTestShift(m,{therapistId:'t1',date:'2026-10-14',startTime:'09:00',endTime:'14:30'});denied(m,input(),role,/第\s*2\s*天[\s\S]*(未保存|未提交)/);}
});

test('invalid count, repeated dates, past dates and quarter-hour time all fail without changing memory',()=>{
 const m=fixture();for(const items of [[],[input().items[0]],Array.from({length:15},(_,i)=>({...input().items[0],date:`2026-10-${String(i+10).padStart(2,'0')}`})),[input().items[0],{...input().items[1],date:'2026-10-12'}],[{...input().items[0],date:'2026-10-07'},input().items[1]],[{...input().items[0],time:'11:15'},input().items[1]],[{...input().items[0],date:'2026-02-30'},input().items[1]]])denied(m,input({items}),customer,/./);
});

test('retry keys remain idempotent and changed content cannot reuse a batch key',()=>{
 for(const role of [customer,front]){const m=fixture(),first=save(m,input(),role),before=snapshot(m);assert.deepEqual(save(m,input(),role),first);assert.equal(snapshot(m),before);denied(m,input({items:[input().items[0],{...input().items[1],time:'15:00'}]}),role,/提交|内容|变化/);const restored=fixture();restored.state=structuredClone(m.state);restored.sequence=m.sequence;assert.deepEqual(save(restored,input(),role),first);}
});

test('manager new multi-day bookings stay idempotent and reject existing identifiers and inactive actors',()=>{for(const data of [input({id:''}),input({items:[input().items[0],{...input().items[1],id:'a1'}]})]){const m=fixture();denied(m,data,manager,/本店|权限|新建|已有|店长|字段|未保存/);}const m=fixture(),result=save(m,input(),manager);assert.ok(result.items.every(r=>r.status==='confirmed'));m.state.storeManagers.find(p=>p.id==='m1').active=false;denied(m,input(),manager,/在职|停用|店长|权限/);});

test('each day may choose a different authorized therapist and missing or resting shifts stay blocked',()=>{
 const m=fixture();confirmTestShift(m,{therapistId:'t2',storeId:'a',date:'2026-10-14'});const result=save(m,input({items:[input().items[0],{...input().items[1],principalId:'t2'}]}),customer);assert.deepEqual(result.items.map(row=>row.principalId),['t1','t2']);
 for(const mode of ['missing','rest']){const n=fixture();n.state.staffSchedules=n.state.staffSchedules.filter(row=>!(row.therapistId==='t1'&&row.date==='2026-10-14'));if(mode==='rest')n.state.staffSchedules.push({id:'rest-test',therapistId:'t1',storeId:'a',date:'2026-10-14',status:'rest',startTime:'',endTime:'',version:1});denied(n,input(),customer,/第\s*2\s*天[\s\S]*未保存/);}
});

test('customer cannot target another client and front desk cannot use another store',()=>{const m=fixture();denied(m,input({clientId:'c2'}),customer,/本人/);denied(m,input({clientId:'c2',storeId:'b',items:input().items.map(row=>({...row,principalId:'t2'}))}),front,/门店|权限/);});

test('replay rejects a live record whose last day date, principal, client or store was changed',()=>{
 for(const change of [{date:'2026-10-15'},{principalId:'t2'},{clientId:'c3'},{storeId:'b'},{project:'另一项目'},{time:'15:00'}]){const m=fixture(),result=save(m,input(),front);Object.assign(m.state.appointments.find(row=>row.id===result.items[1].id),change);denied(m,input(),front,/关联|变化|本店|权限/);}
});

test('reopening the same pending days reuses requests; confirmed days block an all-new batch atomically',()=>{
 const m=fixture(),first=save(m),count=m.state.bookingRequests.length,next=save(m,input({requestId:'multi-reopen'}));assert.deepEqual(next.items.map(row=>row.id),first.items.map(row=>row.id));assert.equal(m.state.bookingRequests.length,count);
 confirmCustomerBooking(m,first.items[1].id,front);assert.equal(save(m).items[1].status,'confirmed');denied(m,input({requestId:'new-after-confirm'}),customer,/第\s*2\s*天[\s\S]*未保存/);
});

test('unknown batch or daily permission fields are rejected rather than ignored',()=>{const m=fixture();denied(m,input({actorRole:'boss'}),manager,/不支持|字段/);denied(m,input({items:[input().items[0],{...input().items[1],actorId:'boss'}]}),front,/第\s*2\s*天[\s\S]*未保存/);});

test('the full 14-day limit saves independent dates and a reconstructed validated state replays without duplicates',()=>{
 const items=Array.from({length:14},(_,index)=>({date:`2026-10-${String(index+9).padStart(2,'0')}`,time:index%2?'14:30':'11:00',principalId:'t1'}));
 for(const role of [customer,front]){const m=fixture(),result=save(m,input({items}),role),restored=new DemoModel({state:structuredClone(m.state),sequence:m.sequence,now:()=> '2026-10-09T04:00:00.000Z'});ensureCustomerBooking(restored);assert.equal(result.count,14);assert.equal(new Set(result.items.map(row=>row.date)).size,14);const before=snapshot(restored);assert.deepEqual(save(restored,input({items}),role),result);assert.equal(snapshot(restored),before);}
});
