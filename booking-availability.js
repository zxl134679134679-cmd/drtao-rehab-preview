import { assertScheduleAvailability, scheduleStatus } from './schedules.js?v=20261009-finance-controls';

const minutes = time => Number(time.slice(0,2))*60+Number(time.slice(3));
const pending = row => ['confirmed','reschedule_requested','pending_reassignment'].includes(row.status);

export function bookingAvailability(model,input) {
  try {
    assertScheduleAvailability(model,input);
    const collision=model.state.appointments.some(row=>row.id!==input.excludeId&&pending(row)&&row.date===input.date&&
      (row.principalId===input.principalId||input.clientId&&row.clientId===input.clientId)&&Math.abs(minutes(row.time)-minutes(input.time))<60);
    if(collision)throw new Error('这个时段已有预约，请选择其他时间');
    return {available:true,message:''};
  } catch(error) {return {available:false,message:error.message};}
}

export function customerBookingTherapists(model,clientId,storeId,date='') {
  return model.state.therapists.filter(person=>person.active&&model.canSeeClient({type:'therapist',id:person.id},clientId)&&
    (date ? (scheduleStatus(model,person.id,date).storeId||person.storeId)===storeId : person.storeId===storeId));
}

export function updateAppointmentAvailability(form,ctx) {
  const type=form?.dataset.form;
  if(!['appointment-create','appointment-edit','appointment-batch','customer-booking','reschedule'].includes(type)||form.dataset.busy==='true')return;
  const data=Object.fromEntries(new FormData(form)),{model,esc}=ctx;
  const old=type==='reschedule'?model.state.appointments.find(row=>row.id===data.appointmentId):null;
  const storeId=old?.storeId||data.storeId,date=data.date,timeSelect=form.elements.time;
  if(type==='customer-booking') {
    const select=form.elements.principalId, people=customerBookingTherapists(model,ctx.role.id,storeId,date);
    const owner=model.state.clients.find(row=>row.id===ctx.role.id)?.ownerId,previous=select.value;
    const selected=people.find(row=>row.id===previous)?.id||people.find(row=>row.id===owner)?.id||people[0]?.id||'';
    select.innerHTML=`<option value="">${people.length?'选择服务康复师':'请联系门店安排康复师'}</option>${people.map(row=>`<option value="${esc(row.id)}"${row.id===selected?' selected':''}>${esc(row.name)}</option>`).join('')}`;
    data.principalId=selected;
  }
  const people=type==='appointment-batch'?[...form.querySelectorAll('[data-booking-member]')].map(row=>({principalId:row.querySelector('[data-booking-principal]').value,clientId:row.querySelector('[data-booking-client]').value})):
    [{principalId:old?.principalId||data.principalId,clientId:old?.clientId||data.clientId||ctx.role.id}];
  let note=form.querySelector('[data-booking-availability]');
  if(!note){note=document.createElement('div');note.dataset.bookingAvailability='';note.className='booking-availability';note.setAttribute('role','status');const host=type==='customer-booking'?form.querySelector('[data-booking-step="2"]'):form;const footer=host.querySelector('.dialog-footer');host.insertBefore(note,footer||null);}
  const complete=Boolean(date&&storeId&&people.length&&people.every(person=>person.principalId));
  if(!complete){note.innerHTML='<p>先选门店、日期和康复师，再选班内时间。</p>';for(const option of timeSelect?.options||[])option.disabled=false;}
  else {
    const summaries=people.map(person=>{
      const row=scheduleStatus(model,person.principalId,date),name=model.state.therapists.find(t=>t.id===person.principalId)?.name||'康复师';
      const shift=row.status==='work'?`${model.state.stores.find(s=>s.id===row.storeId)?.name||'门店'} · ${row.startTime}–${row.endTime}`:row.status==='rest'?'当天休息':'尚未排班，请联系店长';
      return `<p><strong>${esc(name)}</strong> · ${esc(shift)}</p>`;
    });
    for(const option of timeSelect?.options||[])option.disabled=Boolean(option.value&&people.some(person=>!bookingAvailability(model,{...person,storeId,date,time:option.value,excludeId:old?.id||data.id}).available));
    const invalid=data.time&&people.map(person=>bookingAvailability(model,{...person,storeId,date,time:data.time,excludeId:old?.id||data.id})).find(row=>!row.available);
    const hasTime=[...timeSelect?.options||[]].some(option=>option.value&&!option.disabled);
    note.innerHTML=summaries.join('')+`<p class="${invalid||!hasTime?'schedule-slot-warning':'meta'}">${esc(invalid?.message||(!hasTime?'这一天没有可安排时段，请改选日期或康复师。':'仅显示已确认排班内的可选时间；本次服务按 60 分钟预留。'))}</p>`;
  }
  const submit=form.querySelector('[type="submit"]');
  if(submit) {
    const firstStep=type==='customer-booking'&&Number(form.dataset.step||1)===1;
    const blocked=complete&&(![...timeSelect?.options||[]].some(option=>option.value&&!option.disabled)||Boolean(data.time&&people.some(person=>!bookingAvailability(model,{...person,storeId,date,time:data.time,excludeId:old?.id||data.id}).available)));
    submit.disabled=!firstStep&&(blocked||type==='customer-booking'&&Boolean(storeId)&&!people[0]?.principalId);
  }
}
