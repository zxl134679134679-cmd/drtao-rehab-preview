import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';
import { ensureSchedules } from './schedules.js';
import { recordAssessment, confirmAssessment } from './evaluations.js';

const boss={type:'boss',id:'boss'}, manager={type:'manager',id:'m-chen-kang'}, front={type:'frontdesk',id:'f1'}, therapist={type:'therapist',id:'t-qiu-zhen'};
const clock=()=> '2026-10-08T09:00:00.000Z';
function model(){const m=new DemoModel({now:clock}).initializeOperationsWorkflow();ensureSchedules(m);m.state.assessments=[];m.state.paperIntakes=[];m.state.clients.find(c=>c.id==='c3').ownerId='t-qiu-zhen';m.state.packages.find(p=>p.id==='p3').storeId='a';return m;}
function prior(m,storeId='a'){m.state.assessments.push({id:'prior-confirmed',clientId:'c3',storeId,status:'confirmed',date:'2026-10-07',time:'09:00',assessorId:'tao',confirmedBy:'boss',confirmedRole:'boss'});}
const booking=(extra={})=>({clientId:'c3',storeId:'a',date:'2026-10-08',time:'12:00',principalId:'t-qiu-zhen',project:'康复服务',requestId:'visit-1',...extra});
const photo={id:'evidence-1',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2xoAAAAASUVORK5CYII=',width:1,height:1,mimeType:'image/png',name:'test.png'};
const service=(a,extra={})=>({clientId:a.clientId,storeId:a.storeId,date:a.date,time:a.time,principalId:a.principalId,project:a.project,appointmentId:a.id,packageId:'p3',notes:'实际服务记录',evidencePhotos:[photo],requestId:'service-1',...extra});

test('local first customer binding is simulated and current store scoped; only HQ can rebind or invite staff',()=>{
 const m=model();const binding=m.bindingCommand('bind-customer',{clientId:'c3',storeId:'a',simulationId:'fictional-customer-1',reason:'本人当场核对'},manager,'bind-1');
 assert.equal(binding.mode,'simulation');assert.equal(binding.clientId,'c3');
 assert.equal(m.bindingCommand('bind-customer',{clientId:'c3',storeId:'a',simulationId:'fictional-customer-1',reason:'本人当场核对'},manager,'bind-1').id,binding.id);
 assert.throws(()=>m.bindingCommand('bind-customer',{clientId:'c2',storeId:'b',simulationId:'x',reason:'测试'},manager,'bind-cross'),/本店|授权/);
 assert.throws(()=>m.bindingCommand('rebind-customer',{clientId:'c3',storeId:'a',simulationId:'another',reason:'更换'},manager,'change-local'),/总部/);
 assert.throws(()=>m.bindingCommand('invite-staff',{storeId:'a',accountRole:'therapist',accountId:'t-qiu-zhen',reason:'邀请'},manager,'invite-local'),/总部/);
 assert.equal(m.bindingCommand('rebind-customer',{clientId:'c3',storeId:'a',simulationId:'another',reason:'总部核对更换'},boss,'change-hq').simulationId,'another');
});

test('first visit needs an actual scheduled assessor and a separate assessment time before treatment',()=>{
 const m=model();assert.throws(()=>m.saveAppointment(booking(),front),/评估师|评估时间/);
 assert.throws(()=>m.saveAppointment(booking({assessorId:'tao',assessmentTime:'10:00'}),front),/评估.*排班|评估师.*排班/);
 m.saveAssessmentSchedule({assessorId:'tao',storeId:'a',date:m.today,startTime:'09:00',endTime:'12:00',reason:'本人确认出诊',requestId:'as-shift'},boss);
 const a=m.saveAppointment(booking({assessorId:'tao',assessmentTime:'10:00'}),front);
 assert.equal(a.initialAssessmentRequired,true);assert.equal(a.assessorId,'tao');assert.equal(a.assessmentTime,'10:00');
 assert.throws(()=>m.saveAppointment(booking({time:'13:00',assessorId:'tao',assessmentTime:'10:30',requestId:'same-assessor'}),front),/评估.*冲突/);
});

test('another store confirmed assessment does not turn local first visit into revisit',()=>{
 const m=model();prior(m,'b');assert.throws(()=>m.saveAppointment(booking(),front),/评估/);
 prior(m,'a');assert.equal(m.saveAppointment(booking(),front).initialAssessmentRequired,false);
});

test('service requires actual arrival and first visit requires this appointment paper and assessor confirmation',()=>{
 const m=model();m.saveAssessmentSchedule({assessorId:'tao',storeId:'a',date:m.today,startTime:'09:00',endTime:'12:00',reason:'出诊',requestId:'shift'},boss);
 const a=m.saveAppointment(booking({assessorId:'tao',assessmentTime:'10:00'}),front);
 assert.throws(()=>m.registerService(service(a),therapist),/到店/);
 m.recordArrival(a.id,{requestId:'arrive'},front);assert.throws(()=>m.registerService(service(a),therapist),/本次.*接待表|本次.*纸表/);
 m.state.paperIntakes.push({id:'paper-wrong',date:m.today,clientId:'c3',storeId:'a',appointmentId:'another',assessorId:'tao',status:'reviewed'});
 assert.throws(()=>m.registerService(service(a),therapist),/本次/);
 m.state.paperIntakes.push({id:'paper-right',date:m.today,clientId:'c3',storeId:'a',appointmentId:a.id,assessorId:'tao',status:'reviewed',reviewedRole:'boss',reviewedBy:'boss'});
 assert.throws(()=>m.registerService(service(a),therapist),/评估/);
 m.state.assessments.push({id:'assessment-right',clientId:'c3',storeId:'a',appointmentId:a.id,paperIntakeId:'paper-right',assessorId:'tao',date:m.today,time:'10:00',status:'confirmed',confirmedBy:'boss',confirmedRole:'boss'});
 assert.equal(m.registerService(service(a),therapist).status,'valid');
});

test('first assessment registration binds the real arrived visit and designated assessor confirms it',()=>{
 const m=model();m.saveAssessmentSchedule({assessorId:'m-chen-kang',storeId:'a',date:m.today,startTime:'09:00',endTime:'12:00',reason:'当班评估',requestId:'shift'},boss);
 const a=m.saveAppointment(booking({assessorId:'m-chen-kang',assessmentTime:'10:00'}),front);m.recordArrival(a.id,{requestId:'arrive'},front);
 m.state.paperIntakes.push({id:'paper-right',date:m.today,clientId:'c3',storeId:'a',appointmentId:a.id,assessorId:'m-chen-kang',status:'reviewed',reviewedRole:'manager',reviewedBy:'m-chen-kang'});
 const data={clientId:'c3',storeId:'a',appointmentId:a.id,paperIntakeId:'paper-right',assessorId:'m-chen-kang',date:m.today,time:'10:00',type:'initial',project:'实际评估',summary:'实测记录',metricName1:'下蹲次数',metricValue1:'5',requestId:'assessment'};
 const assessment=recordAssessment(m,data,front);assert.equal(assessment.appointmentId,a.id);assert.equal(assessment.paperIntakeId,'paper-right');
 assert.throws(()=>confirmAssessment(m,assessment.id,boss),/指定评估/);
 assert.equal(confirmAssessment(m,assessment.id,manager).status,'confirmed');
});

test('duty selects only current local responsible person and cancellation defaults to local approver with timed HQ escalation',()=>{
 const m=model();prior(m);m.state.frontDesks.push({id:'f-backup',name:'替补前台',active:true,storeIds:['a']});
 m.configureReceptionDuty({storeId:'a',date:m.today,startTime:'09:00',endTime:'19:00',primary:{type:'frontdesk',id:'f1'},backup:{type:'frontdesk',id:'f-backup'},reason:'本班接待交接',requestId:'duty'},boss);
 const a=m.saveAppointment(booking(),front);m.requestAppointmentCancellation(a.id,{reason:'客户不能到店',requestId:'cancel'},front);
 const task=m.state.tasks.find(t=>t.appointmentId===a.id&&t.type==='appointment_cancellation');assert.equal(task.assigneeId,'m-chen-kang');assert.equal(task.assigneeRole,'manager');assert.ok(task.dueAt);
 assert.equal(m.receptionDutyRows(front)[0].primary.id,'f1');m.state.frontDesks.find(f=>f.id==='f1').active=false;
 assert.equal(m.receptionDutyFor('a',m.today,'12:00').id,'f-backup');
 m.now=()=> '2026-10-09T10:00:00.000Z';m.refreshReceptionEscalations(boss);assert.equal(m.state.tasks.find(t=>t.id===task.id).escalationStatus,'headquarters');assert.equal(a.status,'confirmed');
});

test('one appointment multiple projects debit independent local cards atomically and reverse whole group',()=>{
 const m=model();prior(m);const a=m.saveAppointment(booking(),front);m.recordArrival(a.id,{requestId:'arrive'},front);
 m.state.packages.push({id:'card-cold',clientId:'c3',storeId:'a',name:'冷疗卡',amount:600,amountMinor:60000,total:3,openingUsed:0,status:'historical'});
 const before=m.packageRemaining('p3');const group=m.registerService(service(a,{packageId:undefined,items:[{packageId:'p3',serviceOfferingId:'rehabilitation'},{packageId:'card-cold',serviceOfferingId:'cryotherapy'}]}),therapist);
 assert.equal(group.items.length,2);assert.equal(m.packageRemaining('p3'),before-1);assert.equal(m.packageRemaining('card-cold'),2);assert.equal(a.time,'12:00');
 const repeated=m.registerService(service(a,{packageId:undefined,items:[{packageId:'p3',serviceOfferingId:'rehabilitation'},{packageId:'card-cold',serviceOfferingId:'cryotherapy'}]}),therapist);assert.equal(repeated.id,group.id);assert.equal(m.packageRemaining('card-cold'),2);
 assert.throws(()=>m.registerService(service(a,{requestId:'different',packageId:undefined,items:[{packageId:'p3',serviceOfferingId:'rehabilitation'}]}),therapist),/重复|已登记/);
 m.revokeService(group.items[1].id,'整次登记错误',boss);assert.equal(m.packageRemaining('p3'),before);assert.equal(m.packageRemaining('card-cold'),3);assert.ok(m.state.services.filter(s=>s.groupId===group.id).every(s=>s.status==='revoked'));assert.equal(m.state.appointments.find(row=>row.id===a.id).status,'confirmed');
});

test('invalid second project leaves no first debit, appointment change, or audit',()=>{
 const m=model();prior(m);const a=m.saveAppointment(booking(),front);m.recordArrival(a.id,{requestId:'arrive'},front);const before=JSON.stringify(m.state);
 assert.throws(()=>m.registerService(service(a,{packageId:undefined,items:[{packageId:'p3',serviceOfferingId:'rehabilitation'},{packageId:'p2',serviceOfferingId:'cryotherapy'}]}),therapist),/本店|本人|套餐/);
 assert.equal(JSON.stringify(m.state),before);
});
test('same card insufficient sessions and duplicate project labels or single receipt reject without any partial debit',()=>{
 const m=model();prior(m);const a=m.saveAppointment(booking(),front);m.recordArrival(a.id,{requestId:'arrival'},front);const p=m.state.packages.find(p=>p.id==='p3');p.openingUsed=p.total-1;
 const before=JSON.stringify(m.state),base=service(a,{packageId:undefined,items:[{packageId:'p3',serviceOfferingId:'rehabilitation'},{packageId:'p3',serviceOfferingId:'cryotherapy'}]});assert.throws(()=>m.registerService(base,therapist),/次数/);assert.equal(JSON.stringify(m.state),before);
 p.openingUsed=0;const available=JSON.stringify(m.state);assert.throws(()=>m.registerService({...base,items:[{packageId:'p3',serviceOfferingId:'rehabilitation',project:'同一项目'},{packageId:'p3',serviceOfferingId:'cryotherapy',project:'同一项目'}]},therapist),/重复/);assert.equal(JSON.stringify(m.state),available);
 assert.throws(()=>m.registerService({...base,items:[{singleOrderId:'same',serviceOfferingId:'rehabilitation'},{singleOrderId:'same',serviceOfferingId:'cryotherapy'}]},therapist),/重复/);assert.equal(JSON.stringify(m.state),available);
});
test('group reversal checks every actual source and owner scope before restoring any line',()=>{
 const m=model();prior(m);const a=m.saveAppointment(booking(),front);m.recordArrival(a.id,{requestId:'arrival'},front);const group=m.registerService(service(a,{packageId:undefined,items:[{packageId:'p3',serviceOfferingId:'rehabilitation'},{packageId:'p3',serviceOfferingId:'cryotherapy'}]}),therapist);
 m.state.services.find(s=>s.id===group.items[1].id).packageId='p2';const before=JSON.stringify(m.state);assert.throws(()=>m.revokeService(group.id,'更正',boss),/组合.*关联|来源.*一致/);assert.equal(JSON.stringify(m.state),before);
});

test('purchased card has no term until fully received; actual full receipt starts frozen term once',()=>{
 const m=model();m.purchaseCommand('configure-catalog-product',{productId:'catalog-a-annual',storeId:'a',expectedVersion:0,name:'年卡',serviceContent:'康复与冷疗',description:'购买时冻结权益',priceMinor:300000,totalSessions:10,validityMonths:12,allowedServiceIds:['rehabilitation','cryotherapy'],active:true,reason:'首次配置'},boss,'catalog');const product=m.state.productCatalog.find(p=>p.id==='catalog-a-annual');
 const quote=m.purchaseCommand('submit-purchase-quote',{storeId:'a',clientId:'c3',lines:[{productId:product.id,catalogVersion:product.version,quantity:1}],amountMinor:300000,businessRecipient:null,reason:'当场核价'},front,'quote');
 m.purchaseCommand('approve-amount-application',{applicationId:quote.id,expectedVersion:0,decision:'approve',reason:'本店核准'},manager,'approve');
 const completed=m.purchaseCommand('complete-approved-purchase',{applicationId:quote.id,expectedVersion:1,existingClientId:'c3',reason:'登记购买'},front,'purchase');const p=m.state.packages.find(p=>p.id===completed.createdRecordIds[0]);
 assert.equal(p.activationStatus,'pending');assert.equal(p.validFrom,null);assert.equal(p.expiresOn,null);
 const receipt={clientId:'c3',storeId:'a',packageId:p.id,purpose:'package',date:m.today,time:'12:00',amount:'1000',channel:'direct',method:'wechat',notes:'分次到账',requestId:'part-pay'};
 m.recordReceipt(receipt,front);assert.equal(p.activationStatus,'pending');
 m.recordReceipt({...receipt,amount:'2000',time:'12:30',requestId:'full-pay'},front);assert.equal(p.activationStatus,'active');assert.equal(p.validFrom,'2026-10-08');assert.ok(p.expiresOn>'2026-10-08');const expiry=p.expiresOn;
 m.recordReceipt({...receipt,amount:'2000',time:'12:30',requestId:'full-pay'},front);assert.equal(p.expiresOn,expiry);
 const legacy=m.state.packages.find(p=>p.id==='p3');assert.equal(legacy.validFrom,undefined);
});
