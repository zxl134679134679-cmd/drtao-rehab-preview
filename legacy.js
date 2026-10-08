import { LEGACY_HEADERS, previewLegacyCSV } from './legacy-v20261009/legacy-import.js';
import { mapFormCommand } from './legacy-v20261009/form-commands.js';
export { LEGACY_HEADERS };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"';
const csvRows = rows => '\uFEFF' + rows.map(cells => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
export const legacyTemplateCSV = () => csvRows([LEGACY_HEADERS]);
export function legacyExampleCSV(model) {
  const first = model.state.therapists.find(person => person.active), second = model.state.therapists.find(person => person.active && person.storeId !== first?.storeId) || first;
  if (!first || !second) throw new Error('请先添加示例门店和有效康复师');
  const store = person => model.state.stores.find(value => value.id === person.storeId)?.name || '';
  return csvRows([LEGACY_HEADERS,
    ['虚构新客户甲', '13899090001', store(first), first.name, '虚构运动康复套餐', '3000', '10', '6', '虚构示例纸档甲，已核对剩余6次'],
    ['虚构新客户乙', '13899090002', store(second), second.name, '虚构运动康复套餐', '1000', '3', '1', '虚构示例纸档乙，已核对剩余1次'],
  ]);
}
export function checkLegacyCSV(text, model, role) {
  model._boss(role);
  return previewLegacyCSV(text, { role, revision: model.sequence, clients: model.state.clients, stores: model.state.stores, therapists: model.state.therapists });
}
export function applyLegacyPreview(model, preview, role) {
  model._boss(role);
  if (!preview?.canImport || preview.kind !== 'legacy-import-preview') throw new Error('请先检查并修正全部资料，再确认导入');
  if (preview.revision !== model.sequence) throw new Error('示例资料已有变化，请重新检查后再导入');
  const { payload } = mapFormCommand('import-opening-batch', [], { openingRows: preview.rows });
  const candidate = new model.constructor({ state: structuredClone(model.state), sequence: model.sequence, today: model.today,
    now: model.now, enforceServiceTime: model.enforceServiceTime, seed: false });
  const clientIds = [];
  for (const [index, input] of payload.rows.entries()) {
    try { clientIds.push(candidate.importOpening(input, role).id); }
    catch (error) { throw new Error(`第 ${index + 1} 行：${error.message}`); }
  }
  candidate._log('opening_import_batch', { importedCount: clientIds.length, clientIds, batchLabel: '虚构批量录入体验' }, role);
  return { model: candidate, importedCount: clientIds.length, clientIds };
}
export function legacyDialog({ model, role }) {
  model._boss(role);
  return { title: '表格批量录入旧客户', html: `<form data-form="import-opening-batch" class="legacy-form">
    <div class="legacy-warning"><strong>公开演示：禁止选择或粘贴真实客户资料。</strong><p>请下载虚构示例体验。文件仅在浏览器本地读取，不会上传；录入只在本次页面有效，刷新恢复示例。</p></div>
    <section class="legacy-step"><h3>1. 准备表格</h3><p class="muted">按9列模板填写，每批1–50位。金额、总次数和剩余次数不清楚时先核对，不填猜测值。</p><div class="action-row"><button type="button" class="btn btn-outline" data-legacy-action="template">下载空白 CSV 模板</button><button type="button" class="btn btn-outline" data-legacy-action="example-download">下载虚构示例</button><button type="button" class="text-link" data-legacy-action="example-fill">直接用虚构示例</button></div></section>
    <section class="legacy-step"><h3>2. 选择或粘贴 CSV</h3><label class="field"><span>选择 CSV UTF-8 文件（最多512KB）</span><input type="file" accept=".csv,text/csv" data-legacy-file></label><details class="legacy-paste" open><summary>手机也可以粘贴 CSV 内容</summary><label class="field"><span class="sr-only">虚构 CSV 内容</span><textarea data-legacy-csv rows="5" placeholder="粘贴包含9列表头的虚构CSV内容" spellcheck="false"></textarea></label></details><p class="meta">门店和康复师名称要与当前设置一致；重复手机号或家庭共用电话需要先人工核对。</p><button type="button" class="btn btn-outline" data-legacy-check data-legacy-action="check">先检查资料</button></section>
    <section class="legacy-preview" data-legacy-result aria-live="polite"><p class="muted">检查后显示每行结果；此时不会新增客户。</p></section>
    <p class="form-error" role="alert" hidden></p><label class="check legacy-confirm"><input type="checkbox" data-legacy-confirm disabled required><span>我已核对这批虚构资料，确认录入本次演示。</span></label>
    <div class="dialog-footer"><button type="button" class="btn btn-quiet" data-action="close-dialog">取消</button><button type="submit" class="btn btn-primary" data-legacy-submit disabled>检查通过后确认录入</button></div>
  </form>` };
}
function downloadCSV(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Local-only controller. Every async continuation checks the current dialog. */
export function mountLegacyForm({ form, getModel, getRole, isActive, applyModel, beforeCommit, onSuccess }) {
  const source = form.querySelector('[data-legacy-csv]'), fileInput = form.querySelector('[data-legacy-file]');
  const result = form.querySelector('[data-legacy-result]'), confirm = form.querySelector('[data-legacy-confirm]'), submit = form.querySelector('[data-legacy-submit]');
  const error = form.querySelector('.form-error');
  let preview = null, checkedText = '', generation = 0, disposed = false;
  const active = () => !disposed && isActive() && form.isConnected;
  const clearError = () => { error.hidden = true; error.textContent = ''; };
  const fail = message => { if (!active()) return; error.hidden = false; error.textContent = message; error.scrollIntoView({ block: 'nearest' }); };
  function invalidate() {
    generation++; preview = null; checkedText = ''; confirm.checked = false; confirm.disabled = true; submit.disabled = true;
    submit.textContent = '检查通过后确认录入'; clearError(); result.innerHTML = '<p class="muted">资料已变更，请先检查；不会自动保存。</p>';
  }
  function showPreview(value) {
    const issueRows = value.issues.map(issue => `<li><strong>第 ${issue.rowNumber} 行 · ${esc(issue.field)}</strong><span>${esc(issue.message)}</span></li>`).join('');
    const model = getModel(), name = (key, id) => model.state[key].find(row => row.id === id)?.name || '未设置';
    const validRows = value.rows.map(row => `<article class="legacy-client-row"><div><strong>${esc(row.name)}</strong><span>${esc(row.phone)}</span></div><p>${esc(name('stores', row.storeId))} · ${esc(name('therapists', row.ownerId))}</p><p>${esc(row.packageName)} · ¥${row.amount.toLocaleString('zh-CN')} / ${row.total}次 · <strong>剩余 ${row.remaining}次</strong></p></article>`).join('');
    result.innerHTML = `<div class="legacy-result-head"><h3>${value.canImport ? '全部检查通过' : '请先修正标出的资料'}</h3><span class="tag ${value.canImport ? 'tag-green' : 'tag-warn'}">${value.validCount} / ${value.sourceRowCount} 位通过</span></div>${issueRows ? `<ul class="legacy-issues">${issueRows}</ul>` : ''}${validRows ? `<div class="legacy-client-list">${validRows}</div>` : ''}<p class="meta">${value.canImport ? '尚未录入。核对后勾选确认；整批成功才新增客户。历史次数不计入消费业绩或实收。' : '有错误时整批不录入。修改表格后再次检查。'}</p>`;
    confirm.disabled = !value.canImport; submit.disabled = !value.canImport; submit.textContent = value.canImport ? `确认录入 ${value.rows.length} 位虚构客户` : '检查通过后确认录入';
  }
  function click(event) {
    const target = event.target.closest('[data-legacy-action]');
    if (!target || !active() || form.dataset.busy === 'true') return;
    event.preventDefault(); clearError();
    try {
      getModel()._boss(getRole());
      if (target.dataset.legacyAction === 'template') return downloadCSV(legacyTemplateCSV(), '涛博士_空白客户模板.csv');
      if (target.dataset.legacyAction === 'example-download') return downloadCSV(legacyExampleCSV(getModel()), '涛博士_虚构客户示例.csv');
      if (target.dataset.legacyAction === 'example-fill') { source.value = legacyExampleCSV(getModel()); fileInput.value = ''; invalidate(); return; }
      if (target.dataset.legacyAction === 'check') {
        invalidate(); preview = checkLegacyCSV(source.value, getModel(), getRole()); checkedText = source.value; showPreview(preview);
      }
    } catch (problem) { fail(problem.message); }
  }
  async function fileChange() {
    invalidate(); const token = generation, file = fileInput.files?.[0];
    if (!file || !active()) return;
    try {
      if (file.size > 512 * 1024 || !/\.csv$/i.test(file.name)) throw new Error('请选不超过512KB的CSV UTF-8文件，演示中只使用虚构资料');
      result.textContent = '正在本地读取虚构 CSV…';
      const text = await file.text();
      if (!active() || generation !== token) return;
      source.value = text; invalidate(); result.innerHTML = '<p class="muted">文件已在本地读取，请点击“先检查资料”。</p>';
    } catch (problem) { if (active() && generation === token) fail(problem.message); }
  }
  async function commit() {
    if (!active() || form.dataset.busy === 'true' || form.dataset.succeeded === 'true') return;
    try {
      getModel()._boss(getRole());
      if (!preview?.canImport || source.value !== checkedText) throw new Error('请先检查当前资料，通过后再确认');
      if (!confirm.checked) throw new Error('请先勾选已核对这批虚构资料');
      form.dataset.busy = 'true'; form.setAttribute('aria-busy', 'true'); clearError();
      const controls = [...form.querySelectorAll('input,textarea,button')].filter(control => control.dataset.action !== 'close-dialog');
      const previous = controls.map(control => control.disabled); controls.forEach(control => { control.disabled = true; }); submit.textContent = '正在整批录入…';
      try {
        await beforeCommit();
        if (!active()) return;
        if (source.value !== checkedText) throw new Error('资料已有变化，请重新检查');
        const outcome = applyLegacyPreview(getModel(), preview, getRole());
        if (!active()) return;
        applyModel(outcome.model); form.dataset.succeeded = 'true'; preview = null; onSuccess(outcome);
      } finally {
        if (active()) { controls.forEach((control, index) => { control.disabled = previous[index]; }); submit.textContent = preview?.canImport ? `确认录入 ${preview.rows.length} 位虚构客户` : '检查通过后确认录入'; }
        form.dataset.busy = 'false'; form.removeAttribute('aria-busy');
      }
    } catch (problem) { fail(problem.message); }
  }
  form.addEventListener('click', click); source.addEventListener('input', invalidate); fileInput.addEventListener('change', fileChange);
  return { submit: commit, destroy() { disposed = true; generation++; preview = null; checkedText = ''; source.value = ''; fileInput.value = ''; form.removeEventListener('click', click); source.removeEventListener('input', invalidate); fileInput.removeEventListener('change', fileChange); } };
}
