import {workflowTypes,workflowDialog} from './workflow-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel } from './core.js';
import { customerBookingTypes, customerRequestDialog, renderRequestHistory } from './customer-ui.js';
import { ensureCustomerBooking } from './customer-booking.js';
import { hourTimeField } from './hour-picker.js';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const therapist=id=>({type:'therapist',id});
function originalFunction(name,next){const start=source.indexOf(`function ${name}(`),end=source.indexOf(next,start);assert.ok(start>=0&&end>start);return source.slice(start,end);}
function appReader(model,role){
 const scope={workflowTypes,workflowDialog,model,role,TODAY:model.today,view:'clients',filters:{},preferences:new Map(),customerBookingTypes,customerRequestDialog,renderRequestHistory,hourTimeField};
 const helperNames=['esc','find','name','icon','money','date','weekday','button','link','hidden','field','textarea','form','pair','ctx','customerCtx','clientServices','appointments','reviewFor','currentClient','canEditPlan'];
 const helpers=helperNames.map(name=>source.split('\n').find(line=>line.startsWith(`const ${name} = `)));
 const begin=source.indexOf('const evaluationTypes = '),end=source.indexOf('\nfunction draftKey(',begin);
 vm.runInNewContext([...helpers,originalFunction('assertClient','\nfunction assertBoss'),originalFunction('assertBoss','\nfunction assertStaff'),originalFunction('assertStaff','\nfunction assertService'),originalFunction('appointmentHistoryDialog','\nfunction serviceDialog'),originalFunction('appointmentDialog','\nfunction reviewDialog'),source.slice(begin,end),'globalThis.open=buildDialog;'].join('\n'),scope);return scope.open;
}
const fixture=()=>{const m=new DemoModel();ensureCustomerBooking(m);return m;};
test('real therapist appointment detail names client, service team, project, status and change request without customer-only controls',()=>{
 const m=fixture(),a=m.state.appointments.find(row=>row.id==='a1');
 a.participantIds=['t3'];a.status='reschedule_requested';a.requestNote='';a.request={date:'2026-10-12',time:'15:30',reason:'客户希望晚一些到店'};
 m.state.reviews.push({id:'private-review',serviceId:'s1',score:1,feedback:'老板专属评分反馈',followupStatus:'none'});
 const before=JSON.stringify(m.state),html=appReader(m,therapist('t2'))('appointment',a.id).html;
 for(const text of ['陈一诺','周亦宁','苏晴','崂山店',a.project,'改约','15:30','客户希望晚一些到店'])assert.ok(html.includes(text),text);
 assert.match(html,/客户预约|客户.*预约|预约详情/);assert.ok(html.includes('data-action="appointment-history"'));
 for(const action of ['reschedule','customer-booking-confirm','customer-booking-cancel','review'])assert.ok(!html.includes(`data-action="${action}"`),action);
 assert.ok(!html.includes('老板专属评分反馈'));assert.equal(JSON.stringify(m.state),before);
});
test('actual per-client booking history gives each appointment a direct detail entry and keeps collaborated clients readable',()=>{
 const m=fixture(),html=appReader(m,therapist('t2'))('appointment-history','c1').html;
 for(const a of m.state.appointments.filter(row=>row.clientId==='c1'))assert.ok(html.includes(`data-action="appointment" data-id="${a.id}"`),a.id);
 assert.ok(!html.includes('老板专属评分反馈'));
});
test('unrelated and inactive therapists cannot read request or confirmed appointment details through actual dispatch',()=>{
 for(const role of [therapist('t4'),therapist('missing')])for(const type of ['appointment','appointment-history'])assert.throws(()=>appReader(fixture(),role)(type,type==='appointment'?'a1':'c1'),/权限|客户/);
 const m=fixture();m.state.therapists.find(row=>row.id==='t2').active=false;
 for(const type of ['appointment','appointment-history'])assert.throws(()=>appReader(m,therapist('t2'))(type,type==='appointment'?'a1':'c1'),/权限|客户/);
});
test('ended therapist appointments retain their original service people and actual cancellation content',()=>{
 const m=fixture(),a=m.state.appointments.find(row=>row.id==='a1');a.status='cancelled';a.cancelReason='客户临时调整行程';a.participantIds=['t3'];
 const html=appReader(m,therapist('t1'))('appointment',a.id).html;
 for(const text of ['已取消','陈一诺','周亦宁','苏晴','客户临时调整行程'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('data-action="reschedule"'));
});
