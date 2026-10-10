import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DemoModel} from './legacy-test-fixture.mjs';
import {confirmedTestSchedules} from './scheduling-test-fixture.mjs';
import {ensureCustomerBooking} from './customer-booking.js';
import {saveMultiDayBooking} from './multi-day-booking.js';
const ui=await import('./multi-day-booking-ui.js').catch(()=>({}));
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const input={clientId:'c1',storeId:'a',project:'基础训练',dayDate_0:'2026-10-12',dayTime_0:'11:30',dayPrincipal_0:'t1',dayDate_1:'2026-10-14',dayTime_1:'14:00',dayPrincipal_1:'t1'};
function fixture(){const m=confirmedTestSchedules(new DemoModel({now:()=> '2026-10-08T03:00:00.000Z'}));ensureCustomerBooking(m);return m;}
class Data{constructor(f){this.data=f.data;}*[Symbol.iterator](){yield*Object.entries(this.data);}*keys(){yield*Object.keys(this.data);}get(k){return this.data[k];}getAll(k){return this.data[k]===undefined?[]:[this.data[k]];}}
function runtime(role,{fail=false,data=input}={}){
 const model=fixture(),f={dataset:{form:'multi-day-booking',step:'2'},data:{...data},isConnected:true,reportValidity:()=>true,querySelector:()=>null,querySelectorAll:()=>[]},network={checked:fail};
 const scope={model,role,TODAY:model.today,FormData:Data,document:{addEventListener:(n,fn)=>{if(n==='submit')scope.submit=fn;}},dialogContext:{key:'multi',requestId:'multi-form',evidencePhotos:[]},drafts:new Map(),$:(s)=>s==='#network-toggle'?network:null,sheet:{open:true},setTimeout:fn=>{fn();return 1;},saveDraft(){scope.savedDraft={...f.data};},advanceMultiDayBookingForm:()=>true,multiDayBookingItems:ui.multiDayBookingItems,saveMultiDayBooking,render(){},showSuccess(title,html){scope.success={title,html};},multiDayResultSummary:ui.multiDayResultSummary,formError:(f,msg)=>{scope.error=msg;},ctx:()=>({model,role,esc:String}),customerCtx:()=>({model,role}),esc:v=>String(v??''),name:(k,id)=>model.state[k]?.find(r=>r.id===id)?.name||'待安排',money:v=>String(v),date:v=>v,button:()=>'',toast(){},closeDialog(){}};
 for(const n of ['updateEvidencePicker','updateReceptionIntakeChoices','updatePaperIntakeForm','updateScheduleForm','updateAppointmentAvailability','updateWorkflowForm','updateMultiDayBookingForm'])scope[n]=()=>{};
 const start=source.indexOf("document.addEventListener('submit', async event =>"),end=source.indexOf('\nfunction exportPreview',start);vm.runInNewContext(source.slice(start,end),scope);
 return {model,f,scope,run:()=>scope.submit({target:f,preventDefault(){}})};
}

test('multi-day dialog is a two-step per-day form with fixed customer, store scope and no recurrence assumptions',()=>{
 assert.equal(typeof ui.multiDayBookingDialog,'function');
 for(const role of [{type:'customer',id:'c1'},{type:'frontdesk',id:'f1'},{type:'therapist',id:'t1'}]){const dialog=ui.multiDayBookingDialog('c1',{model:fixture(),role,filters:{},esc:String});const html=dialog.html;assert.match(dialog.title,/一次约多天/);assert.match(html,/data-form="multi-day-booking"/);assert.match(html,/data-multi-day-row/g);assert.match(html,/data-multi-step="2"/);assert.match(html,/再加一天/);assert.match(html,/14/);assert.match(html,/不扣|未扣/);if(role.type==='manager')assert.doesNotMatch(html,/<option value="b"|<option value="c2"/);}
});

test('form-data parser preserves independent dates, times and staff in rendered order',()=>{assert.equal(typeof ui.multiDayBookingItems,'function');assert.deepEqual(ui.multiDayBookingItems(new Data({data:input})),[{date:'2026-10-12',time:'11:30',principalId:'t1'},{date:'2026-10-14',time:'14:00',principalId:'t1'}]);});

test('actual app submit creates two pending customer requests or two front/boss confirmed appointments once',async()=>{
 for(const role of [{type:'customer',id:'c1'},{type:'frontdesk',id:'f1'},{type:'therapist',id:'t1'}]){const r=runtime(role),before=r.model.state.appointments.length;await r.run();await r.run();assert.equal(r.scope.error,undefined);assert.equal(r.f.dataset.succeeded,'true');assert.match(r.scope.success?.title||'',/2/);if(role.type==='customer'){assert.equal(r.model.state.bookingRequests.length,2);assert.equal(r.model.state.appointments.length,before);}else assert.equal(r.model.state.appointments.length,before+2);}
});

test('actual app simulated failure keeps the full draft and allows retry without partial saves',async()=>{
 const r=runtime({type:'frontdesk',id:'f1'},{fail:true}),before=JSON.stringify([r.model.state,r.model.sequence]);await r.run();assert.equal(JSON.stringify([r.model.state,r.model.sequence]),before);assert.match(r.scope.error||'',/未保存|未提交/);assert.deepEqual(r.scope.savedDraft,input);assert.equal(r.f.dataset.busy,'false');await r.run();assert.equal(r.scope.success?.title,'2 天预约已确认');
});

test('actual app batch submits retain manager rejection for foreign store and existing appointment IDs',async()=>{
 for(const data of [{...input,storeId:'b'},{...input,id:'a3'}]){const r=runtime({type:'manager',id:'m1'},{data}),before=JSON.stringify([r.model.state,r.model.sequence]);await r.run();assert.match(r.scope.error||'',/本店|权限|新建|已有/);assert.equal(JSON.stringify([r.model.state,r.model.sequence]),before);}
});

test('actual app final-day conflict keeps every field and saves none of the preceding days',async()=>{
 const r=runtime({type:'frontdesk',id:'f1'});r.model.saveAppointment({clientId:'c3',storeId:'a',date:'2026-10-14',time:'14:30',principalId:'t1',project:'冲突'}, {type:'boss',id:'boss'});const before=JSON.stringify([r.model.state,r.model.sequence]);await r.run();assert.match(r.scope.error||'',/第\s*2\s*天[\s\S]*未保存/);assert.equal(JSON.stringify([r.model.state,r.model.sequence]),before);assert.deepEqual(r.scope.savedDraft,input);
});

function nativeSelect(markup=''){
 let options=[],value='';const select={disabled:false,required:true,name:'',setAttribute(){},focus(){},checkValidity(){return Boolean(value);},reportValidity(){return this.checkValidity();},get options(){return options;},get value(){return value;},set value(next){value=options.some(option=>option.value===String(next))?String(next):'';},get innerHTML(){return markup;},set innerHTML(html){markup=html;options=[...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([,attrs,label])=>({value:/\bvalue="([^"]*)"/.exec(attrs)?.[1]||'',disabled:/\bdisabled\b/.test(attrs),selected:/\bselected\b/.test(attrs),textContent:label}));value=(options.find(option=>option.selected)||options[0])?.value||'';}};select.innerHTML=markup;return select;
}
function boundary(items,clientId='c1',storeId='a'){
 const rows=items.map(item=>{const date={value:item.date,name:'',setAttribute(){},focus(){},checkValidity(){return Boolean(this.value);},reportValidity(){return this.checkValidity();}},principal=nativeSelect(`<option value="${item.principalId}" selected>${item.principalId}</option>`),time=nativeSelect(`<option value="${item.time}" selected>${item.time}</option>`),heading={},note={},remove={};const row={dataset:{},querySelector:selector=>({'[data-multi-date]':date,'[data-multi-principal]':principal,'[data-multi-time]':time,h3:heading,'[data-multi-availability]':note,'[data-action="multi-day-remove"]':remove}[selector])};return {row,date,principal,time,note,remove};});
 const submit={},back={},add={},summary={},error={hidden:true},panels=[1,2].map(index=>({dataset:{multiStep:String(index)},querySelectorAll:()=>[...rows.flatMap(row=>[row.date,row.principal,row.time])],querySelector:()=>({focus(){}})}));
 const form={dataset:{form:'multi-day-booking',step:'1'},elements:{clientId:{value:clientId},storeId:nativeSelect(`<option value="${storeId}" selected>${storeId}</option>`),project:{value:'康复服务'}},querySelectorAll:selector=>selector==='[data-multi-day-row]'?rows.map(row=>row.row):selector==='[data-multi-step]'?panels:[],querySelector:selector=>({'[type="submit"]':submit,'[data-action="multi-day-back"]':back,'[data-action="multi-day-add"]':add,'[data-multi-summary]':summary,'.form-error':error,'[data-multi-step="1"]':panels[0],'[data-multi-step="2"]':panels[1]}[selector])};return {form,rows,submit,summary,panels,error};
}
test('each date menu independently excludes confirmed overlaps and keeps full dates and weekdays in review',()=>{
 const model=fixture();model.saveAppointment({clientId:'c3',storeId:'a',project:'占用',date:'2026-10-14',time:'14:00',principalId:'t1'},{type:'boss',id:'boss'});
 const b=boundary([{date:'2026-10-12',time:'11:30',principalId:'t1'},{date:'2026-10-14',time:'14:00',principalId:'t1'}]);ui.updateMultiDayBookingForm(b.form,{model,role:{type:'customer',id:'c1'},esc:String});
 assert.equal(b.rows[0].time.value,'11:30');assert.equal(b.rows[1].time.value,'');for(const time of ['13:30','14:00','14:30'])assert.ok(!b.rows[1].time.options.some(option=>option.value===time));assert.match(b.rows[1].note.innerHTML,/重新选择/);assert.equal(b.submit.disabled,true);
 b.rows[1].time.value='15:00';ui.updateMultiDayBookingForm(b.form,{model,role:{type:'customer',id:'c1'},esc:String});assert.equal(b.submit.disabled,false);assert.match(b.summary.innerHTML,/2026年10月12日星期一/);assert.match(b.summary.innerHTML,/2026年10月14日星期三/);assert.match(b.summary.innerHTML,/11:30/);assert.match(b.summary.innerHTML,/15:00/);
});

test('repeated dates and rest or unassigned days cannot advance the multi-day form',()=>{
 for(const second of ['2026-10-12','2026-11-22']){const model=fixture(),b=boundary([{date:'2026-10-12',time:'11:30',principalId:'t1'},{date:second,time:'14:00',principalId:'t1'}]);ui.updateMultiDayBookingForm(b.form,{model,role:{type:'customer',id:'c1'},esc:String});assert.equal(b.submit.disabled,true);assert.equal(b.rows[1].time.value,'');assert.equal(ui.advanceMultiDayBookingForm(b.form,{model,role:{type:'customer',id:'c1'},esc:String}),false);assert.match(b.error.textContent,/第\s*[12]\s*天[\s\S]*未保存/);}
 const model=fixture(),shift=model.state.staffSchedules.find(row=>row.therapistId==='t1'&&row.date==='2026-10-14');Object.assign(shift,{status:'rest',startTime:'',endTime:''});const b=boundary([{date:'2026-10-12',time:'11:30',principalId:'t1'},{date:'2026-10-14',time:'14:00',principalId:'t1'}]);ui.updateMultiDayBookingForm(b.form,{model,role:{type:'customer',id:'c1'},esc:String});assert.equal(b.rows[1].time.options.filter(option=>option.value).length,0);assert.match(b.rows[1].note.innerHTML,/休息/);assert.equal(b.submit.disabled,true);
});

test('manager cannot open or restore a multi-day booking even with local visiting shifts',()=>{
 const model=fixture(),role={type:'manager',id:'m1'},ctx={model,role,esc:String},b=boundary([{date:'2026-10-12',time:'11:30',principalId:'t1'},{date:'2026-10-14',time:'14:00',principalId:'t2'}]);assert.throws(()=>ui.multiDayBookingDialog('c1',ctx),/只读|监管/);assert.throws(()=>ui.updateMultiDayBookingForm(b.form,ctx),/只读|监管/);
});
