import {bookingMembers} from './companion-booking.js';
import {validateClientSearchSelection} from './client-search.js';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DemoModel} from './legacy-test-fixture.mjs';
import {receptionIntakeSuccess} from './reception.js';
import {DemoModel as ActualModel} from './core.js';
import {savePaperIntake,reviewPaperIntake,PAPER_SAFETY_QUESTIONS} from './paper-intake.js';
import {recordAssessment,confirmAssessment} from './evaluations.js';
import {INITIAL_CASE_FIELDS,paperIntakeSelection} from './paper-case-form.js';
import {purchaseLinesFromForm} from './package-purchase-ui.js';
import {approvedPurchaseReceipt,approvedPurchaseSettlement} from './package-purchase.js';
import {serviceResultSummary} from './workflow-ui.js';
import {confirmedTestSchedules} from './scheduling-test-fixture.mjs';
import {requestCustomerBooking,confirmCustomerBooking,resolveCustomerBooking,acceptCustomerBookingSuggestion} from './customer-booking.js';
import {dispatchOperations,serviceItemsFromForm} from './operations-ui.js';
import {saveMultiDayBooking} from './multi-day-booking.js';
import {multiDayBookingItems,multiDayResultSummary} from './multi-day-booking-ui.js';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
class Data{constructor(f){this.data=f.data;}*keys(){yield*Object.keys(this.data);}*[Symbol.iterator](){yield*Object.entries(this.data);}getAll(k){return this.data[k]===undefined?[]:Array.isArray(this.data[k])?this.data[k]:[this.data[k]];}get(k){return this.data[k]??null;}has(k){return k in this.data;}}
export function runtime(role,type,data,suppliedModel){
 const model=suppliedModel||new DemoModel({now:()=> '2026-10-08T12:00:00.000Z'}),f={dataset:{form:type},data,isConnected:true,reportValidity:()=>true,querySelector:()=>null,querySelectorAll:()=>[]};
 const scope={model,role,TODAY:model.today,FormData:Data,document:{addEventListener:(n,fn)=>{if(n==='submit')scope.submit=fn;}},dialogContext:{key:'workflow',requestId:'workflow-submit',evidencePhotos:[]},drafts:new Map(),$:(s)=>s==='#network-toggle'?{checked:false}:null,sheet:{open:true},setTimeout:fn=>{fn();return 1;},saveDraft(){},advanceCustomerBookingForm:()=>true,render(){},showSuccess(title,html){scope.success={title,html};},formError:(f,msg)=>{scope.error=msg;},assertBoss:()=>model._boss(role),assertStaff:()=>{if(!['boss','therapist'].includes(role.type))throw new Error('无操作权限');},ctx:()=>({model,role,esc:v=>String(v??'')}),customerCtx:()=>({model,role}),esc:v=>String(v??''),name:(k,id)=>id==='boss'?'老板':model.state[k]?.find(r=>r.id===id)?.name||'待安排',money:v=>String(v),date:v=>v,pair:(k,v)=>k+v,button:()=>'',find:(k,id)=>model.state[k]?.find(r=>r.id===id),serviceResultSummary,receptionIntakeSuccess,purchaseLinesFromForm,approvedPurchaseReceipt,approvedPurchaseSettlement,INITIAL_CASE_FIELDS,paperIntakeSelection,savePaperIntake,reviewPaperIntake,recordAssessment,confirmAssessment,confirmCustomerBooking,resolveCustomerBooking,acceptCustomerBookingSuggestion,toast(){},closeDialog(){},validateClientSearchSelection,bookingMembers,dispatchOperations,serviceItemsFromForm,saveMultiDayBooking,multiDayBookingItems,multiDayResultSummary,advanceMultiDayBookingForm:()=>true,canEditPlan:()=>false};
 for(const n of ['updateMultiDayBookingForm','updateBookingMembers','updateOperationsForm','updateEvidencePicker','updateReceptionIntakeChoices','updatePaperIntakeForm','updateScheduleForm','updateAppointmentAvailability','updateWorkflowForm'])scope[n]=()=>{};
 const start=source.indexOf("document.addEventListener('submit', async event =>"),end=source.indexOf('\nfunction exportPreview',start);vm.runInNewContext(source.slice(start,end),scope);
 return {model,f,scope,run:()=>scope.submit({target:f,preventDefault(){}})};
}
