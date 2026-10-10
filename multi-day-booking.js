import {requestCustomerBooking,customerBookingRows} from './customer-booking.js?v=20261010-multi-day-booking-1';
import {bookingAvailability} from './booking-availability.js?v=20261010-multi-day-booking-1';
const clone=value=>JSON.parse(JSON.stringify(value));
const appointmentFields=['id','clientId','storeId','date','time','principalId','project','status'];
const safeAppointment=row=>clone(Object.fromEntries(appointmentFields.map(key=>[key,row[key]])));
const required=(value,label,max=80)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`请填写有效的${label}`);return value.trim();};
function day(value){const date=required(value,'预约日期',10),stamp=Date.parse(`${date}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)throw new Error('请选择有效日期');return date;}
function hour(value){const time=required(value,'开始时间',5);if(!/^([01]\d|2[0-3]):(00|30)$/.test(time))throw new Error('请选择整点或半点开始时间');return time;}
function authorize(model,input,row,role){
 if(role?.type==='customer'){if(input.clientId!==role.id)throw new Error('仅能为客户本人预约');model._client(role.id);}
 else if(role?.type==='manager')model._managerBookingActor(role,input.clientId,input.storeId,row.principalId);
 else model._bookingActor(role,input.clientId,input.storeId);
 const store=model._store(input.storeId);if(store.active===false)throw new Error('该门店已停用');
 const person=model._therapist(row.principalId);
 if(!model._therapistClientWorkAllowed(person.id,input.clientId,input.storeId))throw new Error('此康复师没有客户在本店的服务权限，请联系门店安排');
}
function originalRecord(row,input,index){const expected={clientId:input.clientId,storeId:input.storeId,project:input.project,...input.items[index]};if(!row||Object.keys(expected).some(key=>row[key]!==expected[key]))throw new Error(`原批第 ${index+1} 天关联或安排已变化，请查看最新单次记录，不能重放原批提交`);}
function results(model,ids,role,mode,input){
 if(!Array.isArray(ids)||ids.length!==input.items.length)throw new Error('原批预约关联不完整，请联系老板核对');
 if(mode==='pending'){
  const visible=customerBookingRows(model,role);return ids.map((id,index)=>{const row=visible.find(item=>item.id===id);if(!row)throw new Error('原预约申请不完整或已超出权限，请联系老板核对');originalRecord(row,input,index);authorize(model,{...input,clientId:row.clientId,storeId:row.storeId},row,role);return row;});
 }
 return ids.map((id,index)=>{const row=model.state.appointments.find(item=>item.id===id);if(!row)throw new Error('原预约记录不完整，请联系老板核对');originalRecord(row,input,index);authorize(model,{...input,clientId:row.clientId,storeId:row.storeId},row,role);return safeAppointment(row);});
}

// Reuses the existing appointment/request/audit collections. No recurrence rule
// is inferred: every chosen date is a separate 60-minute appointment or request.
export function saveMultiDayBooking(model,data,role){
 if(!data||typeof data!=='object'||Object.hasOwn(data,'id'))throw new Error('一次约多天仅能新建预约，不能传入已有预约标识');
 if(Object.keys(data).some(key=>!['clientId','storeId','project','items','requestId'].includes(key)))throw new Error('一次约多天包含不支持的字段，本批未保存');
 if(!Array.isArray(data.items)||data.items.length<2||data.items.length>14)throw new Error('一次请选择 2 至 14 个不同日期，本批未保存');
 const input={clientId:required(data.clientId??(role?.type==='customer'?role.id:''),'客户'),storeId:required(data.storeId,'服务门店'),project:required(data.project,'服务项目',120),items:[]};
 const requestId=required(data.requestId,'提交标识',60);
 for(let index=0;index<data.items.length;index++){
  try{const row=data.items[index];if(!row||typeof row!=='object'||Object.keys(row).some(key=>!['date','time','principalId'].includes(key)))throw new Error('每天仅选择日期、时间和康复师，不能修改客户、门店或已有预约');input.items.push({date:day(row.date),time:hour(row.time),principalId:required(row.principalId,'服务康复师')});authorize(model,input,input.items[index],role);}
  catch(error){throw new Error(`请调整第 ${index+1} 天：${error.message}。本批未保存`);}
 }
 if(new Set(input.items.map(row=>row.date)).size!==input.items.length)throw new Error('日期重复，请每一天只选一次。本批未保存');
 const inputKey=JSON.stringify(input),mode=role.type==='customer'?'pending':'confirmed';
 const previous=model.state.audit.find(row=>row.type==='multi_day_booking_saved'&&row.actorId===role.id&&row.actorType===role.type&&row.requestId===requestId);
 if(previous){if(previous.inputKey!==inputKey)throw new Error('同一提交请求的内容发生变化，请重新打开一次约多天。本批未保存');const items=results(model,previous.recordIds,role,previous.mode,input);return {count:items.length,items};}
 const stamp=model._timestamp();
 const staged=Object.assign(Object.create(Object.getPrototypeOf(model)),model,{now:()=>stamp,state:{...model.state,appointments:[...model.state.appointments],bookingRequests:(model.state.bookingRequests||[]).map(clone),tasks:model.state.tasks.map(clone),audit:[...model.state.audit]}});
 const rows=input.items.map((item,index)=>{
  try{
   if(item.date<model.today)throw new Error('不能选择过去的日期');
   const slot={clientId:input.clientId,storeId:input.storeId,project:input.project,...item};
   const availability=bookingAvailability(staged,slot);if(!availability.available)throw new Error(availability.message);
   if(mode==='pending'){const row=requestCustomerBooking(staged,{...slot,requestId:`${requestId}:day:${index+1}`},role);if(row.status!=='pending')throw new Error('此提交标识已用于处理过的申请，请重新打开预约填写');return row;}
   return safeAppointment(staged.saveAppointment(slot,role));
  }catch(error){throw new Error(`请调整第 ${index+1} 天：${error.message}。本批未保存`);}
 });
 staged._log('multi_day_booking_saved',{clientId:input.clientId,storeId:input.storeId,requestId,inputKey,mode,recordIds:rows.map(row=>row.id),count:rows.length},role);
 model.state=staged.state;model.sequence=staged.sequence;
 return {count:rows.length,items:rows};
}
