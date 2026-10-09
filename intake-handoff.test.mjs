import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';
import { PAPER_SAFETY_QUESTIONS, savePaperIntake, reviewPaperIntake, paperIntakeDialog } from './paper-intake.js';

const front={type:'frontdesk',id:'f1'},owner={type:'therapist',id:'t1'},boss={type:'boss',id:'boss'};
const fresh=()=>new DemoModel({today:'2026-10-09',now:()=> '2026-10-09T08:00:00.000Z'});
const input={clientId:'c3',storeId:'a',age:'32',problem:'跑步后右膝不适',goal:'恢复跑步',answers:Object.fromEntries(PAPER_SAFETY_QUESTIONS.map(q=>[q.key,'no'])),requestId:'handoff-create'};
const review={decision:'assessment',nextStep:'安排首次专业评估并联系客户',notes:'核对客户自述',assigneeId:'t1',dueDate:'2026-10-10',requestId:'handoff-review'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx=(model,role=owner)=>({model,role,esc,icon:()=>'',fmt:{date:value=>value,money:value=>value},filters:{storeId:'a'}});
const unchanged=(model,fn,pattern)=>{const before=structuredClone(model.state),sequence=model.sequence;assert.throws(fn,pattern);assert.deepEqual(model.state,before);assert.equal(model.sequence,sequence);};

test('a reviewed intake creates exactly one store-bound task with the selected person, date and source',()=>{
  const model=fresh(),row=savePaperIntake(model,input,front),before=structuredClone({clients:model.state.clients,packages:model.state.packages,services:model.state.services,receipts:model.state.receipts});
  const result=reviewPaperIntake(model,row.id,review,owner),tasks=model.state.tasks.filter(t=>t.paperIntakeId===row.id);
  assert.equal(tasks.length,1,'saving a next step must create executable work rather than only text');
  const task=tasks[0];assert.equal(task.type,'intake_followup');assert.equal(task.storeId,'a');assert.equal(task.clientId,'c3');assert.equal(task.assigneeId,'t1');assert.equal(task.dueDate,'2026-10-10');assert.equal(task.status,'pending');assert.equal(task.title,'安排首次专业评估并联系客户');assert.equal(result.review.taskId,task.id);
  assert.deepEqual({clients:model.state.clients,packages:model.state.packages,services:model.state.services,receipts:model.state.receipts},before);
  const snapshot=structuredClone(model.state);assert.equal(reviewPaperIntake(model,row.id,review,owner).review.taskId,task.id);assert.deepEqual(model.state,snapshot);
  unchanged(model,()=>reviewPaperIntake(model,row.id,{...review,dueDate:'2026-10-11'},owner),/同一|变化/);
});

test('explicit blank, missing counterpart, invalid dates, inactive and unauthorized assignees fail before changes',()=>{
  const model=fresh(),row=savePaperIntake(model,input,front);
  for(const changes of [{assigneeId:''},{dueDate:''},{dueDate:undefined},{assigneeId:undefined},{dueDate:'2026-02-30'},{dueDate:'2026-10-08'},{assigneeId:'t2'},{assigneeId:'missing'}])unchanged(model,()=>reviewPaperIntake(model,row.id,{...review,...changes},owner),/负责人|日期|授权|权限|康复师/);
  model.state.therapists.find(t=>t.id==='t1').active=false;
  unchanged(model,()=>reviewPaperIntake(model,row.id,review,owner),/在职|康复师/);
});

test('legacy review callers receive an explicit owner-and-today default and still create a task',()=>{
  const model=fresh(),row=savePaperIntake(model,input,front),{assigneeId,dueDate,...legacy}=review;
  const result=reviewPaperIntake(model,row.id,legacy,owner),task=model.state.tasks.find(t=>t.id===result.review.taskId);
  assert.ok(task);assert.equal(task.assigneeId,'t1');assert.equal(task.dueDate,'2026-10-09');assert.equal(result.review.assignmentDefaulted,true);
  const html=paperIntakeDialog('paper-intake-detail',row.id,ctx(model,boss)).html;assert.match(html,/默认|旧版/);assert.match(html,/林予安/);assert.match(html,/2026-10-09/);
});

test('new review form requires an authorized assignee and a date; store manager cannot obtain the form',()=>{
  const model=fresh(),row=savePaperIntake(model,input,front),html=paperIntakeDialog('paper-intake-review',row.id,ctx(model)).html;
  assert.match(html,/<select[^>]*name="assigneeId"[^>]*required/);assert.match(html,/<input[^>]*name="dueDate"[^>]*required/);assert.match(html,/value="t1"/);assert.doesNotMatch(html,/value="t2"/);
  assert.throws(()=>paperIntakeDialog('paper-intake-review',row.id,ctx(model,{type:'manager',id:'m1'})),/负责|复核|权限/);
});

test('loaded handoff references never reveal another client task result',()=>{
  const model=fresh(),row=savePaperIntake(model,input,front),result=reviewPaperIntake(model,row.id,review,owner);
  const task=model.state.tasks.find(t=>t.id===result.review.taskId);
  task.clientId='c2';task.status='completed';task.completionResult='另一客户的内部处理内容';
  const html=paperIntakeDialog('paper-intake-detail',row.id,ctx(model,front)).html;
  assert.doesNotMatch(html,/另一客户的内部处理内容/);assert.match(html,/待核对/);
});

test('a designated execution therapist reads only the authorized store intake and cannot professionally review it',()=>{
  const model=fresh(),executor={type:'therapist',id:'t4'};
  model.assignStoreTherapist({clientId:'c3',storeId:'b',therapistId:'t4',reason:'客户在崂山店继续服务'},boss);
  const local=savePaperIntake(model,{...input,storeId:'b'},boss),other=savePaperIntake(model,{...input,requestId:'another-store-intake'},front);
  const dialog=paperIntakeDialog('paper-intake-detail',local.id,ctx(model,executor));
  assert.match(dialog.title,/周沐/);assert.match(dialog.html,/崂山店/);
  assert.doesNotMatch(dialog.html,/data-action="paper-intake-create"|data-action="paper-intake-review"/);
  assert.throws(()=>paperIntakeDialog('paper-intake-detail',other.id,ctx(model,executor)),/权限/);
  unchanged(model,()=>reviewPaperIntake(model,local.id,{...review,assigneeId:'t4'},executor),/负责|复核/);
  const result=reviewPaperIntake(model,local.id,{...review,assigneeId:'t4'},owner);
  const task=model.state.tasks.find(t=>t.id===result.review.taskId);assert.equal(task.storeId,'b');assert.equal(task.assigneeId,'t4');
  model.completeTask(task.id,executor,{result:'已联系客户，安排本店评估'});
  assert.match(paperIntakeDialog('paper-intake-detail',local.id,ctx(model,executor)).html,/已联系客户，安排本店评估/);
  model.state.therapists.find(t=>t.id==='t4').active=false;
  assert.throws(()=>paperIntakeDialog('paper-intake-detail',local.id,ctx(model,executor)),/权限|在职|康复师/);
});

test('intake detail follows the current task assignment after the boss changes its person and deadline',()=>{
  const model=fresh(),row=savePaperIntake(model,input,front),result=reviewPaperIntake(model,row.id,review,owner);
  model.assignStoreTherapist({clientId:'c3',storeId:'a',therapistId:'t3',reason:'苏晴负责本次联系安排'},boss);
  model.updateTask(result.review.taskId,{assigneeId:'t3',dueDate:'2026-10-12',reason:'原负责人已有其他服务安排'},boss);
  const html=paperIntakeDialog('paper-intake-detail',row.id,ctx(model,front)).html;
  const handoff=/<div class="paper-intake-handoff">([\s\S]*?)<\/div>/.exec(html)?.[1]||'';
  const current=/<p[^>]*>[\s\S]*?<\/p>/.exec(handoff)?.[0]||'';
  assert.match(current,/苏晴/);assert.match(current,/2026-10-12/);
  assert.doesNotMatch(current,/林予安|2026-10-10/);
  assert.equal(model.state.paperIntakes.find(r=>r.id===row.id).review.assigneeId,'t1','the original review assignment remains an immutable historical record');
  model.updateTask(result.review.taskId,{assigneeId:'boss',dueDate:'2026-10-13',reason:'老板亲自跟进'},boss);
  const bossHandoff=/<div class="paper-intake-handoff">([\s\S]*?)<\/div>/.exec(paperIntakeDialog('paper-intake-detail',row.id,ctx(model,front)).html)?.[1]||'';
  assert.match(bossHandoff,/下一步负责人 老板/);assert.match(bossHandoff,/2026-10-13/);
});
