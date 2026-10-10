// A shared reception queue grants basic appointment access, never chart/finance access.
import {hourTimeField} from './hour-picker.js?v=20261011-assessor-reception-cancel-3';
import {paperIntakeDialog} from './paper-intake.js?v=20261011-assessor-reception-cancel-3';
import {assessmentRows} from './evaluations.js?v=20261011-assessor-reception-cancel-3';
export function renderStaffReception(ctx){
 const {model,role,esc}=ctx;model.assertAppointmentStaff(role);
 const name=(kind,id)=>model.state[kind]?.find(p=>p.id===id)?.name||'历史人员';
 const action=(label,type,id)=>`<button type="button" class="btn btn-outline" data-action="${type}" data-id="${esc(id)}">${label}</button>`;
 const rows=model.appointmentReceptionRows(role).filter(a=>['confirmed','reschedule_requested','pending_reassignment'].includes(a.status)||a.date>=model.today).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
 const ownAssessments=assessmentRows(model,role).filter(a=>a.status==='pending'&&model.isAssignedAssessor(role,a.assessorId,a.storeId));
 const ownIntakes=(model.state.paperIntakes||[]).filter(p=>p.status==='pending'&&model.isAssignedAssessor(role,p.assessorId,p.storeId));
 return `<section class="boss-panel"><div class="section-head"><h2>预约与到店接待 · 两店协同</h2>${action('新建预约','staff-booking-create','')}</div><p class="meta">所有在职工作人员可核对预约、确认客户申请与接待。先确认预约，再确认今天实际到店，再填写本次初访表；财务、评分、照片和历史专业档案仍按原权限查看。</p><div class="ease-service-list">${rows.map(a=>`<article class="ease-service-card"><div class="section-head"><h3>${esc(a.clientName)} · ${esc(a.date)} ${esc(a.time)}</h3><span class="tag">${model.state.appointments.find(row=>row.id===a.id)?.cancellationRequest?.status==='pending'?'取消待处理 / 审批':a.status==='cancelled'?'已取消':a.status==='completed'?'已服务':a.status==='no_show'?'未到店':a.status==='pending_reassignment'?'人员待安排':a.arrivalAt?'已到店':'待到店'}</span></div><p class="meta">${esc(name('stores',a.storeId))} · 治疗师 ${esc(name('therapists',a.principalId))} · 手机号 ${esc(a.phone||'待补充')}</p><div class="action-row">${a.date===model.today&&!a.arrivalAt&&!model.state.appointments.find(row=>row.id===a.id)?.cancellationRequest?.status?.includes('pending')&&['confirmed','reschedule_requested'].includes(a.status)?action('到店接待','staff-arrival',a.id):''}${a.date===model.today&&a.arrivalAt&&!model.state.appointments.find(row=>row.id===a.id)?.cancellationRequest?.status?.includes('pending')&&['confirmed','reschedule_requested'].includes(a.status)?action('填写本次初访表','staff-intake-create',a.id):''}${(()=>{const row=model.state.appointments.find(row=>row.id===a.id),p=model.cancellationPermissions(role,row);return row.cancellationRequest?.status==='pending'?(p.canHandle?action('处理取消申请','appointment-cancel-handle',a.id):'<span class="meta">原时段保留，取消申请待授权人员处理</span>'):p.canCancel?action(p.requiresApproval?'申请取消（须批准）':'取消预约','appointment-cancel',a.id):'';})()}${action('核对预约','staff-appointment',a.id)}</div></article>`).join('')||'<p class="empty">暂无已确认待接待预约；客户申请须先明确确认。</p>'}</div>${ownIntakes.map(p=>action('复核本人评估接待 · '+name('clients',p.clientId),'paper-intake-review',p.id)).join('')}${ownAssessments.map(a=>action('确认本人评估 · '+name('clients',a.clientId),'assessment-confirm',a.id)).join('')}<div class="action-row">${(model.state.paperIntakes||[]).filter(p=>model.isAssignedAssessor(role,p.assessorId,p.storeId)).map(p=>action('登记本次本人评估 · '+name('clients',p.clientId),'staff-assessment-create',p.clientId+':'+p.storeId)).join('')}${model.state.clients.flatMap(c=>model.state.stores.filter(st=>model.isAssignedAssessor(role,c.assessorId,st.id)).map(st=>action('登记本人评估 · '+c.name+' · '+st.name,'staff-assessment-create',c.id+':'+st.id))).join('')}</div></section>`;
}
export function staffReceptionDialog(type,id,ctx){
 if(type==='staff-booking-create'){
  const {model,role,esc}=ctx;model.assertAppointmentStaff(role);
  const ids=new Set([...model.state.appointments,...(model.state.bookingRequests||[])].map(a=>a.clientId));
  const clients=model.state.clients.filter(c=>ids.has(c.id)||model.canSeeClient(role,c.id));
  return {title:'新建预约',html:`<form data-form="appointment-create" data-staff-reception="true"><p class="notice">为已接待或已申请预约的客户新建本次安排。请核对客户本人、门店、治疗师与排班；不改变既有预约、不收款、不扣次。</p><div class="form-grid"><label class="field"><span>客户</span><select name="clientId" required>${clients.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><label class="field"><span>服务门店</span><select name="storeId" required>${model.state.stores.filter(st=>st.active!==false).map(st=>`<option value="${esc(st.id)}">${esc(st.name)}</option>`).join('')}</select></label><label class="field"><span>预约日期</span><input name="date" type="date" min="${esc(model.today)}" required></label><label class="field"><span>本次主治疗师</span><select name="principalId" required><option value="">预约时选择服务治疗师</option></select></label>${hourTimeField('',esc,'开始时间')}<label class="field"><span>服务项目</span><input name="project" value="基础训练" required maxlength="120"></label></div><p data-booking-availability></p><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="submit" class="btn btn-primary">确认新建预约</button></div></form>`};
 }
 if(!['staff-arrival','staff-intake-create','staff-appointment'].includes(type))return null;
 const a=ctx.model.receptionAppointment(ctx.role,id,{arrived:type==='staff-intake-create'}),c=ctx.model._client(a.clientId),esc=ctx.esc;
 if(type==='staff-intake-create')return paperIntakeDialog('paper-intake-create',a.clientId,{...ctx,receptionAppointment:a.id,filters:{...ctx.filters,storeId:a.storeId}});
 if(type==='staff-arrival')return {title:'到店接待',html:`<form data-form="record-arrival"><input type="hidden" name="id" value="${esc(a.id)}"><p>${esc(c.name)} · ${esc(a.date)} ${esc(a.time)}</p><p class="notice">请确认客户实际已经到店。此操作不收款、不扣次；保存后可填写本次初访表。</p><label class="field"><span>接待备注（选填）</span><textarea name="notes" maxlength="500"></textarea></label><div class="dialog-footer"><button type="submit" class="btn btn-primary">确认已到店</button></div></form>`};
 return {title:'预约基本信息',html:`<p>${esc(c.name)} · ${esc(c.phone||'待补充')}</p><p>${esc(a.date)} ${esc(a.time)} · ${esc(ctx.model._store(a.storeId).name)} · ${esc(a.status)}</p><p class="meta">此接待入口仅开放预约必要信息。服务资料按原权限查看。</p>`};
}
export function updateAssessorChoices(form,ctx){
 if(!form?.elements.assessorId||!['reception-create-client','paper-intake-create','assessment-create'].includes(form.dataset.form))return;
 const select=form.elements.assessorId,prior=select.value,storeId=form.elements.storeId?.value;
 const people=ctx.model.assessorRows(storeId),valid=people.some(p=>p.id===prior),selected=valid?prior:'tao';
 select.innerHTML=people.map(p=>`<option value="${ctx.esc(p.id)}">${ctx.esc(p.name)}</option>`).join('');select.value=selected;
 const label=form.querySelector?.('[data-paper-assessor-name]');if(label)label.textContent=people.find(p=>p.id===selected)?.name||'王勤涛';
}

export function restoreAssessorDraft(form,saved,ctx){
 if(!form?.elements.assessorId||!Array.isArray(saved?.entries))return;
 updateAssessorChoices(form,ctx);
 const desired=saved.entries.find(entry=>entry[0]==='assessorId')?.[1];
 if(ctx.model.assessorRows(form.elements.storeId.value).some(p=>p.id===desired))form.elements.assessorId.value=desired;
 updateAssessorChoices(form,ctx);
}
