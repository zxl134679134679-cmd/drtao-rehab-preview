import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel} from './legacy-test-fixture.mjs';
import {workflowDialog} from './workflow-ui.js';
test('a store manager can read explicit local intake handoff for a client whose main archive belongs to the other store',()=>{
 const m=new DemoModel();
 m.state.paperIntakes=[{id:'intake-b',clientId:'c3',storeId:'b',status:'reviewed'}];
 m.state.tasks.push({id:'handoff-b',clientId:'c3',storeId:'b',paperIntakeId:'intake-b',type:'intake_followup',assigneeId:'t4',dueDate:m.today,status:'pending',title:'安排崂山店首次评估'});
 const b=m.managerSnapshot({type:'manager',id:'m2'});
 assert.ok(b.clients.some(c=>c.id==='c3'));assert.ok(b.tasks.some(t=>t.id==='handoff-b'));
 assert.match(workflowDialog('task-detail','handoff-b',{model:m,role:{type:'manager',id:'m2'}}).html,/查看接待表/);
 assert.ok(!m.managerSnapshot({type:'manager',id:'m1'}).tasks.some(t=>t.id==='handoff-b'));
 assert.throws(()=>workflowDialog('task-complete','handoff-b',{model:m,role:{type:'manager',id:'m2'}}),/负责人|老板/);
});
