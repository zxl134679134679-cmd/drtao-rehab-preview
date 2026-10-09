import { assertScheduleAvailability, scheduleStatus } from './schedules.js?v=20261009-flow-ease';

const minutes = time => Number(time.slice(0,2))*60+Number(time.slice(3));
const pending = row => ['confirmed','reschedule_requested','pending_reassignment'].includes(row.status);
const halfHourStarts = Array.from({length:48},(_,slot)=>`${String(Math.floor(slot/2)).padStart(2,'0')}:${slot%2?'30':'00'}`);

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
  return model.state.therapists.filter(person=>person.active&&(model._therapistClientWorkAllowed?.(person.id,clientId,storeId) ?? (model.canSeeClient({type:'therapist',id:person.id},clientId)||model.clientStoreTherapist?.(clientId,storeId)===person.id))&&
    (date ? (scheduleStatus(model,person.id,date).storeId||person.storeId)===storeId : person.storeId===storeId));
}

export function updateAppointmentAvailability(form,ctx) {
  const type=form?.dataset.form;
  if(!['appointment-create','appointment-edit','appointment-batch','customer-booking','reschedule','customer-booking-resolve'].includes(type)||form.dataset.busy==='true')return;
  if(type==='customer-booking-resolve') {
    const suggesting=form.elements.outcome.value==='reschedule_suggested';
    const panel=form.querySelector('[data-booking-suggestion]');
    if(panel)panel.hidden=!suggesting;
    for(const control of [form.elements.date,form.elements.time]){control.disabled=!suggesting;control.required=suggesting;}
    const note=form.querySelector('[data-booking-availability]');
    if(note)note.hidden=!suggesting;
    if(!suggesting){const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=false;return;}
  }
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
    [{principalId:old?.principalId||data.principalId,clientId:type==='customer-booking'?ctx.role.id:old?.clientId||data.clientId||''}];
  let note=form.querySelector('[data-booking-availability]');
  if(!note){note=document.createElement('div');note.dataset.bookingAvailability='';note.className='booking-availability';note.setAttribute('role','status');const host=type==='customer-booking'?form.querySelector('[data-booking-step="2"]'):type==='customer-booking-resolve'?form.querySelector('[data-booking-suggestion]'):form;const footer=host.querySelector('.dialog-footer');host.insertBefore(note,footer||null);}
  const complete=Boolean(date&&storeId&&people.length&&people.every(person=>person.principalId&&person.clientId));
  const previous=timeSelect?.value||'';
  // Rebuild from the complete half-hour source each time. The native menu must
  // contain only usable starts, so removed options can return after a change.
  const available=complete?halfHourStarts.filter(time=>people.every(person=>bookingAvailability(model,{...person,storeId,date,time,excludeId:type==='customer-booking-resolve'?undefined:old?.id||data.id}).available)):[];
  const keep=Boolean(previous&&available.includes(previous));
  if(previous&&!keep)form.dataset.timeNeedsReselection='true';
  else if(keep)delete form.dataset.timeNeedsReselection;
  if(timeSelect) {
    const placeholder=!complete?'先选门店、日期和康复师':available.length?'请选择可预约时间':'当天没有可预约时间';
    timeSelect.innerHTML=`<option value="" disabled${keep?'':' selected'}>${esc(placeholder)}</option>${available.map(time=>`<option value="${time}"${previous===time?' selected':''}>${time}</option>`).join('')}`;
    timeSelect.value=keep?previous:'';
    timeSelect.disabled=!complete||!available.length;
  }
  if(!complete)note.innerHTML='<p>先选客户、门店、日期和康复师，再选班内时间。</p>';
  else {
    const summaries=people.map(person=>{
      const row=scheduleStatus(model,person.principalId,date),name=model.state.therapists.find(t=>t.id===person.principalId)?.name||'康复师';
      const shift=row.status==='work'?`${model.state.stores.find(s=>s.id===row.storeId)?.name||'门店'} · ${row.startTime}–${row.endTime}`:row.status==='rest'?'当天休息':'尚未排班，请联系店长';
      return `<p><strong>${esc(name)}</strong> · ${esc(shift)}</p>`;
    });
    const reselect=form.dataset.timeNeedsReselection==='true';
    const message=!available.length?'这一天没有可安排时段，请改选日期或康复师。':reselect?'原选时间已不可预约，请重新选择可预约时间。':'仅显示已确认排班内的可预约时间；本次服务按 60 分钟预留。';
    note.innerHTML=summaries.join('')+`<p class="${reselect||!available.length?'schedule-slot-warning':'meta'}">${esc(message)}</p>`;
  }
  const submit=form.querySelector('[type="submit"]');
  if(submit) {
    const firstStep=type==='customer-booking'&&Number(form.dataset.step||1)===1;
    submit.disabled=!firstStep&&(!complete||!available.length);
  }
}
