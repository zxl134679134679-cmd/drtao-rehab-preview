import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel} from './core.js';
import {staffDialog,updateServicePackageChoices,renderStaff} from './staff.js';
const boss={type:'boss',id:'boss'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx=m=>({model:m,role:boss,view:'work',filters:{},esc,icon:()=>''});
const select=(html,key)=>new RegExp(`<select\\b[^>]*name="${key}"[^>]*>[\\s\\S]*?<\\/select>`).exec(html)?.[0]||'';
function fixture(){
 const m=new DemoModel({now:()=> '2026-10-08T12:00:00.000Z'});
 const r=m.recordReceipt({clientId:'c3',storeId:'a',date:m.today,time:'09:00',purpose:'single',method:'wechat',amount:'400',requestId:'single-ui'},boss);
 return {m,r};
}
test('no-card registration offers an eligible paid single service without requiring a package',()=>{
 const {m,r}=fixture();m.state.packages=m.state.packages.filter(p=>p.clientId!=='c3');m.state.clients.find(c=>c.id==='c3').packageId='';
 const html=staffDialog('register','c3',ctx(m)).html;
 assert.ok(select(html,'billingMode').includes('value="single"'),'应该可明确选择单次服务');
 assert.ok(select(html,'receiptId').includes(r.id),'只提供已收款单次服务');
 assert.match(html,/不扣套餐次数/);
 assert.ok(!/<select[^>]*name="packageId"[^>]*required/.test(html),'单次服务不应要求套餐');
 assert.ok(!/<button[^>]*type="submit"[^>]*disabled/.test(html),'有效单次收款应允许登记');
});
test('single receipt choices do not include a different store or customer',()=>{
 const {m,r}=fixture();
 const other=m.recordReceipt({clientId:'c1',storeId:'a',date:m.today,time:'09:00',purpose:'single',method:'wechat',amount:'500',requestId:'other-ui'},boss);
 const html=staffDialog('register','c3',ctx(m)).html;
 assert.ok(select(html,'receiptId').includes(r.id));assert.ok(!select(html,'receiptId').includes(other.id));
});
test('designated store execution therapist can open registration only in their permitted store',()=>{
 const {m}=fixture();m.assignStoreTherapist({clientId:'c3',storeId:'b',therapistId:'t4',reason:'崂山执行'},boss);
 const role={type:'therapist',id:'t4'};
 const html=staffDialog('register','c3',{...ctx(m),role,view:'clients',filters:{storeId:'b'}}).html;
 assert.match(select(html,'storeId'),/value="b" selected/);
 assert.ok(!select(html,'storeId').includes('value="a"'),'档案可看但不应提供无执行权限的门店');
 assert.ok(!select(html,'receiptId').includes('¥400'),'不能引入麦岛店单次款');
 const appointment=staffDialog('appointment-create','c3',{...ctx(m),role,view:'clients',filters:{}}).html;
 assert.match(select(appointment,'storeId'),/value="b" selected/,'为外店档案预约时默认当前执行师所在店');
});
test('switching billing mode clears irrelevant requirements and explains single performance without new income',()=>{
 const {m,r}=fixture();const packageSelect={value:'p3',innerHTML:'',disabled:false,required:true},receiptSelect={value:r.id,innerHTML:'',disabled:false,required:false},mode={value:'single'},hint={innerHTML:''},submit={disabled:true,textContent:''};
 const blocks={package:{hidden:false},single:{hidden:true}};
 const form={dataset:{form:'register'},elements:{clientId:{value:'c3'},storeId:{value:'a'},billingMode:mode,packageId:packageSelect,receiptId:receiptSelect},querySelector(s){return s==='[type="submit"]'?submit:s==='[data-service-package-hint]'||s==='[data-service-billing-hint]'?hint:s==='[data-service-package-block]'?blocks.package:s==='[data-service-single-block]'?blocks.single:null;}};
 updateServicePackageChoices(form,ctx(m));
 assert.equal(packageSelect.disabled,true);assert.equal(packageSelect.required,false);assert.equal(receiptSelect.required,true);assert.equal(receiptSelect.value,r.id);assert.equal(submit.disabled,false);
 assert.match(hint.innerHTML,/不扣套餐次数/);assert.match(hint.innerHTML,/400/);
 mode.value='package';updateServicePackageChoices(form,ctx(m));assert.equal(packageSelect.disabled,false);assert.equal(packageSelect.required,true);assert.equal(receiptSelect.disabled,true);assert.equal(receiptSelect.required,false);
});

const therapist={type:'therapist',id:'t1'};
const workHtml=(m,role=therapist)=>renderStaff({...ctx(m),role});
const appointmentCard=(html,id)=>(html.match(/<article class="ease-service-card">[\s\S]*?<\/article>/g)||[]).find(card=>card.includes(`data-action="appointment" data-id="${id}"`))||'';
const photos=()=>[{id:'single-ui-photo',name:'留底.png',width:1,height:1,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}];

test('a paid single service can be registered directly from its appointment card without a card or after package exhaustion',()=>{
 for(const mode of ['no-card','exhausted']){
  const {m}=fixture();
  if(mode==='no-card'){m.state.packages=m.state.packages.filter(p=>p.clientId!=='c3');m.state.clients.find(c=>c.id==='c3').packageId='';}
  else m.state.packages.filter(p=>p.clientId==='c3').forEach(p=>p.openingUsed=p.total);
  assert.equal(m.remainingInStore('c3','a'),0);
  const card=appointmentCard(workHtml(m),'a3');assert.ok(card);
  assert.match(card,/data-action="register-appointment" data-id="a3"/);
  assert.match(card,/单次.*已收款/);assert.match(card,/不扣套餐次数/);
 }
});

test('a paid single service under a reschedule request retains the original appointment registration entry',()=>{
 const {m}=fixture();m.state.packages=m.state.packages.filter(p=>p.clientId!=='c3');m.state.clients.find(c=>c.id==='c3').packageId='';
 const ap=m.state.appointments.find(a=>a.id==='a3');ap.status='reschedule_requested';ap.request={date:'2026-10-12',time:'14:30'};
 const card=appointmentCard(workHtml(m),'a3');assert.match(card,/确认改约/);
 assert.match(card,/<button[^>]*data-action="register-appointment" data-id="a3"[^>]*>按原预约登记<\/button>/);
});

test('out of store execution scope never crashes the work page or offers single registration; future and reassignment remain scheduling actions',()=>{
 const {m}=fixture();m.state.packages=m.state.packages.filter(p=>p.clientId!=='c3');m.state.clients.find(c=>c.id==='c3').packageId='';
 m.assignStoreTherapist({clientId:'c3',storeId:'b',therapistId:'t4',reason:'仅授权崂山执行'},boss);
 const ap=m.state.appointments.find(a=>a.id==='a3');ap.principalId='t4';
 const role={type:'therapist',id:'t4'};assert.throws(()=>m.availableSingleReceipts('c3','a',role),/门店|权限/);
 let card=appointmentCard(workHtml(m,role),'a3');assert.ok(card);assert.doesNotMatch(card,/data-action="register-appointment"/);
 ap.principalId='t1';ap.date='2026-10-12';card=appointmentCard(workHtml(m),'a3');assert.match(card,/调整安排/);assert.doesNotMatch(card,/data-action="register-appointment"/);
 ap.date=m.today;ap.status='pending_reassignment';card=appointmentCard(workHtml(m),'a3');assert.match(card,/重新安排/);assert.doesNotMatch(card,/data-action="register-appointment"/);
});

test('revoking a real single service promises performance reversal and retained payment without restoring package sessions',()=>{
 const {m,r}=fixture(),ap=m.state.appointments.find(a=>a.id==='a3'),remaining=m.remainingInStore('c3','a');
 const service=m.registerService({appointmentId:ap.id,clientId:'c3',storeId:'a',date:m.today,time:ap.time,principalId:'t1',participantIds:[],project:ap.project,notes:'评估完成',evidencePhotos:photos(),billingMode:'single',receiptId:r.id,requestId:'single-revoke-ui'},therapist);
 const html=staffDialog('revoke-service',service.id,ctx(m)).html;
 assert.match(html,/不.*套餐次数/);assert.match(html,/冲回.*400/);assert.match(html,/收款.*保留|保留.*收款/);assert.doesNotMatch(html,/恢复.*1 次|确认撤销并恢复次数/);
 m.revokeService(service.id,'撤销测试重复登记',boss);assert.equal(m.remainingInStore('c3','a'),remaining);assert.equal(m.state.receipts.find(row=>row.id===r.id).status,'valid');
 const packageHtml=staffDialog('revoke-service','s1',ctx(m)).html;assert.match(packageHtml,/恢复本笔服务所用套餐的 1 次/);
});
