import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel} from './legacy-test-fixture.mjs';
const flow=await import('./workflow-ui.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const boss={type:'boss',id:'boss'},ctx=(m,role=boss)=>({model:m,role});
test('a general task opens a result form for its assignee and never gives an unrelated therapist the task',()=>{
 const m=new DemoModel();m.state.tasks.push({id:'ui-task',clientId:'c3',storeId:'a',assigneeId:'t1',title:'联系客户安排评估',dueDate:m.today,status:'pending',type:'intake_followup'});
 const d=flow.workflowDialog?.('task-complete','ui-task',ctx(m,{type:'therapist',id:'t1'}));
 assert.ok(d?.html.includes('name="result"'),'完成待办必须记录实际处理结果');assert.match(d.html,/required/);
 assert.throws(()=>flow.workflowDialog?.('task-detail','ui-task',ctx(m,{type:'therapist',id:'t2'})),/权限|负责人/);
});
test('store execution assignment is a boss operation and does not offer inactive therapists',()=>{
 const m=new DemoModel();m.state.therapists.find(t=>t.id==='t5').active=false;
 const d=flow.workflowDialog?.('assign-store-therapist','c3',ctx(m));
 assert.ok(d?.html.includes('name="therapistId"'));assert.ok(d.html.includes('name="storeId"'));assert.ok(!d.html.includes('value="t5"'));
 assert.throws(()=>flow.workflowDialog?.('assign-store-therapist','c3',ctx(m,{type:'frontdesk',id:'f1'})),/老板|权限/);
});
test('single service success displays no package recovery and no duplicate income',()=>{
 const m=new DemoModel(),s={clientId:'c3',principalId:'t1',billingMode:'single',receiptId:'r-single',packageId:null,amount:400,evidencePhotos:[{}]};
 const html=flow.serviceResultSummary?.(s,ctx(m),'registered')||'';
 assert.match(html,/不扣套餐次数/);assert.match(html,/400/);assert.ok(!html.includes('原套餐剩余'));assert.match(html,/不会新增收款/);
 const revoked=flow.serviceResultSummary?.(s,ctx(m),'revoked')||'';
 assert.match(revoked,/业绩已冲回/);assert.match(revoked,/收款记录保留/);assert.ok(!revoked.includes('次数已恢复'));
});
test('client owner can supervise delegated intake work but cannot complete it for the assignee',()=>{
 const m=new DemoModel();m.state.tasks.push({id:'delegated-ui',clientId:'c3',storeId:'a',assigneeId:'t3',title:'安排阶段评估',dueDate:m.today,status:'pending',type:'intake_followup'});
 const c=ctx(m,{type:'therapist',id:'t1'}),d=flow.workflowDialog('task-detail','delegated-ui',c);
 assert.ok(d.html.includes('安排阶段评估'));assert.ok(!d.html.includes('data-action="task-complete"'));
 assert.throws(()=>flow.workflowDialog('task-complete','delegated-ui',c),/负责人|权限/);
});
