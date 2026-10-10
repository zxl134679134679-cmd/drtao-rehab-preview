import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import * as staff from './staff.js';

const boss={type:'boss',id:'boss'},therapist={type:'therapist',id:'t2'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context=(model,role=boss,view='work',filters={})=>({model,role,view,filters,esc,icon:()=>''});
function fixture({exhaustB=false,multipleB=false,legacy=false}={}) {
  const state=structuredClone(new DemoModel().state);
  const b=state.packages.find(row=>row.id==='p2');
  b.storeId='b';b.name='崂山独立套餐';b.openingUsed=exhaustB?10:0;
  state.packages.push({id:'pa200',clientId:'c2',storeId:'a',name:'麦岛独立套餐',amount:600,amountMinor:60000,total:3,openingUsed:0,status:'historical'});
  if(multipleB)state.packages.push({id:'pb201',clientId:'c2',storeId:'b',name:'崂山第二套餐',amount:500,amountMinor:50000,total:2,openingUsed:0,status:'historical'});
  if(legacy)delete b.storeId;
  return new DemoModel({state,today:'2026-10-08',now:()=> '2026-10-09T04:00:00.000Z'});
}
function selectHtml(html,name) {
  return new RegExp(`<select\\b[^>]*name="${name}"[^>]*>[\\s\\S]*?<\\/select>`).exec(html)?.[0]||'';
}
function selectedValue(html,name) {
  const fragment=selectHtml(html,name),match=/<option[^>]*value="([^"]*)"[^>]*selected/.exec(fragment);
  return match?.[1]??'';
}
function update(form,ctx) {
  assert.equal(typeof staff.updateServicePackageChoices,'function','缺少按客户与门店更新套餐入口');
  staff.updateServicePackageChoices(form,ctx);
}
// The DOM boundary only stores fields and rendered markup. All customer/store
// eligibility, package counts and next-service values use the real DemoModel.
function formBoundary(type,clientId,storeId,packageId='') {
  const select={value:packageId,innerHTML:'',disabled:false},hint={innerHTML:''},submit={disabled:false};
  const form={dataset:{form:type},elements:{clientId:{value:clientId},storeId:{value:storeId},packageId:select,previousPackageId:select},
    querySelector(selector){return selector==='[type="submit"]'?submit:selector==='[data-service-package-hint]'||selector==='[data-renew-package-hint]'?hint:null;}};
  return {form,select,hint,submit};
}

test('service registration offers only the chosen store package and clearly identifies the one-session deduction',()=>{
  const m=fixture(),html=staff.staffDialog('register','c2',context(m)).html;
  const options=selectHtml(html,'packageId');
  assert.ok(options,'必须明确本次扣哪个套餐');assert.match(options,/p2/);assert.ok(!options.includes('pa200'));
  assert.match(html,/本次扣哪个套餐/);assert.match(html,/崂山店/);assert.match(html,/本次扣 ?1 ?次/);assert.match(html,/单次消费业绩/);
  assert.equal(selectedValue(html,'packageId'),'p2');
});

test('an appointment consumes only packages belonging to its actual service store',()=>{
  const m=fixture();
  const html=staff.staffDialog('register-appointment','a2',context(m,therapist)).html;
  assert.match(html,/name="appointmentId" value="a2"/);
  assert.match(html,/name="storeId" value="b"/);
  const options=selectHtml(html,'packageId');assert.ok(options.includes('p2'));assert.ok(!options.includes('pa200'));
});

test('an exhausted service-store card cannot borrow the other store balance or enable direct registration',()=>{
  const m=fixture({exhaustB:true}),html=staff.staffDialog('register-appointment','a2',context(m)).html;
  assert.match(html,/本店.*无.*套餐|本店.*没有.*套餐/);
  assert.ok(!selectHtml(html,'packageId').includes('pa200'));
  assert.ok(!/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>/.test(html));
});

test('more than one eligible card requires an explicit choice and never silently selects the first package',()=>{
  const m=fixture({multipleB:true}),html=staff.staffDialog('register','c2',context(m)).html;
  const options=selectHtml(html,'packageId');assert.ok(options.includes('p2'));assert.ok(options.includes('pb201'));
  assert.equal(selectedValue(html,'packageId'),'');
  assert.match(html,/请选择.*套餐/);
});

test('changing service stores clears the previous store card and refreshes its real balance and next-service value',()=>{
  const m=fixture(),boundary=formBoundary('register','c2','b','p2');
  update(boundary.form,context(m));assert.equal(boundary.select.value,'p2');assert.match(boundary.hint.innerHTML,/崂山店/);
  boundary.form.elements.storeId.value='a';update(boundary.form,context(m));
  assert.equal(boundary.select.value,'pa200');assert.ok(!boundary.select.innerHTML.includes('value="p2"'));
  assert.match(boundary.hint.innerHTML,/麦岛店/);assert.match(boundary.hint.innerHTML,/3 次/);assert.match(boundary.hint.innerHTML,/200/);
  assert.equal(boundary.submit.disabled,false);
  boundary.form.elements.clientId.value='c6';update(boundary.form,context(m));
  assert.equal(boundary.select.value,'');assert.equal(boundary.submit.disabled,true);assert.match(boundary.hint.innerHTML,/本店/);
});

test('a stale foreign card cannot survive refresh, but an explicit valid card remains selected when multiple cards exist',()=>{
  const m=fixture({multipleB:true}),boundary=formBoundary('register','c2','b','pa200');
  update(boundary.form,context(m));assert.equal(boundary.select.value,'');assert.equal(boundary.submit.disabled,true);
  boundary.select.value='pb201';update(boundary.form,context(m));
  assert.equal(boundary.select.value,'pb201');assert.equal(boundary.submit.disabled,false);assert.match(boundary.hint.innerHTML,/2 次/);
});

test('an unbound legacy package is visibly marked for verification instead of falsely naming it a store card',()=>{
  const m=fixture({legacy:true}),html=staff.staffDialog('register','c2',context(m)).html;
  assert.match(selectHtml(html,'packageId'),/旧套餐.*使用范围待核对/);
});

test('renewal allows the exhausted store card even when the customer has unused sessions at the other store',()=>{
  const m=fixture({exhaustB:true}),html=staff.staffDialog('renew-package','c2',context(m)).html;
  assert.ok(selectHtml(html,'storeId'));assert.ok(selectHtml(html,'previousPackageId'));
  assert.match(selectHtml(html,'previousPackageId'),/p2/);assert.ok(!selectHtml(html,'previousPackageId').includes('pa200'));
  assert.match(html,/本店|所选门店/);assert.match(html,/不收款/);
  const boundary=formBoundary('renew-package','c2','b','p2');update(boundary.form,context(m));
  assert.equal(boundary.select.value,'p2');assert.equal(boundary.submit.disabled,false);
  boundary.form.elements.storeId.value='a';update(boundary.form,context(m));
  assert.equal(boundary.select.value,'');assert.equal(boundary.submit.disabled,true);
  assert.match(boundary.hint.innerHTML,/已耗尽|已用完/);
});

test('work appointment and customer cards show the named store balance instead of combining cards from both stores',()=>{
  const m=fixture();
  const work=staff.renderStaff(context(m,therapist,'work'));
  assert.match(work,/崂山店.*剩余 10 次|剩余 10 次.*崂山店/);
  assert.ok(!work.includes('剩余 13 次'));
  const customers=staff.renderStaff(context(m,therapist,'clients'));
  assert.match(customers,/崂山店.*剩余 10 次|剩余 10 次.*崂山店/);
  const filtered=staff.renderStaff(context(m,boss,'clients',{storeId:'a'}));
  assert.ok(!filtered.includes('剩余 13 次'));
});

test('an appointment in the other store uses that service-store balance even when the current package points elsewhere',()=>{
  const m=fixture();m.state.appointments.find(a=>a.id==='a2').storeId='a';
  const work=staff.renderStaff(context(m,therapist,'work'));
  assert.match(work,/麦岛店.*剩余 3 次|剩余 3 次.*麦岛店/);
  const html=staff.staffDialog('register-appointment','a2',context(m,therapist)).html;
  assert.equal(selectedValue(html,'packageId'),'pa200');
  assert.ok(!selectHtml(html,'packageId').includes('p2'));
});

test('renewal can be opened by the exhausted package id and preserves its store instead of assuming the current client pointer',()=>{
  const m=fixture({exhaustB:true}),html=staff.staffDialog('renew-package','p2',context(m))?.html;
  assert.equal(typeof html,'string');assert.equal(selectedValue(html,'storeId'),'b');
  assert.equal(selectedValue(html,'previousPackageId'),'p2');assert.match(html,/name="clientId" value="c2"/);
});

test('package names and store names remain escaped in initial choices and dynamically refreshed hints',()=>{
  const m=fixture(),payload='<img src=x onerror="alert(1)">';
  m.state.packages.find(p=>p.id==='p2').name=payload;m.state.stores.find(s=>s.id==='b').name=payload;
  const html=staff.staffDialog('register','c2',context(m)).html;
  assert.ok(!html.includes(payload));assert.ok(html.includes('&lt;img'));
  const boundary=formBoundary('register','c2','b','p2');update(boundary.form,context(m));
  assert.ok(!boundary.hint.innerHTML.includes(payload));assert.ok(boundary.hint.innerHTML.includes('&lt;img'));
});

test('the actual package selected by an appointment form is consumed by the real model without touching the other store card',()=>{
  const m=fixture();m.state.appointments.find(a=>a.id==='a2').storeId='a';
  const html=staff.staffDialog('register-appointment','a2',context(m,boss)).html;
  const packageId=selectedValue(html,'packageId');assert.equal(packageId,'pa200');
  const result=m.registerService({appointmentId:'a2',clientId:'c2',storeId:'a',date:'2026-10-08',time:'11:30',
    project:'基础训练',principalId:'t2',participantIds:[],packageId,notes:'本次在麦岛店完成训练，使用麦岛店卡。',requestId:'ui-store-consumption',
    evidencePhotos:[{id:'ui-store-photo',name:'服务留底.png',width:1,height:1,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}]},boss);
  assert.equal(result.packageId,'pa200');assert.equal(result.amount,200);
  assert.equal(m.packageRemaining('pa200'),2);assert.equal(m.packageRemaining('p2'),10);
});

test('renewing the store and old card rendered by the form creates only that store package and preserves the other store balance',()=>{
  const m=fixture({exhaustB:true}),html=staff.staffDialog('renew-package','p2',context(m)).html;
  const storeId=selectedValue(html,'storeId'),previousPackageId=selectedValue(html,'previousPackageId');
  const next=m.renewPackage({clientId:'c2',storeId,previousPackageId,name:'崂山续费套餐',amount:25200,total:60,
    reason:'核对原套餐已用完，登记本店后续服务',requestId:'ui-store-renewal'},boss);
  assert.equal(next.storeId,'b');assert.equal(next.previousPackageId,'p2');assert.equal(m.packageRemaining(next.id),60);
  assert.equal(m.packageRemaining('pa200'),3);assert.equal(m.state.receipts.length,0);
});
