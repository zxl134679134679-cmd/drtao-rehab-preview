import { hourTimeField } from './hour-picker.js?v=20261009-daily-permissions';
import { receptionStores } from './reception.js?v=20261009-daily-permissions';

const limit = 20;
function clients(ctx) { return ctx.model.visibleClients(ctx.role); }
function memberRow(index, member, ctx) {
  const { esc, model } = ctx;
  const customer = clients(ctx).find(c => c.id === member.clientId);
  const eligible = model.state.therapists.filter(t => t.active && model.canSeeClient({ type:'therapist', id:t.id }, member.clientId));
  const principal = member.principalId || customer?.ownerId || '';
  return `<section class="booking-member" data-booking-member><div class="section-head"><h3>客户 ${index + 1}</h3><button type="button" class="text-link" data-action="booking-remove">移除</button></div><div class="form-grid"><label class="field"><span>客户 / 同行朋友</span><select name="memberClient_${index}" required data-booking-client aria-label="客户 ${index + 1}"><option value="">选择已建档客户</option>${clients(ctx).map(c => `<option value="${esc(c.id)}" ${c.id === member.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label class="field"><span>服务康复师</span><select name="memberPrincipal_${index}" required data-booking-principal aria-label="客户 ${index + 1} 的康复师"><option value="">${customer ? '选择康复师' : '先选择客户'}</option>${eligible.map(t => `<option value="${esc(t.id)}" ${t.id === principal ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label></div></section>`;
}

export function appointmentBatchDialog(id, ctx) {
  if (!['boss','frontdesk','therapist'].includes(ctx.role.type)) throw new Error('一起预约由前台、康复师或老板安排');
  const available = clients(ctx);
  if (available.length < 2) return { title:'一起预约', html:'<p class="notice">当前可安排的客户不足两位，请先由老板建好同行朋友的档案并指定负责康复师。</p>' };
  const first = available.find(c => c.id === id) || available[0];
  const stores = ctx.role.type === 'frontdesk' ? receptionStores(ctx) : ctx.model.state.stores;
  const selectedStore = stores.find(s => s.id === ctx.filters?.storeId) || stores.find(s => s.id === first.storeId) || stores[0];
  const { esc } = ctx;
  return { title:'客户与朋友一起预约', html:`<form data-form="appointment-batch"><p class="muted">同一时间到店，每人分别安排康复师。预约不扣套餐次数。</p><div class="form-grid"><label class="field"><span>服务门店</span><select name="storeId" required>${stores.map(s => `<option value="${esc(s.id)}" ${s.id === selectedStore?.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label><label class="field"><span>日期</span><input type="date" name="date" value="${esc(ctx.model.today)}" min="${esc(ctx.model.today)}" required></label>${hourTimeField('10:00',esc)}<label class="field"><span>服务项目</span><input name="project" value="康复评估与训练" required maxlength="120"></label></div><div class="booking-member-list" data-booking-members>${memberRow(0,{clientId:first.id},ctx)}${memberRow(1,{},ctx)}</div><button type="button" class="btn btn-outline booking-add" data-action="booking-add">再加一位同行客户</button><p class="meta">每位客户选择不同康复师。系统会统一检查时间冲突，有一人未通过，整组都不会保存。</p><p class="meta">朋友还没有档案？请先由老板建档并指定负责康复师，再一起预约。</p><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="btn btn-quiet" data-action="close-dialog">稍后再填写</button><button type="submit" class="btn btn-primary">确认 2 人预约</button></div></form>` };
}

export function restoreBookingDraft(form, saved, ctx) {
  if (form?.dataset.form !== 'appointment-batch' || !saved) return;
  const entries = new Map(saved.entries);
  const indices = [...entries.keys()].filter(k => /^memberClient_\d+$/.test(k)).map(k => Number(k.split('_')[1])).sort((a,b) => a-b);
  if (indices.length < 2 || indices.length > limit) return;
  form.querySelector('[data-booking-members]').innerHTML = indices.map((i,index) => memberRow(index,{clientId:entries.get(`memberClient_${i}`),principalId:entries.get(`memberPrincipal_${i}`)},ctx)).join('');
}

export function updateBookingMembers(form, ctx) {
  if (form?.dataset.form !== 'appointment-batch' || form.dataset.busy === 'true') return;
  const rows = [...form.querySelectorAll('[data-booking-member]')];
  const clientValues = rows.map(r => r.querySelector('[data-booking-client]').value);
  const principalValues = rows.map(r => r.querySelector('[data-booking-principal]').value);
  rows.forEach((row,index) => {
    row.querySelector('h3').textContent = `客户 ${index + 1}`;
    const client = row.querySelector('[data-booking-client]');
    const principal = row.querySelector('[data-booking-principal]');
    client.name = `memberClient_${index}`;
    client.setAttribute('aria-label',`客户 ${index + 1}`);
    principal.name = `memberPrincipal_${index}`;
    principal.setAttribute('aria-label',`客户 ${index + 1} 的康复师`);
    for (const option of client.options) option.disabled = Boolean(option.value && option.value !== client.value && clientValues.includes(option.value));
    const eligible = ctx.model.state.therapists.filter(t => t.active && ctx.model.canSeeClient({type:'therapist',id:t.id},client.value));
    const previous = principal.value;
    const occupied = principalValues.filter((_,i) => i !== index);
    const ownerId = ctx.model.state.clients.find(c => c.id === client.value)?.ownerId;
    const selected = eligible.some(t => t.id === previous) ? previous : eligible.find(t => t.id === ownerId && !occupied.includes(t.id))?.id || '';
    principal.innerHTML = `<option value="">${client.value ? '选择康复师' : '先选择客户'}</option>${eligible.map(t => `<option value="${ctx.esc(t.id)}" ${t.id === selected ? 'selected' : ''} ${occupied.includes(t.id) && t.id !== selected ? 'disabled' : ''}>${ctx.esc(t.name)}${occupied.includes(t.id) && t.id !== selected ? '（已选）' : ''}</option>`).join('')}`;
    row.querySelector('[data-action="booking-remove"]').disabled = rows.length <= 2 || form.dataset.busy === 'true';
  });
  // Include defaults just assigned to later rows when marking staff occupied.
  const selectedPrincipals = rows.map(row => row.querySelector('[data-booking-principal]').value);
  rows.forEach((row,index) => {
    const select = row.querySelector('[data-booking-principal]');
    for (const option of select.options) {
      if (!option.value) continue;
      option.disabled = option.value !== select.value && selectedPrincipals.some((value,i) => i !== index && value === option.value);
      option.textContent = `${ctx.model.state.therapists.find(t => t.id === option.value)?.name || '待安排'}${option.disabled ? '（已选）' : ''}`;
    }
  });
  form.querySelector('[data-action="booking-add"]').disabled = rows.length >= limit || form.dataset.busy === 'true';
  form.querySelector('button[type="submit"]').textContent = `确认 ${rows.length} 人预约`;
}

export function addBookingMember(form, ctx) {
  if (form?.dataset.form !== 'appointment-batch' || form.dataset.busy === 'true') return;
  const count = form.querySelectorAll('[data-booking-member]').length;
  if (count >= limit) throw new Error('一次最多安排20位客户');
  form.querySelector('[data-booking-members]').insertAdjacentHTML('beforeend',memberRow(count,{},ctx));
  updateBookingMembers(form,ctx);
}

export function removeBookingMember(row, form, ctx) {
  if (form?.dataset.form !== 'appointment-batch' || form.dataset.busy === 'true' || form.querySelectorAll('[data-booking-member]').length <= 2) return;
  row?.remove();
  updateBookingMembers(form,ctx);
}

export function bookingMembers(formData) {
  return [...formData.keys()].filter(k => /^memberClient_\d+$/.test(k)).sort((a,b) => Number(a.split('_')[1])-Number(b.split('_')[1]))
    .map(key => ({clientId:formData.get(key),principalId:formData.get(key.replace('memberClient_','memberPrincipal_'))}));
}
