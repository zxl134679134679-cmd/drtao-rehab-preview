import { dailyOperationsSummary } from './daily-operations.js?v=20261011-assessor-reception-cancel-3';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The host owns the date/store toolbar. Empty dates deliberately mean today,
// and employee filtering never changes the store's registered business totals.
export function renderDailyOperations(ctx, { compact = false } = {}) {
  if (!['boss', 'manager'].includes(ctx.role?.type)) return '';
  const filters = ctx.filters || {}, esc = ctx.esc || escape;
  const summary = dailyOperationsSummary(ctx.model, ctx.role, {
    storeId: filters.storeId || '', from: filters.from || '', to: filters.to || '',
  });
  const singleDay = summary.from === summary.to;
  const receptionUnit = singleDay && summary.storeIds.length === 1 ? '人' : '人次';
  const title = compact ? singleDay ? '每日员工工作' : '期间员工工作' : singleDay ? '每日店务' : '期间店务';
  const period = singleDay ? summary.from : `${summary.from} 至 ${summary.to}`;
  const scope = summary.storeIds.length === 1
    ? summary.stores.find(store => store.storeId === summary.storeIds[0])?.name || '所选门店'
    : '全部门店';
  const staffRows = summary.therapists.map(person => `<div class="boss-store-row daily-operations-row" data-daily-therapist="${esc(person.therapistId)}"><strong>${esc(person.name)}</strong><span>主服务 ${person.serviceCount} 次</span><span>协作 ${person.collaborationCount} 次</span></div>`).join('');
  const receptionRows = summary.frontDesks.map(person => `<div class="boss-store-row daily-operations-row" data-daily-frontdesk="${esc(person.frontDeskId)}"><strong>${esc(person.name)}</strong><span>实际接待 ${person.receptionCount} ${receptionUnit}</span><span>新建档 ${person.newClientCount} 份</span></div>`).join('');
  const frontReceptionCount = summary.frontDesks.reduce((sum, person) => sum + person.receptionCount, 0);
  const collaborationCount = summary.therapists.reduce((sum, person) => sum + person.collaborationCount, 0);
  const totals = compact ? '' : `<div class="boss-stats daily-operations-stats"><div class="boss-stat" data-daily-stat="net-income"><span>实际净到账</span><strong>${esc(money(summary.income.net))}</strong><small>收款 ${esc(money(summary.income.received))} − 退款 ${esc(money(summary.income.refunded))}</small></div><div class="boss-stat" data-daily-stat="service-count"><span>完成服务</span><strong>${summary.serviceCount}<small> 次</small></strong><small>实际服务已登记，协作不重复计算</small></div></div>`;
  return `<section class="boss-panel daily-operations-panel" aria-label="${esc(title)}"><div class="section-head"><div><h2>${esc(title)}</h2><p class="meta">${esc(scope)} · ${esc(period)}${!filters.from && !filters.to ? ' · 默认今日' : ''}</p></div></div>${totals}<details class="ease-work-notice daily-operations-therapists" aria-label="康复师工作量"><summary><strong>康复师工作</strong><span class="meta">主服务 ${summary.serviceCount} 次 · 协作 ${collaborationCount} 次</span><span class="daily-operations-detail-hint">查看每人明细 <span aria-hidden="true">⌄</span></span></summary><div class="ease-fold-body">${staffRows || '<p class="empty">该范围暂无康复师工作记录。</p>'}<p class="meta">按实际完成的服务统计，协作不重复计入主服务。</p></div></details><div class="daily-operations-frontdesk"><div class="section-head"><h3>前台实际接待</h3><span class="tag tag-green">${frontReceptionCount} ${receptionUnit}</span></div>${receptionRows || '<p class="empty">该范围暂无前台接待记录。</p>'}${summary.unassignedReception.receptionCount ? `<p class="meta">另有 ${summary.unassignedReception.receptionCount} ${receptionUnit}到店由老板登记或未归属前台，不计入上方前台接待人数。</p>` : ''}<p class="meta">新建档不代表到店；同一客户、同一门店、同一天接待只计一次。接待按各店每日去重累计。</p></div><p class="boss-panel-note daily-operations-note">实际净到账与消费业绩分别统计。小计仅来自实际登记，尚未登记的接待不计入。${filters.therapistId ? '店务按门店汇总，不受康复师筛选影响。' : ''}${ctx.role.type === 'manager' ? '店长仅查看本店工作。' : ''}</p></section>`;
}
