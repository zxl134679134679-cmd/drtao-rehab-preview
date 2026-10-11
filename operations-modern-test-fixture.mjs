/* Explicit test evidence for current workflow regressions. Production never imports
   this module. These helpers create actual appointments, arrivals and reviewed
   papers through domain APIs; they do not bypass any workflow assertion. */
import {confirmTestShift,confirmedTestSchedules} from './scheduling-test-fixture.mjs';
import {savePaperIntake,reviewPaperIntake,PAPER_SAFETY_QUESTIONS} from './paper-intake.js';
const boss={type:'boss',id:'boss'};
export function confirmAssessorTestShift(m,assessorId,storeId,date){
 const person=m.state.assessors.find(p=>p.id===assessorId);if(!person)throw new Error('Test requires a canonical assessor');m.state.assessorSchedules??=[];
 const row={id:`test-assessor-${assessorId}-${date}`,assessorId,accountId:person.accountId,accountRole:person.accountRole,storeId,date,status:'work',startTime:'00:00',endTime:'23:30',version:1,changedBy:person.accountId,changedRole:person.accountRole,reason:'测试明确确认本人评估出诊'};
 const index=m.state.assessorSchedules.findIndex(p=>p.assessorId===assessorId&&p.date===date);if(index<0)m.state.assessorSchedules.push(row);else m.state.assessorSchedules[index]=row;return m;
}
export function currentTestWorkflow(m,{days=31}={}){
 m.initializeOperationsWorkflow();confirmedTestSchedules(m,{days});
 for(let offset=0;offset<days;offset++){const day=new Date(m.today+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+offset);const date=day.toISOString().slice(0,10);confirmAssessorTestShift(m,'tao','a',date);for(const p of m.state.assessors.filter(p=>p.accountRole==='manager'))if(m.state.storeManagers.some(x=>x.id===p.accountId&&x.active))confirmAssessorTestShift(m,p.id,p.storeIds[0],date);}
 return m;
}
export function firstBookingFields(data,assessorId='tao'){return {...data,assessorId:data.assessorId||assessorId,assessmentTime:data.assessmentTime||data.time};}
export function initialAssessmentFixture(m,data){
 if(data.type!=='initial'||data.appointmentId)return data;
 const assessorId=data.assessorId||'tao';confirmAssessorTestShift(m,assessorId,data.storeId,data.date);
 const existing=m.state.appointments.find(a=>a.clientId===data.clientId&&a.storeId===data.storeId&&a.date===data.date&&a.assessmentTime===data.time&&a.assessorId===assessorId&&['confirmed','reschedule_requested'].includes(a.status));
 const principal=m.state.therapists.find(p=>p.active&&p.storeId===data.storeId&&m.bookingTherapistAllowed(p.id,data.clientId,data.storeId));if(!principal)throw new Error('Test needs an actual available therapist');confirmTestShift(m,{therapistId:principal.id,storeId:data.storeId,date:data.date});
 const a=existing||m.saveAppointment(firstBookingFields({clientId:data.clientId,storeId:data.storeId,date:data.date,time:data.time,principalId:principal.id,project:'本次真实测试预约',requestId:'fixture-visit-'+data.requestId},assessorId),boss);
 if(!a.arrivalAt)m.recordArrival(a.id,{requestId:'fixture-arrival-'+data.requestId},boss);
 let paper=(m.state.paperIntakes||[]).find(p=>p.appointmentId===a.id&&p.assessorId===assessorId&&p.status==='reviewed');
 if(!paper){const created=savePaperIntake(m,{clientId:data.clientId,storeId:data.storeId,appointmentId:a.id,assessorId,age:32,problem:'当前测试客户自述',goal:'本次目标',answers:Object.fromEntries(PAPER_SAFETY_QUESTIONS.map(q=>[q.key,'no'])),requestId:'fixture-paper-'+data.requestId},boss);const person=m.state.assessors.find(p=>p.id===assessorId);paper=reviewPaperIntake(m,created.id,{decision:'assessment',nextStep:'本次实际评估确认',requestId:'fixture-review-'+data.requestId},{type:person.accountRole,id:person.accountId});}
 return {...data,appointmentId:a.id,paperIntakeId:paper.id};
}
