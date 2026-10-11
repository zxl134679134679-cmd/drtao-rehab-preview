import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel} from './core.js';
import {currentTestWorkflow} from './operations-modern-test-fixture.mjs';
import {saveMultiDayBooking} from './multi-day-booking.js';
import {multiDayBookingDialog} from './multi-day-booking-ui.js';
import {customerRequestDialog} from './customer-ui.js';

const front={type:'frontdesk',id:'f1'},boss={type:'boss',id:'boss'};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function fixture(){
 const model=currentTestWorkflow(new DemoModel({today:'2026-10-12',now:()=> '2026-10-12T01:00:00Z'}));
 model.state.assessors.find(row=>row.id==='m-chen-kang').name='虚构评估师';
 model.state.therapists.find(row=>row.id==='t-qiu-zhen').name='虚构治疗师';
 const client=model.createReceptionClient({name:'虚构多日核对客户',phone:'13977770003',age:32,storeId:'a',requestId:'fictional-current-role-client'},front);
 model.state.bookingRequests??=[];
 client.problem='FICTIONAL PRIVATE CLINICAL CONTENT';
 const input={clientId:client.id,storeId:'a',project:'虚构逐日首访',items:['2026-10-13','2026-10-14'].map(date=>({date,time:'14:00',principalId:'t-qiu-zhen',assessorId:'m-chen-kang',assessmentTime:'14:00'})),requestId:'fictional-current-role-days'};
 return {model,client,input};
}
const finance=model=>structuredClone({packages:model.state.packages,services:model.state.services,receipts:model.state.receipts,refunds:model.state.refunds});
for(const role of [{type:'frontdesk',id:'f2'},{type:'therapist',id:'t-wu-wenpei'},{type:'manager',id:'m-he-zanfeng'}])test(`shared basic booking keeps single and multiple days consistent for ${role.type}/${role.id}`,()=>{
 const {model,client,input}=fixture(),prior=finance(model),visibleBefore=model.canSeeClient(role,client.id);
 model.saveAppointment({clientId:client.id,storeId:'a',date:'2026-10-15',time:'14:00',principalId:'t-qiu-zhen',project:'虚构单次接待',assessorId:'m-chen-kang',assessmentTime:'14:00',requestId:'fictional-current-role-single'},role);
 const dialog=multiDayBookingDialog(client.id,{model,role,esc,filters:{storeId:'a'}});assert.match(dialog.html,/data-form="multi-day-booking"/);assert.match(dialog.html,new RegExp(client.id));assert.doesNotMatch(dialog.html,/13977770003|FICTIONAL PRIVATE CLINICAL CONTENT/);
 const saved=saveMultiDayBooking(model,input,role);assert.equal(saved.count,2);assert.ok(saved.items.every(row=>row.status==='confirmed'&&row.assessorId==='m-chen-kang'&&row.assessmentTime==='14:00'));assert.deepEqual(finance(model),prior);assert.equal(model.canSeeClient(role,client.id),visibleBefore);
 const before=structuredClone(model.state),sequence=model.sequence;assert.deepEqual(saveMultiDayBooking(model,input,role),saved);assert.deepEqual(model.state,before);assert.equal(model.sequence,sequence);
});
test('multi-day current actor and franchise scope guards survive shared basic booking',()=>{
 const {model,client,input}=fixture(),owner={type:'franchise_owner',id:'fictional-current-role-owner'};
 model.state.franchiseOwners.push({id:owner.id,name:'虚构本店经营者',phone:'13977770004',storeIds:['a'],active:true,profileVersion:0});
 model.saveAppointment({clientId:client.id,storeId:'a',date:'2026-10-15',time:'14:00',principalId:'t-qiu-zhen',project:'虚构已有基本预约',assessorId:'m-chen-kang',assessmentTime:'14:00',requestId:'fictional-owner-single'},boss);
 const dialog=multiDayBookingDialog(client.id,{model,role:owner,esc});assert.match(dialog.html,/value="a"/);assert.doesNotMatch(dialog.html,/<option value="(?:b|suzhou)"/);
 const saved=saveMultiDayBooking(model,input,owner);assert.equal(saved.count,2);model.state.franchiseOwners.find(row=>row.id===owner.id).storeIds=['b'];const revoked=structuredClone(model.state),sequence=model.sequence;assert.throws(()=>saveMultiDayBooking(model,input,owner),/门店|权限|授权/);assert.deepEqual(model.state,revoked);assert.equal(model.sequence,sequence);assert.throws(()=>multiDayBookingDialog(client.id,{model,role:owner,esc}),/客户|权限/);
 const employee={type:'therapist',id:'t-wu-wenpei'};model.state.therapists.find(row=>row.id===employee.id).active=false;const inactive=structuredClone(model.state);assert.throws(()=>saveMultiDayBooking(model,{...input,requestId:'fictional-inactive-days'},employee),/在职|停用|康复师/);assert.deepEqual(model.state,inactive);
});
test('customer request review shows stored actual assessor and assessment time without changing archive default',()=>{
 const {model,client}=fixture(),role={type:'customer',id:client.id};assert.equal(client.assessorId,'tao');
 model.state.bookingRequests.push({id:'fictional-selected-assessor-request',clientId:client.id,storeId:'a',date:'2026-10-13',time:'14:00',principalId:'t-qiu-zhen',project:'虚构预约核对',assessorId:'m-chen-kang',assessmentTime:'13:00',status:'pending',requestedBy:client.id,requestedRole:'customer',requestedAt:'2026-10-12T01:00:00Z',requestId:'fictional-selected-assessor',inputKey:'fictional-selected-assessor-input'});
 const name=(kind,id)=>model.state[kind]?.find(row=>row.id===id)?.name||'待安排',ctx={model,role,esc,fmt:{date:String},ui:{name,pair:(label,value)=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`,button:()=>''}};
 const before=structuredClone(model.state),html=customerRequestDialog('customer-booking-detail','fictional-selected-assessor-request',ctx).html;assert.match(html,/本次评估师<\/span><strong>虚构评估师/);assert.match(html,/评估时间<\/span><strong>2026-10-13 13:00/);assert.match(html,/期望康复师<\/span><strong>虚构治疗师/);assert.deepEqual(model.state,before);assert.equal(model._client(client.id).assessorId,'tao');
});
