import {workflowTypes,workflowDialog} from './workflow-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel, ensureStorePackageExamples } from './core.js';
import { ensureEvaluations } from './evaluations.js';
import { ensurePaperIntakes, paperIntakeDialog } from './paper-intake.js';
import { renderReception, receptionIntakeSuccess } from './reception.js';
import { renderStaff, personnelDialog } from './staff.js';
import { renderManager, managerDialog } from './manager.js';
import { scheduleDialog } from './schedules-ui.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixture=()=>{const m=new DemoModel();ensureStorePackageExamples(m);ensureEvaluations(m);ensurePaperIntakes(m);return m;};
const ctx=(model,role,view)=>({model,role,view,filters:{},esc,icon:()=>'',fmt:{money:n=>`¥${n}`,date:n=>n}});

test('front desk evaluation page leads with paper reception workflow while professional measurements stay secondary',()=>{
  const m=fixture(),html=renderReception(ctx(m,{type:'frontdesk',id:'f1'},'reception-assessments'));
  assert.match(html,/data-form="paper-intake-select"/);
  assert.match(html,/填写本次接待表/);
  assert.match(html,/专业评估记录/);
  assert.ok(html.indexOf('paper-intake-select')<html.indexOf('专业评估记录'));
});

test('boss, manager and responsible therapist see concise paper review inbox on home',()=>{
  const m=fixture();
  for(const [role,view] of [[{type:'boss',id:'boss'},'overview'],[{type:'manager',id:'m1'},'manager-overview'],[{type:'therapist',id:'t1'},'work']]){
    const context=ctx(m,role,view),html=role.type==='manager'?renderManager(context):renderStaff(context);
    assert.match(html,/初访.*复核/);
    assert.match(html,/data-action="paper-intake-detail"/);
  }
});

test('successful basic intake offers the next paper form with the actual new client',()=>{
  const m=fixture(),role={type:'frontdesk',id:'f1'},client=m.createReceptionClient({name:'初访表入口示例',age:35,problem:'客户自述',phone:'13899094411',storeId:'a',ownerId:'t1',requestId:'paper-entry-test'},role);
  const html=receptionIntakeSuccess(client,ctx(m,role,'reception'));
  assert.match(html,new RegExp(`data-action="paper-intake-create" data-id="${client.id}"`));
});

test('actual application dispatch lets manager read local paper records but refuses creation, review and other-store reading',async()=>{
  const m=fixture(),source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const start=source.indexOf('function buildDialog('),end=source.indexOf('\nfunction draftKey(',start);
  const role={type:'manager',id:'m1'};
  const scope={workflowTypes,workflowDialog,model:m,role,customerBookingTypes:new Set(),paperIntakeDialog,managerDialog,scheduleDialog, personnelDialog,ctx:()=>ctx(m,role,'manager-overview')};
  vm.runInNewContext(source.slice(start,end)+'\nglobalThis.open=buildDialog;',scope);
  assert.match(scope.open('paper-intake-detail','paper-demo-a').html,/跑步后膝部/);
  assert.throws(()=>scope.open('paper-intake-detail','paper-demo-b'));
  assert.throws(()=>scope.open('paper-intake-create','c1'));
  assert.throws(()=>scope.open('paper-intake-create','c2'));
  assert.throws(()=>scope.open('paper-intake-review','missing'));
});
