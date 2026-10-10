import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { ensureSchedules,saveSchedule,scheduleStatus } from './schedules.js';
import { updateAppointmentAvailability } from './booking-availability.js';
import { hourTimeField } from './hour-picker.js';
const boss={type:'boss',id:'boss'},esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sequence=0;
function shift(model,therapistId,date,startTime,endTime){const storeId=model.state.therapists.find(p=>p.id===therapistId).storeId;saveSchedule(model,{therapistId,storeId,date,status:'work',startTime,endTime,reason:'测试班次',expectedVersion:scheduleStatus(model,therapistId,date).version,requestId:`test-shift-${++sequence}`},boss);}
function fixture(){const model=new DemoModel({today:'2026-10-09',now:()=> '2026-10-09T08:00:00.000Z'});ensureSchedules(model);model.state.appointments=[];for(const id of ['t1','t2','t3'])shift(model,id,model.today,'09:00','12:00');return model;}
function appointment(model,{clientId='c1',principalId='t1',storeId='a',time='10:00',date=model.today}={}){return model.saveAppointment({clientId,principalId,storeId,time,date,project:'测试服务'},boss);}
// This boundary emulates only native select option parsing/selection and form
// serialization. Schedule, collision, cancellation and role checks remain real.
function nativeSelect(markup=''){
 let options=[],value='';
 const select={disabled:false,get options(){return options;},get value(){return value;},set value(next){value=options.some(o=>o.value===String(next))?String(next):'';},get innerHTML(){return markup;},set innerHTML(html){markup=html;options=[...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([all,attrs,text])=>({value:/\bvalue="([^"]*)"/.exec(attrs)?.[1]||'',disabled:/\bdisabled\b/.test(attrs),selected:/\bselected\b/.test(attrs),textContent:text}));value=(options.find(o=>o.selected)||options[0])?.value||'';}};
 select.innerHTML=markup;return select;
}
function boundary({type='appointment-create',clientId='c1',storeId='a',principalId='t1',date='2026-10-09',time='',id='',appointmentId='',members=[]}={}){
 const timeSelect=nativeSelect(hourTimeField(time,esc).match(/<select[^>]*>([\s\S]*?)<\/select>/)[1]),note={innerHTML:''},submit={disabled:false};
 const elements=Object.fromEntries(Object.entries({clientId,storeId,principalId,date,id,appointmentId}).map(([key,value])=>[key,key==='principalId'?nativeSelect(`<option value="${value}" selected>${value}</option>`):{value}]));elements.time=timeSelect;
 const rows=members.map(member=>({querySelector:s=>({value:s==='[data-booking-principal]'?member.principalId:member.clientId})}));
 const form={dataset:{form:type,step:'2'},elements,querySelector:s=>s==='[data-booking-availability]'?note:s==='[type="submit"]'?submit:null,querySelectorAll:s=>s==='[data-booking-member]'?rows:[]};
 return {form,time:timeSelect,note,submit};
}
function update(b,model,role=boss){const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=Object.entries(form.elements).filter(([,control])=>!control.disabled).map(([key,control])=>[key,control.value]);}[Symbol.iterator](){return this.values[Symbol.iterator]();}};try{updateAppointmentAvailability(b.form,{model,role,esc});}finally{globalThis.FormData=original;}}
const options=b=>[...b.time.options].filter(o=>o.value).map(o=>o.value);

test('booked and overlapping half-hours disappear from the menu while full-length free starts remain',()=>{
 const m=fixture();appointment(m);const b=boundary({clientId:'c3'});update(b,m);
 assert.deepEqual(options(b),['09:00','11:00']);assert.ok(b.time.options.filter(o=>o.value).every(o=>!o.disabled));
});
test('select choices rebuild on date, store and therapist changes and restore after cancellation',()=>{
 const m=fixture(),booked=appointment(m),b=boundary();update(b,m);assert.deepEqual(options(b),['09:00','11:00']);
 m.cancelAppointment(booked.id,'客户取消',boss);update(b,m);assert.deepEqual(options(b),['09:00','09:30','10:00','10:30','11:00']);
 shift(m,'t1','2026-10-10','09:00','11:00');b.form.elements.date.value='2026-10-10';update(b,m);assert.deepEqual(options(b),['09:00','09:30','10:00']);
 b.form.elements.date.value=m.today;b.form.elements.storeId.value='b';update(b,m);assert.deepEqual(options(b),[]);
 b.form.elements.principalId=nativeSelect('<option value="t2" selected>t2</option>');update(b,m);assert.deepEqual(options(b),['09:00','09:30','10:00','10:30','11:00']);
});
test('an occupied selected time is cleared with a reselection notice and never silently replaced',()=>{
 const m=fixture(),b=boundary({time:'10:00'});update(b,m);assert.equal(b.time.value,'10:00');appointment(m);update(b,m);
 assert.equal(b.time.value,'');assert.deepEqual(options(b),['09:00','11:00']);assert.match(b.note.innerHTML,/重新选择/);assert.equal(b.submit.disabled,false,'other times remain selectable');update(b,m);assert.match(b.note.innerHTML,/重新选择/,'reselection hint survives the customer change handler double update');b.time.value='11:00';update(b,m);assert.doesNotMatch(b.note.innerHTML,/重新选择/);assert.equal(b.time.value,'11:00');
});
test('editing and customer rescheduling exclude the original appointment while checking other bookings',()=>{
 const m=fixture(),a=appointment(m);
 for(const data of [{type:'appointment-edit',id:a.id,time:'10:00'},{type:'reschedule',appointmentId:a.id,time:'10:00',principalId:'',storeId:''}]){
  const b=boundary(data);update(b,m,{type:'customer',id:'c1'});assert.deepEqual(options(b),['09:00','09:30','10:00','10:30','11:00']);assert.equal(b.time.value,'10:00');
 }
});
test('customer conflicts at another store and the group intersection both remove occupied starts',()=>{
 const m=fixture();appointment(m,{storeId:'b',principalId:'t2'});const c=boundary();update(c,m);assert.deepEqual(options(c),['09:00','11:00']);
 m.state.appointments=[];shift(m,'t1',m.today,'09:00','13:00');shift(m,'t3',m.today,'09:00','13:00');m.transferClient('c6','t3','测试交接',boss);
 appointment(m);appointment(m,{clientId:'c6',principalId:'t3',time:'12:00'});
 const group=boundary({type:'appointment-batch',members:[{clientId:'c3',principalId:'t1'},{clientId:'c6',principalId:'t3'}]});update(group,m);assert.deepEqual(options(group),['09:00','11:00']);
});
test('missing details and days without any slot show an empty menu and cannot submit',()=>{
 const m=fixture();
 for(const data of [{date:''},{storeId:''},{principalId:''},{clientId:''},{type:'appointment-batch',members:[{clientId:'',principalId:'t1'}]}]){
  const b=boundary(data);update(b,m);assert.deepEqual(options(b),[]);assert.equal(b.time.value,'');assert.equal(b.submit.disabled,true);assert.match(b.note.innerHTML,/先选/);
 }
 for(const data of [{date:'2026-11-01'},{principalId:'t5',clientId:'c5'},{storeId:'b'}]){
  const b=boundary(data);update(b,m);assert.deepEqual(options(b),[]);assert.equal(b.submit.disabled,true);assert.match(b.note.innerHTML,/没有可安排时段|休息|未排班/);
 }
 const customer=boundary({type:'customer-booking',date:'',principalId:'t1'});customer.form.dataset.step='1';update(customer,m,{type:'customer',id:'c1'});assert.deepEqual(options(customer),[]);assert.equal(customer.submit.disabled,false,'store step must still advance');
});
test('customer time filtering and a competing pending request preserve request-not-reservation semantics',async()=>{
 const {ensureCustomerBooking,requestCustomerBooking}=await import('./customer-booking.js');const m=fixture();ensureCustomerBooking(m);
 requestCustomerBooking(m,{storeId:'a',date:m.today,time:'10:00',principalId:'t1',project:'康复服务',requestId:'request-does-not-hold'}, {type:'customer',id:'c1'});
 const b=boundary({type:'customer-booking',clientId:'c3'});update(b,m,{type:'customer',id:'c3'});
 assert.deepEqual(options(b),['09:00','09:30','10:00','10:30','11:00']);assert.deepEqual(m.state.appointments,[]);
});

test('changed-request and reassignment states hold original starts, while ended bookings release them',()=>{
 const m=fixture(),a=appointment(m),b=boundary({clientId:'c3'});
 m.requestReschedule(a.id,{date:m.today,time:'11:00',reason:'客户请求晚一点'}, {type:'customer',id:'c1'});update(b,m);assert.deepEqual(options(b),['09:00','11:00'],'requested new time does not reserve an additional slot');
 a.status='pending_reassignment';update(b,m);assert.deepEqual(options(b),['09:00','11:00']);
 for(const status of ['cancelled','no_show','completed']){a.status=status;update(b,m);assert.deepEqual(options(b),['09:00','09:30','10:00','10:30','11:00']);}
});
