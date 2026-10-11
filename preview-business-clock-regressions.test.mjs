import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DemoModel,TODAY,ensureStorePackageExamples,ensureFranchisePreviewExamples} from './core.js';
import {ensureEvaluations,recordAssessment,confirmAssessment} from './evaluations.js';
import {ensureCustomerBooking,requestCustomerBooking,confirmCustomerBooking} from './customer-booking.js';
import {ensurePaperIntakes,savePaperIntake,reviewPaperIntake,PAPER_SAFETY_QUESTIONS} from './paper-intake.js';
import {ensureSchedules,saveSchedule} from './schedules.js';

const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const beginning=source.indexOf('function previewTimestamp()'),end=source.indexOf("let role = {type: 'customer'");
assert.ok(beginning>=0&&end>beginning,'Execute the actual preview clock and model initialization');
const initialization=source.slice(beginning,end);
const resetStart=source.lastIndexOf('model = new DemoModel(');
assert.ok(resetStart>end,'Execute the actual preview reset constructor');
const resetExpression=source.slice(resetStart+'model = '.length).split(';')[0];
const boss={type:'boss',id:'boss'},front={type:'frontdesk',id:'f1'},assessor={type:'manager',id:'m-chen-kang'},therapist={type:'therapist',id:'t-qiu-zhen'};
const fixed=`${TODAY}T10:00:00.000Z`;
function applicationModel(hostMoment){
 class HostDate extends Date {constructor(...args){super(...(args.length?args:[hostMoment]));}static now(){return Date.parse(hostMoment);}}
 const scope={DemoModel,TODAY,ensureStorePackageExamples,ensureFranchisePreviewExamples,ensureEvaluations,ensureCustomerBooking,ensurePaperIntakes,ensureSchedules,Date:HostDate,Intl};
 vm.runInNewContext(initialization+';globalThis.applicationModel=model;globalThis.resetModel='+resetExpression+';',scope);
 scope.applicationModel.state.clients.find(row=>row.id==='c1').name='虚构演示时钟客户';
 return scope;
}
const assessmentInput=(model,extra={})=>({clientId:'c1',storeId:'a',assessorId:assessor.id,date:model.today,time:'13:00',type:'followup',project:'虚构时钟评估',summary:'虚构测试观察',metricName1:'虚构指标',metricValue1:'5',requestId:'fictional-clock-assessment',...extra});
const photo={id:'fictional-clock-photo',name:'fictional-pixel.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2xoAAAAASUVORK5CYII=',width:1,height:1,mimeType:'image/png'};
function completeFirstVisit(model){
 const financial=structuredClone({packages:model.state.packages,receipts:model.state.receipts,refunds:model.state.refunds});
 const request=requestCustomerBooking(model,{storeId:'a',date:model.today,time:'13:00',principalId:therapist.id,assessorId:assessor.id,assessmentTime:'13:00',project:'虚构服务',requestId:'fictional-clock-request'},{type:'customer',id:'c1'});
 saveSchedule(model,{therapistId:therapist.id,storeId:'a',date:model.today,status:'work',startTime:'13:00',endTime:'14:00',reason:'虚构实际确认班次',expectedVersion:model.state.staffSchedules.find(row=>row.therapistId===therapist.id&&row.date===model.today)?.version||0,requestId:'fictional-clock-therapy-shift'},boss);
 model.saveAssessmentSchedule({assessorId:assessor.id,storeId:'a',date:model.today,startTime:'13:00',endTime:'14:00',reason:'虚构本人评估班次',requestId:'fictional-clock-assessment-shift'},boss);
 const confirmed=confirmCustomerBooking(model,request.id,front),appointment=model.state.appointments.find(row=>row.id===confirmed.appointmentId);
 assert.equal(appointment.initialAssessmentRequired,true);
 model.recordArrival(appointment.id,{requestId:'fictional-clock-arrival'},front);
 const paper=savePaperIntake(model,{clientId:'c1',storeId:'a',appointmentId:appointment.id,assessorId:assessor.id,age:32,problem:'虚构本次自述',goal:'虚构本次目标',answers:Object.fromEntries(PAPER_SAFETY_QUESTIONS.map(row=>[row.key,'no'])),requestId:'fictional-clock-paper'},front);
 reviewPaperIntake(model,paper.id,{decision:'assessment',nextStep:'虚构本人评估',requestId:'fictional-clock-review'},assessor);
 const pending=recordAssessment(model,assessmentInput(model,{type:'initial',appointmentId:appointment.id,paperIntakeId:paper.id}),assessor);
 const assessment=confirmAssessment(model,pending.id,assessor);assert.equal(assessment.status,'confirmed');
 assert.deepEqual({packages:model.state.packages,receipts:model.state.receipts,refunds:model.state.refunds},financial,'Booking, arrival, paper and assessment do not charge or consume');
 const remaining=model.packageRemaining('p7'),data={appointmentId:appointment.id,clientId:'c1',storeId:'a',date:model.today,time:'13:00',principalId:therapist.id,participantIds:[],project:appointment.project,packageId:'p7',notes:'虚构本次服务记录',evidencePhotos:[photo],requestId:'fictional-clock-service'};
 const service=model.registerService(data,therapist);assert.equal(service.status,'valid');assert.equal(model.packageRemaining('p7'),remaining-1);assert.equal(model.state.appointments.find(row=>row.id===appointment.id).status,'completed');
 assert.equal(model.registerService(data,therapist).id,service.id);assert.equal(model.packageRemaining('p7'),remaining-1);
 return {data,appointment};
}

test('application initialization and reset use one fixed Shanghai business day and 18:00 clock independently of host wall time',()=>{
 for(const host of ['2026-10-11T16:30:00Z','2026-10-11T18:00:00Z','2026-10-12T10:00:00Z','2036-01-01T23:59:59Z']){
  const {applicationModel:model,resetModel}=applicationModel(host);assert.equal(model.today,TODAY);assert.equal(model.now(),fixed);assert.equal(resetModel.now(),fixed);
 }
});
for(const host of ['2026-10-11T16:30:00Z','2026-10-11T18:00:00Z'])test(`actual preview first-visit booking, arrival, assigned assessment and one-time consumption work at night host ${host}`,()=>{
 const {applicationModel:model}=applicationModel(host);completeFirstVisit(model);
});
test('fixed demo clock preserves assessment occurrence protection for 18:30 and the next business day and accepts exactly 18:00',()=>{
 const {applicationModel:model}=applicationModel('2026-10-12T10:00:00Z');
 const atBoundary=recordAssessment(model,assessmentInput(model,{time:'18:00',requestId:'fictional-clock-boundary'}),assessor);assert.equal(confirmAssessment(model,atBoundary.id,assessor).status,'confirmed');
 for(const extra of [{time:'18:30',requestId:'fictional-clock-future-time'},{date:'2026-10-09',time:'09:00',requestId:'fictional-clock-future-day'}]){
  const before=structuredClone(model.state),sequence=model.sequence;assert.throws(()=>recordAssessment(model,assessmentInput(model,extra),assessor),/实际评估时间尚未发生/);assert.deepEqual(model.state,before);assert.equal(model.sequence,sequence);
 }
});
test('next-day demo arrival and service remain refused after a complete current-day example',()=>{
 const {applicationModel:model}=applicationModel('2026-10-12T10:00:00Z'),{data}=completeFirstVisit(model);
 saveSchedule(model,{therapistId:therapist.id,storeId:'a',date:'2026-10-09',status:'work',startTime:'13:00',endTime:'14:00',reason:'虚构次日确认班次',expectedVersion:model.state.staffSchedules.find(row=>row.therapistId===therapist.id&&row.date==='2026-10-09')?.version||0,requestId:'fictional-clock-next-therapy-shift'},boss);
 const next=model.saveAppointment({clientId:'c1',storeId:'a',date:'2026-10-09',time:'13:00',principalId:therapist.id,project:'虚构次日服务',requestId:'fictional-clock-next-appointment'},front);
 const before=structuredClone(model.state),sequence=model.sequence;assert.throws(()=>model.recordArrival(next.id,{requestId:'fictional-clock-future-arrival'},front),/今天|当日|未来/);assert.deepEqual(model.state,before);assert.equal(model.sequence,sequence);
 assert.throws(()=>model.registerService({...data,date:'2026-10-09',requestId:'fictional-clock-future-service'},therapist),/未来服务|尚未发生/);assert.deepEqual(model.state,before);assert.equal(model.sequence,sequence);
});
