import {workflowTypes,workflowDialog} from './workflow-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel, ensureStorePackageExamples } from './legacy-test-fixture.mjs';
import { renderStaff, personnelDialog } from './staff.js';
import { renderManager, managerDialog } from './manager.js';
import * as reception from './reception.js';
import { scheduleDialog } from './schedules-ui.js';

const roles={boss:{type:'boss',id:'boss'},manager:{type:'manager',id:'m1'},frontdesk:{type:'frontdesk',id:'f1'},therapist:{type:'therapist',id:'t1'}};
const fixture=()=>{const m=new DemoModel();ensureStorePackageExamples(m);return m;};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx=(model,role,view='',filters={})=>({model,role,view,filters,esc,icon:()=>'',fmt:{money:n=>`¥${n}`,date:n=>n}});

test('boss and therapist retain intake entries while manager home and customer list are read-only',()=>{
  for(const [kind,views] of [['boss',['overview','clients']],['manager',['manager-overview','manager-clients']],['therapist',['work','clients']]]){
    for(const view of views){
      const context=ctx(fixture(),roles[kind],view);
      const html=kind==='manager'?renderManager(context):renderStaff(context);
      if(kind==='manager'){
        assert.doesNotMatch(html,/data-action="(?:reception-create-client|paper-intake-create)"/);
        assert.match(html,/监管查看/);
      } else {
        assert.match(html,/data-action="reception-create-client"/,`${kind}/${view} needs a visible intake entry`);
        assert.match(html,/新客户建档/);
      }
    }
  }
});

test('shared intake respects role stores and keeps assessment and treatment separate for every intake actor',()=>{
  const m=fixture();
  for(const kind of ['boss','frontdesk','therapist']){
    const html=reception.receptionIntakeDialog('reception-create-client','',ctx(m,roles[kind])).html;
    for(const key of ['name','age','phone'])assert.match(html,new RegExp(`name="${key}"`));
    assert.doesNotMatch(html,/name="problem"/);
    if(kind==='boss')assert.match(html,/value="b"/);
    else assert.ok(!html.includes('value="b"'));
    assert.doesNotMatch(html,/name="ownerId"|name="therapistId"/);assert.match(html,/涛博士/);assert.match(html,/预约时选择/);
  }
});

test('actual app dispatch refuses manager intake, existing appointment edits, assessments and cash writes',async()=>{
  const m=fixture(),role=roles.manager,source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const start=source.indexOf('function buildDialog('),end=source.indexOf('\nfunction draftKey(',start);
  assert.ok(start>=0&&end>start);
  const scope={workflowTypes,workflowDialog,role,model:m,customerBookingTypes:new Set(),receptionIntakeDialog:reception.receptionIntakeDialog,managerDialog,scheduleDialog, personnelDialog,ctx:()=>ctx(m,role)};
  vm.runInNewContext(source.slice(start,end)+'\nglobalThis.open=buildDialog;',scope);
  for(const type of ['reception-create-client','paper-intake-create','appointment-edit','appointment-cancel','assessment-create','record-receipt','reset'])assert.throws(()=>scope.open(type,'c1'),/店长|权限/);
});

test('manager can inspect frontdesk-created local clients without receiving intake or booking actions',()=>{
  const m=fixture(),role=roles.manager,c=m.createReceptionClient({name:'前台接待示例',phone:'13899092211',age:34,problem:'客户自述跑步后不适',storeId:'a',requestId:'manager-ui'},roles.frontdesk);
  assert.equal(typeof reception.receptionIntakeSuccess,'function');
  const result=reception.receptionIntakeSuccess(c,ctx(m,role));
  assert.match(result,/前台或负责康复师/);assert.match(result,/data-action="manager-client"/);
  assert.ok(!/data-action="(?:appointment-create|assessment-create|reception-create-client|paper-intake-create)"/.test(result));
  const basic=reception.receptionIntakeDialog('reception-client',c.id,ctx(m,role)).html;
  assert.ok(!/data-action="(?:appointment-create|assessment-create|assessment-history)"/.test(basic));
  const file=managerDialog('manager-client',c.id,ctx(m,role)).html;
  assert.match(file,/34 岁/);assert.match(file,/客户自述跑步后不适/);
  assert.match(renderManager(ctx(m,role,'manager-clients')),/尚未办理本店套餐/);
});

test('therapist intake uses fixed assessment and no treatment assignment',()=>{
 const m=fixture(),submit={},hint={},form={dataset:{form:'reception-create-client'},elements:{storeId:{value:'a'}},querySelector:s=>s==='[type="submit"]'?submit:hint};reception.updateReceptionIntakeChoices(form,ctx(m,roles.therapist));assert.equal(submit.disabled,false);assert.match(hint.textContent,/涛博士/);assert.match(hint.textContent,/预约/);
});
