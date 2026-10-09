import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel, ensureStorePackageExamples } from './core.js';
import * as reception from './reception.js';
import { workSummary, renderStaff, staffDialog } from './staff.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const front = {type:'frontdesk',id:'f1'};
const fixture = () => {const m=new DemoModel();ensureStorePackageExamples(m);return m;};
const context = (model,role=front,view='reception',filters={storeId:'a'})=>({model,role,view,filters,esc,icon:()=>'',fmt:{money:n=>`¥${n}`}});
const dialog = (m,type,id,role=front)=>{
  assert.equal(typeof reception.receptionIntakeDialog,'function','前台需要真正可打开的接待建档窗口');
  return reception.receptionIntakeDialog(type,id,context(m,role));
};

test('front desk home leads with new customer intake before scheduling and cash, and customer list also provides it',()=>{
  const m=fixture();
  for(const view of ['reception','reception-clients']){
    const html=reception.renderReception(context(m,front,view));
    assert.match(html,/data-action="reception-create-client"/);
    assert.match(html,/接待新客户/);
    if(html.includes('data-action="record-receipt"'))assert.ok(html.indexOf('data-action="reception-create-client"')<html.indexOf('data-action="record-receipt"'));
  }
});

test('new intake window asks plain basic information and an eligible store owner, without package or assessment fields',()=>{
  const html=dialog(fixture(),'reception-create-client','a').html;
  for(const key of ['name','age','problem','phone','storeId','ownerId'])assert.match(html,new RegExp(`name="${key}"`));
  assert.match(html,/客户姓名/);assert.match(html,/年龄/);assert.match(html,/主要问题/);
  assert.match(html,/检查已有档案/);assert.match(html,/保存档案，下一步预约/);
  assert.ok(!/name="(?:amount|total|remaining|score|metricName)"/.test(html));
  assert.ok(!/value="b"/.test(html),'麦岛前台不应选择未授权崂山店');
  assert.ok(!/value="t2"|value="t4"/.test(html),'首任负责人仅本店在职康复师');
});

test('intake window fails closed for unauthorized or inactive actors and stores',()=>{
  const m=fixture();
  for(const role of [{type:'customer',id:'c1'},{type:'therapist',id:'fake'},{type:'manager',id:'fake'},{type:'boss',id:'fake'}])assert.throws(()=>dialog(m,'reception-create-client','a',role));
  assert.throws(()=>dialog(m,'reception-create-client','b'));
  m.state.frontDesks.find(f=>f.id==='f1').active=false;
  assert.throws(()=>dialog(m,'reception-create-client','a'));
});

test('a freshly created client can be reopened with age and original problem, with next step booking and no fake package',()=>{
  const m=fixture();
  assert.equal(typeof m.createReceptionClient,'function');
  const c=m.createReceptionClient({name:'测试接待客户',age:'35',problem:'客户自述运动后肩部不适',phone:'13899091111',storeId:'a',ownerId:'t1',requestId:'new-ui'},front);
  const html=dialog(m,'reception-client',c.id).html;
  assert.match(html,/测试接待客户/);assert.match(html,/35/);assert.match(html,/客户自述运动后肩部不适/);
  assert.match(html,/尚未办理本店套餐/);assert.match(html,new RegExp(`data-action="appointment-create" data-id="${c.id}"`));
  assert.ok(!/data-action="(?:renew-package|create-store-package|edit-plan|register|review)"/.test(html));
  assert.throws(()=>dialog(m,'reception-client','c2'),'不能打开未授权外店客户接待档案');
});

test('owner choices follow selected authorized store, clear stale choice and prevent creation when no owner is available',()=>{
  const m=fixture();m.state.frontDesks.find(f=>f.id==='f1').storeIds=['a','b'];
  assert.equal(typeof reception.updateReceptionIntakeChoices,'function');
  const owner={value:'t1',innerHTML:'',disabled:false},submit={disabled:false},hint={textContent:''};
  const form={dataset:{form:'reception-create-client'},elements:{storeId:{value:'b'},ownerId:owner},querySelector:s=>s==='[type="submit"]'?submit:s==='[data-intake-owner-help]'?hint:null};
  reception.updateReceptionIntakeChoices(form,context(m));
  assert.equal(owner.value,'');assert.match(owner.innerHTML,/value="t2"/);assert.ok(!owner.innerHTML.includes('value="t1"'));
  assert.equal(submit.disabled,true);
  owner.value='t2';reception.updateReceptionIntakeChoices(form,context(m));assert.equal(submit.disabled,false);
  m.state.therapists.filter(t=>t.storeId==='b').forEach(t=>{t.active=false;});
  reception.updateReceptionIntakeChoices(form,context(m));assert.equal(owner.value,'');assert.equal(submit.disabled,true);assert.match(hint.textContent,/老板/);
});

test('an unplanned new customer is followed up as not yet enrolled instead of an exhausted package',()=>{
  const m=fixture(),c=m.createReceptionClient({name:'新接待未办卡',age:'29',problem:'希望了解运动康复',phone:'13899091112',storeId:'a',ownerId:'t1',requestId:'new-unenrolled'},front);
  const therapist={type:'therapist',id:'t1'},row=workSummary(m,therapist).followups.find(r=>r.client.id===c.id);
  assert.ok(row);assert.equal(row.low,false,'无套餐不能归为低次数/已耗尽');
  const html=renderStaff(context(m,therapist,'work'));
  assert.match(html,/尚未办理本店套餐/);
});

test('a first evaluation appointment for a customer without a package explains enrollment without allowing deduction',()=>{
  const m=fixture(),c=m.createReceptionClient({name:'首次评估未办卡',age:'29',problem:'客户自述想恢复运动',phone:'13899091113',storeId:'a',ownerId:'t1',requestId:'new-unenrolled-appointment'},front);
  m.saveAppointment({clientId:c.id,storeId:'a',principalId:'t1',date:m.today,time:'17:30',project:'首次评估'},front);
  const html=renderStaff(context(m,{type:'therapist',id:'t1'},'work'));
  assert.match(html,/尚未办理本店套餐，服务费用请先与门店核对/);
});

test('booking directly from new intake keeps the client and store and defaults to the first assessment',()=>{
  const m=fixture(),c=m.createReceptionClient({name:'第一次接待',age:32,problem:'希望先评估',phone:'13899091114',storeId:'a',ownerId:'t1',requestId:'new-appointment-form'},front);
  const html=staffDialog('appointment-create',c.id,context(m)).html;
  assert.match(html,new RegExp(`value="${c.id}" selected`));
  assert.match(html,/name="project"[^>]*value="首次评估"/);
  const saved=m.saveAppointment({clientId:c.id,storeId:'a',principalId:'t1',date:m.today,time:'17:30',project:'用户自选项目'},front);
  const edited=staffDialog('appointment-edit',saved.id,context(m)).html;
  assert.match(edited,/name="project"[^>]*value="用户自选项目"/,'编辑已有预约不能覆盖原项目');
});

test('duplicate lookup renders existing authorized intake entry without exposing private details or unassigned store identities',()=>{
  const m=fixture();
  assert.equal(typeof reception.receptionDuplicateMarkup,'function');
  const visible=m.findReceptionDuplicates(m.state.clients.find(c=>c.id==='c1').phone,front);
  const html=reception.receptionDuplicateMarkup(visible,context(m));
  assert.match(html,/已找到客户/);assert.match(html,/data-action="reception-client" data-id="c1"/);
  const hidden=m.findReceptionDuplicates(m.state.clients.find(c=>c.id==='c2').phone,front);
  const hiddenHtml=reception.receptionDuplicateMarkup(hidden,context(m));
  assert.match(hiddenHtml,/联系老板/);assert.ok(!hiddenHtml.includes('许安然')&&!hiddenHtml.includes('c2'));
});

// A native select drops an assigned value when its option is absent. Model that
// behavior here so a draft owner cannot survive merely because this is a stub.
function selectWithOptions(values,initial=values[0]||'') {
  let options=[...values],value=options.includes(initial)?initial:'';
  return {
    disabled:false,
    get value(){return value;},
    set value(next){value=options.includes(String(next))?String(next):'';},
    get innerHTML(){return options.map(id=>`<option value="${id}">${id}</option>`).join('');},
    set innerHTML(html){options=[...html.matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map(match=>match[1]);value=options[0]||'';},
  };
}
function intakeDraftForm(model,dataset={}) {
  const submit={disabled:true},hint={textContent:''};
  return {
    dataset:{form:'reception-create-client',...dataset},
    elements:{storeId:selectWithOptions(['a','b'],'a'),ownerId:selectWithOptions(['',...model.state.therapists.filter(t=>t.storeId==='a'&&t.active!==false).map(t=>t.id)]),phone:{value:'13912345678'},name:{value:'草稿客户'},age:{value:'32'},problem:{value:'运动后不适'}},
    querySelector:selector=>selector==='[type="submit"]'?submit:selector==='[data-intake-owner-help]'?hint:null,
  };
}
const intakeSavedDraft=(storeId='b',ownerId='t2')=>({entries:[['storeId',storeId],['ownerId',ownerId],['phone','13912345678'],['name','草稿客户'],['age','32'],['problem','运动后不适']]});
function genericIntakeRestore(form,saved) {
  for(const [key,value] of saved.entries)form.elements[key].value=value;
}

test('an intake draft restores a second-store owner after native select restoration has dropped the saved value',()=>{
  const m=fixture();m.state.frontDesks.find(f=>f.id==='f1').storeIds=['a','b'];
  const form=intakeDraftForm(m),saved=intakeSavedDraft();genericIntakeRestore(form,saved);
  assert.equal(form.elements.storeId.value,'b');assert.equal(form.elements.ownerId.value,'','generic restore loses the B-store owner while only A-store options exist');
  assert.equal(typeof reception.restoreReceptionIntakeDraft,'function');
  reception.restoreReceptionIntakeDraft(form,saved,context(m));
  assert.equal(form.elements.storeId.value,'b');assert.equal(form.elements.ownerId.value,'t2');
  assert.equal(form.querySelector('[type="submit"]').disabled,false);
  for(const [key,value] of saved.entries.filter(([key])=>!['storeId','ownerId'].includes(key)))assert.equal(form.elements[key].value,value,'basic intake values remain intact');
});

test('intake draft restoration refuses a revoked store, stopped owner or owner from another store without silently replacing them',()=>{
  assert.equal(typeof reception.restoreReceptionIntakeDraft,'function');
  for(const invalid of ['unauthorized-store','inactive-store','inactive-owner','other-store-owner']) {
    const m=fixture();m.state.frontDesks.find(f=>f.id==='f1').storeIds=invalid==='unauthorized-store'?['a']:['a','b'];
    if(invalid==='inactive-store')m.state.stores.find(s=>s.id==='b').active=false;
    if(invalid==='inactive-owner')m.state.therapists.find(t=>t.id==='t2').active=false;
    const form=intakeDraftForm(m),saved=intakeSavedDraft('b',invalid==='other-store-owner'?'t1':'t2');genericIntakeRestore(form,saved);
    reception.restoreReceptionIntakeDraft(form,saved,context(m));
    assert.equal(form.elements.ownerId.value,'',`${invalid} must require a fresh legal owner choice`);
    if(invalid.endsWith('-store'))assert.equal(form.elements.storeId.value,'','invalid saved store must not silently become the entry store');
    assert.equal(form.querySelector('[type="submit"]').disabled,true);
  }
});

test('restoring a valid intake draft never unlocks an in-flight or known duplicate submission',()=>{
  const m=fixture();m.state.frontDesks.find(f=>f.id==='f1').storeIds=['a','b'];
  assert.equal(typeof reception.restoreReceptionIntakeDraft,'function');
  for(const locked of [{busy:'true'},{duplicate:'true'}]) {
    const form=intakeDraftForm(m,locked),saved=intakeSavedDraft();genericIntakeRestore(form,saved);
    reception.restoreReceptionIntakeDraft(form,saved,context(m));
    assert.equal(form.elements.ownerId.value,'t2');assert.equal(form.querySelector('[type="submit"]').disabled,true);
  }
});
