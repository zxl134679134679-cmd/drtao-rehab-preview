/* Preview-only operations. Simulated identity records never claim real WeChat delivery. */
export function initializeOperationsWorkflow(model){model.state.operationsWorkflowVersion=1;return model;}
export function operationsEnabled(model,data={}){return model.state.operationsWorkflowVersion===1||data.items!==undefined||data.visitKind!==undefined||model.state.therapists.some(p=>p.active===true&&!p.legacy);}
const activeVisits=new WeakMap();
export function isSameStagedVisit(model,row){return Boolean(activeVisits.get(model)&&row.visitId===activeVisits.get(model));}
const clone=v=>JSON.parse(JSON.stringify(v));
const text=(v,label,max=500)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw new Error(`请填写有效的${label}`);return v.trim();};
const day=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new Error('日期无效');return v;};
const time=v=>{if(typeof v!=='string'||!/^([01]\d|2[0-3]):(00|30)$/.test(v))throw new Error('请选择整点或半点评估时间');return v;};
const minutes=v=>Number(v.slice(0,2))*60+Number(v.slice(3));
const pending=a=>['confirmed','reschedule_requested','pending_reassignment'].includes(a.status);
const overlap=(a,b)=>Math.abs(minutes(a)-minutes(b))<60;
const staged=m=>Object.assign(Object.create(Object.getPrototypeOf(m)),m,{state:clone(m.state)});
const commit=(m,s)=>{m.state=s.state;m.sequence=s.sequence;};
function localManager(m,r,storeId){if(r?.type==='manager'){if(m.managerStoreId(r)!==storeId)throw new Error('仅本店店长可操作');}else m.assertStoreOwner(r,[storeId]);if(m._store(storeId).active===false)throw new Error('门店已停用');}
function request(m,collection,r,id,key){const old=(m.state[collection]||[]).find(x=>x.actorId===r.id&&x.actorRole===r.type&&x.requestId===id);if(old&&old.inputKey!==key)throw new Error('同一提交的内容或用途发生变化');return old;}
function activeLocal(m,person,storeId){
 if(!person||typeof person.id!=='string')return false;
 if(person.type==='boss')return person.id==='boss';
 if(person.type==='manager')return m.state.storeManagers.some(p=>p.id===person.id&&p.active===true&&p.storeId===storeId);
 if(person.type==='frontdesk')return m.state.frontDesks.some(p=>p.id===person.id&&p.active===true&&p.storeIds.includes(storeId));
 if(person.type==='franchise_owner')return m.isStoreOwner(person,[storeId]);
 return false;
}
export function localApprover(m,storeId){const manager=m.state.storeManagers.find(p=>p.active===true&&p.storeId===storeId);if(manager)return {type:'manager',id:manager.id};const owner=m.state.franchiseOwners.find(p=>p.active===true&&p.storeIds.includes(storeId));return owner?{type:'franchise_owner',id:owner.id}:{type:'boss',id:'boss'};}
export function bindingCommand(m,command,p,r,requestId){
 if(!['bind-customer','rebind-customer','invite-staff','invite-franchise-owner'].includes(command))throw new Error('模拟绑定命令不存在');
 if(command==='bind-customer')localManager(m,r,p.storeId);else {if(r?.type!=='boss'||r.id!=='boss')throw new Error('换绑及员工或加盟身份邀请仅总部办理');m._boss(r);}
 const reason=text(p.reason,'核对原因'),id=text(requestId,'提交标识',150),key=JSON.stringify({command,...p}),old=request(m,'identityOperations',r,id,key);if(old)return clone(old.result);
 const s=staged(m);s.state.identityBindings??=[];s.state.identityOperations??=[];let result;
 if(command.includes('customer')){
  const client=m._client(p.clientId);m._store(p.storeId);if(command==='bind-customer'&&client.storeId!==p.storeId)throw new Error('仅可办理本店客户首次绑定');
  const simulationId=text(p.simulationId,'模拟身份标识',80),current=s.state.identityBindings.find(b=>b.clientId===client.id&&b.status==='active');
  if(current&&command==='bind-customer')throw new Error('客户已绑定，所有换绑须总部办理');
  if(!current&&command==='rebind-customer')throw new Error('尚无绑定，请先办理首次模拟绑定');
  if(s.state.identityBindings.some(b=>b.status==='active'&&b.simulationId===simulationId&&b.clientId!==client.id))throw new Error('此模拟身份已绑定其他客户');
  if(current){current.status='superseded';current.endedAt=s._timestamp();}
  result={id:s._id('binding'),clientId:client.id,storeId:p.storeId,simulationId,status:'active',mode:'simulation',reason,createdAt:s._timestamp(),createdBy:r.id,createdRole:r.type};s.state.identityBindings.push(result);
 }else{
  m._store(p.storeId);if(command==='invite-staff'){const collections={therapist:'therapists',manager:'storeManagers',frontdesk:'frontDesks'},person=m.state[collections[p.accountRole]]?.find(x=>x.id===p.accountId&&x.active===true&&(x.storeId===p.storeId||x.storeIds?.includes(p.storeId)));if(!person)throw new Error('请选择本店在职员工');}
  else if(!m.state.franchiseOwners.some(x=>x.id===p.accountId&&x.active===true&&x.storeIds.includes(p.storeId)))throw new Error('请选择总部已授权加盟身份');
  result={id:s._id('invitation'),mode:'simulation',status:'simulated',storeId:p.storeId,accountRole:p.accountRole||'franchise_owner',accountId:p.accountId,createdAt:s._timestamp(),reason};
 }
 s.state.identityOperations.push({actorId:r.id,actorRole:r.type,requestId:id,inputKey:key,result:clone(result)});s._log('identity_simulated',{command,storeId:p.storeId,clientId:p.clientId||null,bindingId:result.id,reason},r);commit(m,s);return clone(result);
}
const assessorAccounts={tao:{type:'boss',id:'boss'},'m-chen-kang':{type:'manager',id:'m-chen-kang',storeId:'a'},'m-he-zanfeng':{type:'manager',id:'m-he-zanfeng',storeId:'b'},'t-qiu-zhen':{type:'therapist',id:'t-qiu-zhen',storeId:'a'},'t-zou-zonglin':{type:'therapist',id:'t-zou-zonglin',storeId:'a'},'t-wu-wenpei':{type:'therapist',id:'t-wu-wenpei',storeId:'b'}};
export function confirmedLocalAssessment(m,a,storeId){const person=assessorAccounts[a.assessorId],roster=m.state.assessors.find(p=>p.id===a.assessorId);return Boolean(a.status==='confirmed'&&a.storeId===storeId&&person&&roster&&roster.accountRole===person.type&&roster.accountId===person.id&&(!person.storeId||person.storeId===storeId)&&a.confirmedRole===person.type&&a.confirmedBy===person.id);}
export function reviewedByAssessor(m,p){const person=assessorAccounts[p.assessorId],roster=m.state.assessors.find(a=>a.id===p.assessorId);return Boolean(p.status==='reviewed'&&person&&roster&&roster.accountRole===person.type&&roster.accountId===person.id&&(!person.storeId||person.storeId===p.storeId)&&p.reviewedRole===person.type&&p.reviewedBy===person.id);}
export function firstVisit(m,clientId,storeId){return !(m.state.assessments||[]).some(a=>a.clientId===clientId&&confirmedLocalAssessment(m,a,storeId));}
export function saveAssessmentSchedule(m,p,r){
 const assessor=m.assessorRows(p.storeId).find(a=>a.id===p.assessorId);if(!assessor)throw new Error('请选择本店有效评估师');m.assertStoreOwner(r,[p.storeId]);
 const date=day(p.date),startTime=time(p.startTime),endTime=time(p.endTime);if(date<m.today||minutes(endTime)<=minutes(startTime))throw new Error('请填写未来或今天有效评估排班');
 const reason=text(p.reason,'排班原因'),requestId=text(p.requestId,'提交标识',150),key=JSON.stringify({assessorId:p.assessorId,storeId:p.storeId,date,startTime,endTime,reason}),before=(m.state.assessorSchedules||[]).find(a=>a.assessorId===p.assessorId&&a.date===date);m.assertStoreOwner(r,[p.storeId,...(before?[before.storeId]:[])]);const old=request(m,'assessmentScheduleOperations',r,requestId,key);if(old)return clone(old.result);
 const therapy=assessor.accountRole==='therapist'?(m.state.staffSchedules||[]).find(s=>s.therapistId===assessor.accountId&&s.date===date):null;if(therapy&&(therapy.status==='rest'||therapy.status==='work'&&therapy.storeId!==p.storeId))throw new Error('评估排班与本人已确认治疗排班休息或跨店安排冲突');
 const affected=m.state.appointments.filter(a=>pending(a)&&a.assessorId===p.assessorId&&a.date===date&&(a.storeId!==p.storeId||minutes(a.assessmentTime)<minutes(startTime)||minutes(a.assessmentTime)+60>minutes(endTime)));
 if(affected.length)throw new Error('此评估排班影响已有评估预约，请先处理预约');
 const s=staged(m);s.state.assessorSchedules??=[];s.state.assessmentScheduleOperations??=[];const current=s.state.assessorSchedules.find(a=>a.assessorId===p.assessorId&&a.date===date),row={id:current?.id||s._id('assessorSchedule'),assessorId:p.assessorId,accountId:assessor.accountId,accountRole:assessor.accountRole,storeId:p.storeId,date,status:'work',startTime,endTime,reason,version:(current?.version||0)+1,changedBy:r.id,changedRole:r.type,changedAt:s._timestamp()};
 const index=s.state.assessorSchedules.findIndex(a=>a.id===current?.id);if(index<0)s.state.assessorSchedules.push(row);else s.state.assessorSchedules[index]=row;
 s.state.assessmentScheduleOperations.push({actorId:r.id,actorRole:r.type,requestId,inputKey:key,result:clone(row)});s._log('assessor_schedule_saved',{storeId:p.storeId,assessorId:p.assessorId,date},r);commit(m,s);return clone(row);
}
export function assertAssessmentBooking(m,input,excludeId){
 const assessor=m.assessorRows(input.storeId).find(a=>a.id===input.assessorId);if(!assessor)throw new Error('首次到本店须选择本次实际评估师');
 time(input.assessmentTime);
 const rows=(m.state.assessorSchedules||[]).filter(s=>s.assessorId===assessor.id&&s.date===input.date);
 const schedule=rows.length===1?rows[0]:rows.length?null:assessor.accountRole==='therapist'?(m.state.staffSchedules||[]).find(s=>s.therapistId===assessor.accountId&&s.date===input.date):null;
 if(!schedule||schedule.status!=='work'||schedule.storeId!==input.storeId||minutes(input.assessmentTime)<minutes(schedule.startTime)||minutes(input.assessmentTime)+60>minutes(schedule.endTime))throw new Error('评估师本次门店尚无可用的已确认评估排班');
 const conflict=m.state.appointments.find(a=>a.id!==excludeId&&pending(a)&&a.date===input.date&&((a.assessorId===assessor.id&&overlap(a.assessmentTime,input.assessmentTime))||(assessor.accountRole==='therapist'&&(a.principalId===assessor.accountId||a.participantIds?.includes(assessor.accountId))&&overlap(a.time,input.assessmentTime))||(a.clientId===input.clientId&&(overlap(a.time,input.assessmentTime)||(a.assessmentTime&&overlap(a.assessmentTime,input.assessmentTime))))));
 if(conflict)throw new Error('评估时间与评估师跨店安排、治疗或客户已有预约冲突');
}
function currentVisitPaper(m,a){return (m.state.paperIntakes||[]).find(p=>p.appointmentId===a.id&&p.clientId===a.clientId&&p.storeId===a.storeId&&p.date===a.date&&p.assessorId===a.assessorId&&reviewedByAssessor(m,p)&&m.isAssignedAssessor({type:p.reviewedRole,id:p.reviewedBy},a.assessorId,a.storeId));}
function currentVisitAssessment(m,a,paper){return (m.state.assessments||[]).find(p=>p.appointmentId===a.id&&p.clientId===a.clientId&&p.storeId===a.storeId&&p.date===a.date&&p.time===a.assessmentTime&&confirmedLocalAssessment(m,p,a.storeId)&&p.assessorId===a.assessorId&&paper&&p.paperIntakeId===paper.id&&m.isAssignedAssessor({type:p.confirmedRole,id:p.confirmedBy},a.assessorId,a.storeId));}
export function serviceReadiness(m,input){
 const a=m.state.appointments.find(a=>input.appointmentId?a.id===input.appointmentId:['clientId','storeId','date','time','principalId'].every(k=>a[k]===input[k]));
 const missing=[];if(!a)missing.push('先选择本次真实预约');else{
  if(!a.arrivalAt)missing.push('先确认本次实际到店');
  const initial=a.initialAssessmentRequired===true||a.initialAssessmentRequired===undefined&&firstVisit(m,a.clientId,a.storeId);
  if(initial){
   const paper=currentVisitPaper(m,a);
   if(!paper)missing.push('本次对应初访接待表须已由指定评估师复核');
   const assessment=currentVisitAssessment(m,a,paper);
   if(!assessment)missing.push('本次指定评估师须亲自确认关联评估');
  }else if(firstVisit(m,a.clientId,a.storeId))missing.push('复诊须有本店已确认评估');
 }
 return {ready:missing.length===0,missing,appointmentId:a?.id||null};
}
export function registerServiceGroup(m,data,r){
 if(!Array.isArray(data.items)||!data.items.length||data.items.length>20)throw new Error('请选择本次实际项目明细');
 if(!data.appointmentId)throw new Error('组合服务须选择本次真实预约');
 if(data.packageId||data.receiptId||data.billingMode==='single')throw new Error('组合服务请在各项目分别选择套餐或单次到账单');
 const key=JSON.stringify(data),prior=(m.state.serviceVisits||[]).find(v=>v.requestId===data.requestId&&v.recordedBy===r.id&&v.recordedRole===r.type);
 if(prior){m._staff(r,data.clientId,data.storeId);if(prior.inputKey!==key)throw new Error('同一组合提交内容发生变化');return groupResult(m,prior);}
 const ready=serviceReadiness(m,data);if(!ready.ready)throw new Error(ready.missing.join('；'));
 if(m.state.services.some(x=>x.status==='valid'&&(x.appointmentId===data.appointmentId||x.clientId===data.clientId&&x.date===data.date&&x.time===data.time)))throw new Error('此真实预约已登记服务，不能重复扣次');
 if(data.items.some(i=>!i||typeof i!=='object'||Array.isArray(i)))throw new Error('请选择有效实际项目明细');
 const labels=data.items.map(i=>i.project!==undefined?text(i.project,'明细项目',120):i.serviceOfferingId),projects=data.items.map(i=>i.serviceOfferingId),singles=data.items.map(i=>i.receiptId||i.singleOrderId).filter(Boolean);if(new Set(labels).size!==labels.length||new Set(projects).size!==projects.length||new Set(singles).size!==singles.length)throw new Error('同一实际项目或单次到账单不能重复登记');
 const s=staged(m),visitId=s._id('visit'),rows=[],original=clone(s.state.appointments.find(a=>a.id===data.appointmentId));
 activeVisits.set(s,visitId);try{for(const [index,item] of data.items.entries()){
  if(!item||Object.keys(item).some(k=>!['packageId','singleOrderId','receiptId','serviceOfferingId','project'].includes(k)))throw new Error('项目明细含非法字段');
  if(Boolean(item.packageId)===Boolean(item.singleOrderId||item.receiptId))throw new Error('每项请选择独立套餐或单次到账单');
  if(!['rehabilitation','cryotherapy','iastm','deep-stretch'].includes(item.serviceOfferingId))throw new Error('请选择实际服务项目');
  Object.assign(s.state.appointments.find(a=>a.id===original.id),clone(original));
  const row=s._registerServiceLine({...data,items:undefined,billingMode:item.packageId?'package':'single',packageId:item.packageId,receiptId:item.receiptId||item.singleOrderId,serviceOfferingId:item.serviceOfferingId,requestId:`${data.requestId}:${index}`},r);
  row.visitId=visitId;row.groupId=visitId;row.lineProject=labels[index];row.evidenceServiceId=rows[0]?.id||row.id;if(index)row.evidencePhotos=[];rows.push(row);
 }}finally{activeVisits.delete(s);}
 rows.forEach(row=>row.status='valid');const head=rows[0],visitServiceIds=rows.map(x=>x.id);head.visitServiceIds=visitServiceIds;const appointment=s.state.appointments.find(a=>a.id===original.id);appointment.serviceId=head.id;appointment.visitId=visitId;appointment.visitServiceIds=visitServiceIds;
 // Only the head owns appointment/task snapshots and evidence; all lines refer to it.
 rows.slice(1).forEach(row=>{row.appointmentSnapshots=[];row.taskSnapshots=[];});
 const visit={id:visitId,appointmentId:original.id,storeId:data.storeId,clientId:data.clientId,serviceIds:visitServiceIds,requestId:data.requestId,inputKey:key,recordedBy:r.id,recordedRole:r.type,status:'valid'};s.state.serviceVisits??=[];s.state.serviceVisits.push(visit);s._log('service_visit_registered',{visitId,storeId:data.storeId,appointmentId:original.id,serviceIds:visitServiceIds},r);commit(m,s);return groupResult(m,visit);
}
function groupResult(m,visit){const rows=visit.serviceIds.map(id=>m.state.services.find(s=>s.id===id));return {...clone(rows[0]),visitId:visit.id,visitServiceIds:[...visit.serviceIds],items:clone(rows)};}
export function revokeServiceGroup(m,id,reason,r){
 const row=m.state.services.find(s=>s.id===id),visit=(m.state.serviceVisits||[]).find(v=>v.id===(row?.visitId||id));if(!visit){if(row?.visitId)throw new Error('组合记录关联异常，请总部核对原记录');return null;}
 const members=visit.serviceIds?.map(id=>m.state.services.find(s=>s.id===id));if(!members?.length||new Set(visit.serviceIds).size!==members.length||members.some(item=>!item||item.visitId!==visit.id||item.appointmentId!==visit.appointmentId||item.clientId!==visit.clientId||item.storeId!==visit.storeId))throw new Error('组合明细关联异常，请总部核对原记录');
 const sources=members.map(item=>item.billingMode==='single'?m.state.receipts.find(p=>p.id===item.receiptId):m.state.packages.find(p=>p.id===item.packageId));if(sources.some(source=>!source||source.clientId!==visit.clientId||(source.storeId||m._client(source.clientId).storeId)!==visit.storeId))throw new Error('组合来源与客户门店关联不一致，请总部核对原记录');
 m.assertStoreOwner(r,[visit.storeId,...members.map(item=>item.storeId),...sources.map(source=>source.storeId||m._client(source.clientId).storeId)]);if(visit.status==='revoked')throw new Error('此组合已撤销，不能重复恢复次数');
 const s=staged(m),head=s.state.services.find(s=>s.id===visit.serviceIds[0]);s._revokeServiceLine(head.id,reason,r);
 const stamp=s._timestamp();for(const id of visit.serviceIds.slice(1)){const item=s.state.services.find(s=>s.id===id);Object.assign(item,{status:'revoked',revokeReason:reason,revokedBy:r.id,revokedAt:stamp});}
 const target=s.state.serviceVisits.find(v=>v.id===visit.id);target.status='revoked';const a=s.state.appointments.find(a=>a.id===visit.appointmentId);delete a.visitId;delete a.visitServiceIds;s._log('service_visit_revoked',{visitId:visit.id,storeId:visit.storeId,serviceIds:visit.serviceIds,reason},r);commit(m,s);return groupResult(m,target);
}
export function configureReceptionDuty(m,p,r){
 m.assertStoreOwner(r,[p.storeId]);const date=day(p.date),startTime=time(p.startTime||'09:00'),endTime=time(p.endTime||'19:00');if(date<m.today||minutes(endTime)<=minutes(startTime))throw new Error('接待班次时间无效');
 if(!activeLocal(m,p.primary,p.storeId)||!activeLocal(m,p.backup,p.storeId)||sameActor(p.primary,p.backup))throw new Error('请指定不同的本店在职接待负责人和替补');
 const responseMinutes=Number(p.responseMinutes??30);if(!Number.isInteger(responseMinutes)||responseMinutes<5||responseMinutes>120)throw new Error('处理时限须为5至120分钟');
 const requestId=text(p.requestId,'提交标识',150),reason=text(p.reason,'班次交接原因'),key=JSON.stringify({...p,responseMinutes}),old=request(m,'receptionDutyOperations',r,requestId,key);if(old)return clone(old.result);
 const s=staged(m);s.state.storeDutyAssignments??=[];s.state.receptionDutyOperations??=[];const current=s.state.storeDutyAssignments.find(x=>x.storeId===p.storeId&&x.date===date&&x.startTime===startTime);
 if(s.state.storeDutyAssignments.some(x=>x.id!==current?.id&&x.storeId===p.storeId&&x.date===date&&minutes(x.startTime)<minutes(endTime)&&minutes(x.endTime)>minutes(startTime)))throw new Error('本店接待班次重叠，请核对已有班次');
 const row={id:current?.id||s._id('receptionDuty'),storeId:p.storeId,date,startTime,endTime,primary:clone(p.primary),backup:clone(p.backup),responseMinutes,reason,changedBy:r.id,changedRole:r.type,changedAt:s._timestamp()};const index=s.state.storeDutyAssignments.findIndex(x=>x.id===current?.id);if(index<0)s.state.storeDutyAssignments.push(row);else s.state.storeDutyAssignments[index]=row;
 s.state.receptionDutyOperations.push({actorId:r.id,actorRole:r.type,requestId,inputKey:key,result:clone(row)});s._log('reception_duty_saved',{storeId:p.storeId,date,primary:p.primary,backup:p.backup,responseMinutes},r);commit(m,s);return clone(row);
}
export function receptionDutyFor(m,storeId,date,at){const row=(m.state.storeDutyAssignments||[]).find(x=>x.storeId===storeId&&x.date===date&&minutes(x.startTime)<=minutes(at)&&minutes(x.endTime)>minutes(at));if(row){if(activeLocal(m,row.primary,storeId))return {...clone(row.primary),responseMinutes:row.responseMinutes,dutyId:row.id};if(activeLocal(m,row.backup,storeId))return {...clone(row.backup),responseMinutes:row.responseMinutes,dutyId:row.id,substitute:true};}return {...localApprover(m,storeId),responseMinutes:30,fallback:true};}
export function receptionDutyRows(m,r){const ids=m.receptionStoreIds(r);return clone((m.state.storeDutyAssignments||[]).filter(x=>ids.includes(x.storeId)));}
function currentDuty(m,storeId,stamp=m._timestamp()){const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(stamp));return receptionDutyFor(m,storeId,m.today,clock);}
const identity=p=>p?{type:p.type,id:p.id}:null;
const sameActor=(a,b)=>a?.type===b?.type&&a?.id===b?.id;
function approvers(m,storeId,stamp=m._timestamp()){
 const duty=currentDuty(m,storeId,stamp),configured=(m.state.storeDutyAssignments||[]).find(d=>d.id===duty.dutyId);
 const candidates=[configured?.primary,configured?.backup,...m.state.storeManagers.filter(p=>p.active&&p.storeId===storeId).map(p=>({type:'manager',id:p.id})),...m.state.franchiseOwners.filter(p=>p.active&&p.storeIds.includes(storeId)).map(p=>({type:'franchise_owner',id:p.id})),{type:'boss',id:'boss'}];
 return candidates.filter((p,index)=>p&&['boss','manager','franchise_owner'].includes(p.type)&&activeLocal(m,p,storeId)&&!candidates.slice(0,index).some(old=>sameActor(old,p))).map(identity);
}
function storeOwner(m,storeId){return identity(approvers(m,storeId).find(p=>p.type!=='manager'))||{type:'boss',id:'boss'};}
function frontdeskFor(m,storeId,preferredId){const duty=currentDuty(m,storeId),configured=(m.state.storeDutyAssignments||[]).find(d=>d.id===duty.dutyId),people=[preferredId?{type:'frontdesk',id:preferredId}:null,configured?.primary,configured?.backup,...m.state.frontDesks.filter(p=>p.active&&p.storeIds.includes(storeId)).map(p=>({type:'frontdesk',id:p.id}))];return identity(people.find(p=>p?.type==='frontdesk'&&activeLocal(m,p,storeId)))||localApprover(m,storeId);}
export function cancellationAssignment(m,row,stamp,approval){if(!operationsEnabled(m))return {assigneeId:'boss',assigneeRole:'boss'};const duty=currentDuty(m,row.storeId,stamp),people=approval?approvers(m,row.storeId,stamp):[identity(duty)],person=people[0],backup=people.find(p=>!sameActor(p,person));return {assigneeId:person.id,assigneeRole:person.type,...(backup?{backupId:backup.id,backupRole:backup.type}:{}),dueAt:new Date(Date.parse(stamp)+duty.responseMinutes*60000).toISOString(),responseMinutes:duty.responseMinutes,escalationStatus:'local',escalationTarget:'boss'};}
export function refreshReceptionEscalations(m,r){m._boss(r);const now=Date.parse(m._timestamp());for(const task of m.state.tasks.filter(t=>t.type==='appointment_cancellation'&&t.status==='pending'&&t.dueAt)){if(now>Date.parse(task.dueAt))task.escalationStatus='headquarters';}return workflowBlockersView(m,r);}
export function workflowBlockersView(m,r){
 const ids=r?.type==='boss'?(m._boss(r),m.state.stores.map(s=>s.id)):r?.type==='franchise_owner'?m.ownerStoreIds(r):r?.type==='manager'?[m.managerStoreId(r)]:[];if(!ids.length)throw new Error('仅老板或本店店长可查看流程卡点');const rows=[];
 const add=(step,row,reason,nextStep,assignee,dueAt,backup)=>{
  if(!ids.includes(row.storeId))return;
  const client=m.state.clients.find(c=>c.id===(row.clientId||row.id)),createdAt=row.requestedAt||row.createdAt||null,responsible=identity(assignee||localApprover(m,row.storeId)),deadline=dueAt||createdAt&&new Date(Date.parse(createdAt)+currentDuty(m,row.storeId).responseMinutes*60000).toISOString();
  rows.push({id:`${step}:${row.id}`,step,sourceId:row.id,clientId:client?.id||row.clientId||null,clientName:client?.name||(row.therapistId?m.state.therapists.find(t=>t.id===row.therapistId)?.name:'待正式建档')||'门店排班',storeId:row.storeId,reason,nextStep,responsible,...(backup?{backup:identity(backup)}:{}),createdAt,dueAt:deadline||null,overdue:Boolean(deadline&&Date.parse(m._timestamp())>Date.parse(deadline)),notificationMode:'in_app_preview'});
 };
 for(const c of m.state.clients.filter(c=>ids.includes(c.storeId)))if(!(m.state.identityBindings||[]).some(b=>b.clientId===c.id&&b.status==='active'))add('binding',c,'尚未办理客户模拟绑定','本店店长或加盟老板核对本人并办理首次模拟绑定');
 for(const b of m.state.bookingRequests||[])if(b.status==='pending'){const person=currentDuty(m,b.storeId);add('booking',b,'客户预约申请待门店确认','值班接待核对治疗与首次评估排班后确认',person);if(firstVisit(m,b.clientId,b.storeId)){try{assertAssessmentBooking(m,b);}catch(error){add('assessment_schedule',b,error.message,'确认指定评估师真实出诊排班，分别安排评估与治疗',storeOwner(m,b.storeId));}}}
 for(const a of m.state.appointments.filter(a=>pending(a))){
  if(a.status==='reschedule_requested'){const requestedAt=m.state.audit.find(log=>log.type==='reschedule_requested'&&log.appointmentId===a.id)?.createdAt;add('reschedule',{...a,requestedAt},'客户改约待门店确认，原时段仍保留','本店老板核对实际评估与治疗排班，确认原预约的新安排',storeOwner(m,a.storeId));}
  if(a.status==='pending_reassignment')add('reassignment',a,'本次预约服务人员待重新分配','本店老板核对在职授权人员及真实排班后重新安排',storeOwner(m,a.storeId));
  if(a.cancellationRequest?.status==='pending'){const task=m.state.tasks.find(t=>t.appointmentId===a.id&&t.type==='appointment_cancellation'&&t.status==='pending'),approval=a.cancellationRequest.needsApproval===true||a.cancellationRequest.source==='frontdesk',people=approval?approvers(m,a.storeId):[identity(currentDuty(m,a.storeId))],responsible=people[0],backup=people.find(p=>!sameActor(p,responsible));add('cancellation',{...a,requestedAt:a.cancellationRequest.requestedAt},'取消申请待处理，原时段仍保留','由本店店长或加盟老板审批；超时升级总部',responsible,task?.dueAt,backup);}
  if(a.initialAssessmentRequired){try{assertAssessmentBooking(m,a,a.id);}catch(error){add('assessment_schedule',a,error.message,'由排班负责人确认实际评估师可用排班');}if(a.arrivalAt){const paper=(m.state.paperIntakes||[]).find(p=>p.appointmentId===a.id&&p.assessorId===a.assessorId);if(!currentVisitPaper(m,a))add('intake',a,'本次初访资料待填写或待指定评估师本人复核',paper?.status==='reviewed'?'本店老板核对并更正原表后，交指定评估师本人补核':'值班接待填写本次纸表，并交指定评估师本人复核',paper?.status==='reviewed'?storeOwner(m,a.storeId):paper?{type:m.state.assessors.find(x=>x.id===a.assessorId)?.accountRole,id:m.state.assessors.find(x=>x.id===a.assessorId)?.accountId}:receptionDutyFor(m,a.storeId,a.date,a.time));const assessment=currentVisitAssessment(m,a,currentVisitPaper(m,a));if(!assessment)add('assessment',a,'指定评估师尚未亲自确认本次评估','指定评估师本人核对实际指标并确认',{type:m.state.assessors.find(x=>x.id===a.assessorId)?.accountRole,id:m.state.assessors.find(x=>x.id===a.assessorId)?.accountId});}}
 }
 for(const p of m.state.paperIntakes||[])if((p.status!=='reviewed'||p.assessorId&&!reviewedByAssessor(m,p))&&!rows.some(row=>row.step==='intake'&&row.sourceId===p.appointmentId)){const a=m.state.assessors.find(x=>x.id===p.assessorId);add('intake',p,'已保存接待表待指定评估师复核','指定评估师核对本次自述并确认下一步',a?{type:a.accountRole,id:a.accountId}:null);}
 for(const a of m.state.assessments||[])if(a.status==='pending'&&!rows.some(row=>row.step==='assessment'&&row.sourceId===a.appointmentId)){const assessor=m.state.assessors.find(x=>x.id===a.assessorId);add('assessment',a,'实际评估记录待指定评估师确认','指定评估师本人核对并确认',assessor?{type:assessor.accountRole,id:assessor.accountId}:null);}
 for(const c of m.state.clients.filter(c=>ids.includes(c.storeId))){const usable=m.availablePackages(c.id,c.storeId).some(p=>m.packageRemaining(p.id)>0)||m.state.receipts.some(p=>p.clientId===c.id&&p.storeId===c.storeId&&m._singleReceiptAvailable(p)),pendingCard=m.state.packages.some(p=>p.clientId===c.id&&p.storeId===c.storeId&&p.activationPolicy==='paid'&&p.activationStatus==='pending'&&!p.closed);if(!usable&&!pendingCard)add('billing_setup',c,'本店尚无可用的付清权益','前台核对本店实际项目与金额，取得批准并登记真实到账后使用');}
 for(const p of m.state.packages.filter(p=>p.purchaseId&&p.activationPolicy==='paid'&&p.activationStatus==='pending'))add('activation',p,'新购卡未实际付清到账，待激活','前台登记已批准实际到账或平台结算；付清后起算冻结期限');
 for(const a of m.state.amountApplications||[]){
  if(a.status==='submitted')add('amount_approval',a,'金额申请待本店任一授权人审批','本店店长或当前加盟老板核对实际金额并审批');
  if(a.status==='approved')add('amount_execution',{...a,createdAt:a.approvedAt||a.createdAt},'金额已批准，待前台正式执行','本店前台核对原批准版本并执行冻结资料；购买登记不代表已到账',frontdeskFor(m,a.storeId,a.quotedRole==='frontdesk'?a.quotedBy:null));
 }
 for(const i of m.state.purchaseIntents||[])if(i.status==='submitted')add('purchase_intent',i,'购买意愿待门店核价','本店前台核对本人选择的实际项目和成交金额后提交审批',frontdeskFor(m,i.storeId));
 for(const s of m.state.scheduleChangeRequests||[])if(s.status==='pending')add('schedule_approval',s,'排班调整申请待本店老板审批','核对本人出诊及已有预约后批准或拒绝；原排班保持有效',storeOwner(m,s.storeId));
 if(['boss','franchise_owner'].includes(r.type))for(const review of m.state.reviews||[])if(review.followupStatus==='pending'){const service=m.state.services.find(s=>s.id===review.serviceId);if(service)add('review_followup',{...review,storeId:service.storeId},'服务反馈待老板跟进','本店老板本人回访并保存实际处理结果',storeOwner(m,service.storeId));}
 for(const receipt of m.state.receipts||[]){
  if(receipt.status==='pending_settlement')add('finance_settlement',receipt,'平台收款待实际结算到账','前台核对真实平台账单，取得金额批准后登记实际到账',frontdeskFor(m,receipt.storeId,receipt.recordedRole==='frontdesk'?receipt.recordedBy:null));
  if(['valid','pending_settlement','settled'].includes(receipt.status)&&['package','renewal'].includes(receipt.purpose)&&!receipt.packageId&&!receipt.parentId)add('finance_link',receipt,'原套餐收款尚未关联实际权益','本店老板核对原客户、门店和套餐后关联，保留原到账记录',storeOwner(m,receipt.storeId));
 }
 return clone(rows.sort((a,b)=>Number(b.overdue)-Number(a.overdue)||(a.dueAt||'9999').localeCompare(b.dueAt||'9999')));
}
