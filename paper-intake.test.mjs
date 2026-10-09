import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';

let api = {};
try { api = await import('./paper-intake.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const call = (name, ...args) => { assert.equal(typeof api[name], 'function', `${name} must implement the initial reception workflow`); return api[name](...args); };
const fresh = () => new DemoModel({ now: () => '2026-10-09T03:00:00.000Z' });
const boss = { type: 'boss', id: 'boss' }, front = { type: 'frontdesk', id: 'f1' }, owner = { type: 'therapist', id: 't1' };
const answers = { treatment: 'no', acuteInjury: 'no', lumbar: 'no', dislocation: 'no', gout: 'no', pregnancy: 'no', alcohol: 'no', osteoporosis: 'no', veins: 'no', breathing: 'no' };
const input = overrides => ({ clientId: 'c3', storeId: 'a', age: '32', problem: '跑步后右膝不适', goal: '能安心恢复跑步', bodyArea: '右膝', duration: '两周', impact: '上下楼不舒服', pain: '', sex: '', source: 'douyin', exercise: 'weekly_1_2', recentCare: '', surgery: '', allergies: '', emergencyName: '', emergencyPhone: '', guardianName: '', guardianPhone: '', safetyNotes: '', answers: { ...answers }, requestId: 'paper-create-1', ...overrides });
const unchanged = (model, fn, pattern) => { const before = JSON.stringify([model.state, model.sequence]); assert.throws(fn, pattern); assert.equal(JSON.stringify([model.state, model.sequence]), before); };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ctx = (model, role = front) => ({ model, role, esc, icon: () => '', fmt: { date: value => value, money: value => value }, filters: { storeId: 'a' } });

test('missing loaded collection is initialized without inventing real customer records', () => {
  const original = fresh(), model = new DemoModel({ state: original.state, now: original.now });
  call('ensurePaperIntakes', model); assert.deepEqual(model.state.paperIntakes, []);
  const preview = fresh(); call('ensurePaperIntakes', preview); assert.equal(preview.state.paperIntakes.length, 2);
  const before = JSON.stringify(preview.state); call('ensurePaperIntakes', preview); assert.equal(JSON.stringify(preview.state), before);
});

test('front desk saves client-stated information pending review without clinical or financial side effects', () => {
  const model = fresh(), before = JSON.stringify([model.state.clients, model.state.packages, model.state.receipts, model.state.services, model.state.tasks, model.state.reviews]);
  const row = call('savePaperIntake', model, input(), front);
  assert.equal(row.status, 'pending'); assert.equal(row.ownerId, 't1'); assert.equal(row.pain, null); assert.equal(row.createdBy, 'f1'); assert.equal(row.createdRole, 'frontdesk'); assert.equal(row.storeId, 'a');
  assert.equal(JSON.stringify([model.state.clients, model.state.packages, model.state.receipts, model.state.services, model.state.tasks, model.state.reviews]), before);
  assert.equal(model.state.audit.at(-1).type, 'paper_intake_created');
  row.problem = 'mutated'; row.answers.treatment = 'yes'; assert.equal(model.state.paperIntakes[0].problem, '跑步后右膝不适'); assert.equal(model.state.paperIntakes[0].answers.treatment, 'no');
  assert.equal('requestId' in row, false); assert.equal('inputKey' in row, false);
});

test('every safety question must be explicitly answered and unknown remains a review item', () => {
  const model = fresh();
  for (const change of [undefined, {}, { ...answers, acuteInjury: '' }, { ...answers, alcohol: 'false' }, { ...answers, lumbar: false }]) unchanged(model, () => call('savePaperIntake', model, input({ answers: change }), front), /确认|逐项|问题/);
  const row = call('savePaperIntake', model, input({ answers: { ...answers, acuteInjury: 'yes', lumbar: 'unknown' }, safetyNotes: '客户记不清检查结果' }), front);
  assert.deepEqual(row.attentionItems.map(item => item.key), ['acuteInjury', 'lumbar']);
  assert.deepEqual(row.attentionItems.map(item => item.answer), ['yes', 'unknown']); assert.equal(row.status, 'pending');
});

test('all no answers still require the responsible therapist to review', () => {
  const model = fresh(), row = call('savePaperIntake', model, input({ pain: '0' }), front);
  assert.equal(row.pain, 0); assert.deepEqual(row.attentionItems, []); assert.equal(row.status, 'pending');
  const markup = call('paperIntakeDialog', 'paper-intake-detail', row.id, ctx(model)).html;
  assert.match(markup, /待负责康复师复核/); assert.doesNotMatch(markup, /无风险|可以服务|允许治疗/);
});

test('minor intake requires a guardian and validated mobile contact', () => {
  const model = fresh();
  unchanged(model, () => call('savePaperIntake', model, input({ age: 15 }), front), /监护人/);
  unchanged(model, () => call('savePaperIntake', model, input({ age: 15, guardianName: '家长', guardianPhone: '123' }), front), /监护人|手机号/);
  const row = call('savePaperIntake', model, input({ age: 15, guardianName: '家长（示例）', guardianPhone: '13900000099' }), front);
  assert.equal(row.guardianName, '家长（示例）'); assert.equal(row.guardianPhone, '13900000099');
});

test('intake checks enforce real actors, authorized store and customer scope atomically', () => {
  const model = fresh();
  for (const role of [{ type: 'customer', id: 'c3' }, { type: 'boss', id: 'forged' }, { type: 'manager', id: 'missing' }, { type: 'therapist', id: 'missing' }]) unchanged(model, () => call('savePaperIntake', model, input(), role), /权限|老板|在职|康复师|店长/);
  unchanged(model, () => call('savePaperIntake', model, input({ clientId: 'c2', storeId: 'b' }), front), /权限|门店/);
  unchanged(model, () => call('savePaperIntake', model, input({ clientId: 'c5' }), owner), /权限|客户/);
  model.state.therapists.find(t => t.id === 't1').active = false;
  unchanged(model, () => call('savePaperIntake', model, input(), front), /负责人|康复师|停用/);
});

test('idempotent submissions return cloned records and changed request payload is rejected', () => {
  const model = fresh(), row = call('savePaperIntake', model, input(), front), before = JSON.stringify([model.state, model.sequence]);
  const again = call('savePaperIntake', model, input(), front); assert.equal(again.id, row.id); assert.equal(JSON.stringify([model.state, model.sequence]), before);
  unchanged(model, () => call('savePaperIntake', model, input({ goal: '变更目标' }), front), /提交|变化/);
});

test('professional review is only available to current active customer owner and preserves initial answers', () => {
  const model = fresh(), row = call('savePaperIntake', model, input({ answers: { ...answers, lumbar: 'unknown' } }), front);
  const review = { decision: 'assessment', nextStep: '先由康复师核对客户描述，再安排初次评估', notes: '已阅读客户自述', requestId: 'paper-review-1' };
  for (const role of [front, boss, { type: 'manager', id: 'm1' }, { type: 'therapist', id: 't3' }]) unchanged(model, () => call('reviewPaperIntake', model, row.id, review, role), /负责人|复核|权限/);
  const reviewed = call('reviewPaperIntake', model, row.id, review, owner);
  assert.equal(reviewed.status, 'reviewed'); assert.equal(reviewed.reviewedBy, 't1'); assert.equal(reviewed.review.decision, 'assessment'); assert.equal(reviewed.answers.lumbar, 'unknown');
  const before = JSON.stringify([model.state, model.sequence]); assert.equal(call('reviewPaperIntake', model, row.id, review, owner).id, row.id); assert.equal(JSON.stringify([model.state, model.sequence]), before);
  unchanged(model, () => call('reviewPaperIntake', model, row.id, { ...review, nextStep: '另一项安排' }, owner), /变化|提交/);
  unchanged(model, () => call('reviewPaperIntake', model, row.id, { ...review, requestId: 'new-review' }, owner), /已复核/);
});

test('rows are store scoped, internal tokens are removed, and customer sees none', () => {
  const model = fresh(); call('savePaperIntake', model, input(), front); call('savePaperIntake', model, input({ clientId: 'c2', storeId: 'b', requestId: 'b' }), { type: 'frontdesk', id: 'f2' });
  assert.equal(call('paperIntakeRows', model, boss).length, 2); assert.equal(call('paperIntakeRows', model, { type: 'manager', id: 'm1', storeId: 'b' }).length, 1);
  assert.equal(call('paperIntakeRows', model, front).length, 1); assert.equal(call('paperIntakeRows', model, owner).length, 1); assert.deepEqual(call('paperIntakeRows', model, { type: 'therapist', id: 't3' }), []);
  assert.deepEqual(call('paperIntakeRows', model, { type: 'customer', id: 'c3' }), []);
  const rows = call('paperIntakeRows', model, front); rows[0].answers.alcohol = 'yes'; assert.equal(model.state.paperIntakes[0].answers.alcohol, 'no'); assert.equal('requestId' in rows[0], false);
  unchanged(model, () => call('paperIntakeDialog', 'paper-intake-detail', model.state.paperIntakes[1].id, ctx(model)), /权限/);
});

test('invalid ages, pain score, optional phone and clock never advance sequence or save partial data', () => {
  const model = fresh();
  for (const patch of [{ age: '' }, { age: -1 }, { age: 121 }, { pain: -1 }, { pain: 11 }, { pain: '2.5' }, { source: 'invented' }, { emergencyPhone: 'bad' }, { problem: '' }]) unchanged(model, () => call('savePaperIntake', model, input(patch), front), /年龄|疼痛|来源|手机号|问题/);
  model.now = () => 'invalid'; unchanged(model, () => call('savePaperIntake', model, input(), front), /时间|时钟/);
});

test('form inherits client identity, leaves safety questions unselected and has no professional measurements', () => {
  const model = fresh(), markup = call('paperIntakeDialog', 'paper-intake-create', 'c3', ctx(model)).html;
  assert.match(markup, /周沐/); assert.match(markup, /林予安/); assert.match(markup, /name="age"/); assert.match(markup, /name="goal"/); assert.match(markup, /name="pain"/);
  assert.equal((markup.match(/data-safety-question=/g) || []).length, 10); assert.equal((markup.match(/type="radio"/g) || []).length, 30); assert.doesNotMatch(markup, /checked|肌力测试|关节活动度|name="diagnosis"/);
  assert.match(markup, /监护人/); assert.match(markup, /保存.*复核/);
});

test('boss inbox surfaces pending count, client question and attention items without background history', () => {
  const model = fresh(); call('savePaperIntake', model, input({ surgery: '完整手术史不应堆首页', allergies: '敏感细节', answers: { ...answers, acuteInjury: 'yes' } }), front);
  const markup = call('renderPaperIntakeInbox', ctx(model, boss));
  assert.match(markup, /周沐/); assert.match(markup, /右膝/); assert.match(markup, /急性损伤/); assert.match(markup, /林予安/); assert.doesNotMatch(markup, /完整手术史不应堆首页|敏感细节/);
  assert.equal(call('renderPaperIntakeInbox', ctx(model, { type: 'customer', id: 'c3' })), '');
});

test('audit entries use the existing application schema with stable actor and valid timestamp', () => {
  const model = fresh(), row = call('savePaperIntake', model, input(), front), created = model.state.audit.at(-1);
  assert.equal(created.type, 'paper_intake_created'); assert.equal(created.actorId, 'f1'); assert.equal(created.actorType, 'frontdesk'); assert.equal(created.createdAt, '2026-10-09T03:00:00.000Z');
  call('reviewPaperIntake', model, row.id, { decision: 'contact', nextStep: '先核对情况', requestId: 'review-schema' }, owner);
  const reviewed = model.state.audit.at(-1); assert.equal(reviewed.type, 'paper_intake_reviewed'); assert.equal(reviewed.actorId, 't1'); assert.equal(reviewed.createdAt, '2026-10-09T03:00:00.000Z');
});

test('loaded nested records are projected through a whitelist instead of exposing internal requests', () => {
  const model = fresh(), row = call('savePaperIntake', model, input(), front);
  Object.assign(model.state.paperIntakes[0], { status: 'reviewed', review: { decision: 'contact', nextStep: '核对', notes: '说明', requestId: 'private-review-token' } });
  model.state.paperIntakes[0].answers.privateKey = 'private-answer-token';
  const visible = call('paperIntakeRows', model, boss)[0];
  assert.deepEqual(Object.keys(visible.review).sort(), ['decision', 'nextStep', 'notes']); assert.equal('privateKey' in visible.answers, false);
  assert.doesNotMatch(JSON.stringify(visible), /private-review-token|private-answer-token/);
});

test('cross-store reception is visible and reviewable to the current owner without widening other therapist access', () => {
  const model = fresh(), row = call('savePaperIntake', model, input({ clientId: 'c1', storeId: 'b' }), { type: 'frontdesk', id: 'f2' });
  assert.equal(call('paperIntakeRows', model, owner)[0].id, row.id);
  assert.deepEqual(call('paperIntakeRows', model, { type: 'therapist', id: 't2' }), []);
  const reviewed = call('reviewPaperIntake', model, row.id, { decision: 'assessment', nextStep: '负责人联系崂山前台安排', requestId: 'cross-review' }, owner);
  assert.equal(reviewed.status, 'reviewed'); assert.equal(reviewed.storeId, 'b');
  unchanged(model, () => call('savePaperIntake', model, input({ clientId: 'c1', storeId: 'b', requestId: 'owner-cross-create' }), owner), /门店|权限/);
});

test('a later visit adds a new dated record with fresh answers and preserves earlier history', () => {
  const model = fresh(), first = call('savePaperIntake', model, input(), front);
  call('reviewPaperIntake', model, first.id, { decision: 'assessment', nextStep: '完成评估', requestId: 'first-review' }, owner);
  model.today = '2026-10-09';
  const second = call('savePaperIntake', model, input({ requestId: 'second-visit', answers: { ...answers, alcohol: 'unknown' } }), front);
  assert.notEqual(second.id, first.id); assert.equal(second.date, '2026-10-09'); assert.equal(second.status, 'pending'); assert.equal(second.answers.alcohol, 'unknown');
  assert.equal(model.state.paperIntakes[0].date, '2026-10-08'); assert.equal(model.state.paperIntakes[0].answers.alcohol, 'no');
});

test('loaded paper identifiers are included when allocating new records', () => {
  const original = fresh(); call('savePaperIntake', original, input(), front); original.state.paperIntakes[0].id = 'paper999';
  const loaded = new DemoModel({ state: original.state, now: original.now, sequence: 0 });
  const row = call('savePaperIntake', loaded, input({ requestId: 'after-load' }), front);
  assert.equal(row.id, 'paper1000'); assert.equal(new Set(loaded.state.paperIntakes.map(r => r.id)).size, 2);
});

test('stopped or newly unrelated therapist cannot replay a professional review', () => {
  const model = fresh(), row = call('savePaperIntake', model, input(), front), data = { decision: 'assessment', nextStep: '完成专业评估', requestId: 'stop-review' };
  model.state.therapists.find(t => t.id === 't1').active = false;
  unchanged(model, () => call('reviewPaperIntake', model, row.id, data, owner), /停用|权限|在职/);
  model.state.therapists.find(t => t.id === 't1').active = true; model.state.clients.find(c => c.id === 'c3').ownerId = 't3';
  unchanged(model, () => call('reviewPaperIntake', model, row.id, data, owner), /权限/);
});

test('all authorized operating roles can open a complete list directly from their pending inbox', () => {
  const model = fresh(); call('ensurePaperIntakes', model);
  for (const role of [boss, front, owner, { type: 'manager', id: 'm1' }]) {
    const context = ctx(model, role), inbox = call('renderPaperIntakeInbox', context);
    assert.match(inbox, /data-action="paper-intake-list"/);
    const list = call('paperIntakeDialog', 'paper-intake-list', '', context);
    assert.match(list.html, /data-form="paper-intake-select"/);
    assert.match(list.html, /周沐/);
  }
  unchanged(model, () => call('paperIntakeDialog', 'paper-intake-list', '', ctx(model, { type: 'customer', id: 'c3' })), /权限/);
});

test('form state clearly requires guardian fields and unanswered questions, without silently selecting no', () => {
  const model = fresh(), age = { value: '15' }, guardian = { hidden: true }, notes = { hidden: true }, hint = {}, submit = {}, guardianFields = [{ required: false }, { required: false }];
  const form = { dataset: { form: 'paper-intake-create' }, elements: { age }, querySelector: key => ({ '[data-paper-guardian]': guardian, '[data-paper-safety-notes]': notes, '[data-paper-safety-hint]': hint, '[type="submit"]': submit }[key]), querySelectorAll: () => guardianFields };
  call('updatePaperIntakeForm', form, ctx(model)); assert.equal(guardian.hidden, false); assert.ok(guardianFields.every(field => field.required)); assert.equal(submit.disabled, true); assert.match(hint.textContent, /10/);
  for (const key of Object.keys(answers)) form.elements[`answer_${key}`] = { value: 'no' };
  age.value = '32'; call('updatePaperIntakeForm', form, ctx(model)); assert.equal(guardian.hidden, true); assert.ok(guardianFields.every(field => !field.required)); assert.equal(submit.disabled, false); assert.equal(notes.hidden, true); assert.match(hint.textContent, /仍须/);
  form.elements.answer_alcohol.value = 'unknown'; call('updatePaperIntakeForm', form, ctx(model)); assert.equal(notes.hidden, false); assert.match(hint.textContent, /1 项/);
  form.dataset.busy = 'true'; call('updatePaperIntakeForm', form, ctx(model)); assert.equal(submit.disabled, true);
});

test('client-specific record view cannot mix another customer and preselects the intended customer', () => {
  const model = fresh(); call('ensurePaperIntakes', model);
  const context = { ...ctx(model, boss), filters: { storeId: '', clientId: 'c3' } };
  const markup = call('renderPaperIntakeList', context);
  assert.match(markup, /value="c3" selected/); assert.match(markup, /周沐/); assert.doesNotMatch(markup, /许安然|value="c2"|paper-demo-b/);
});

test('pending inbox follows a valid selected store while owner keeps their own cross-store followups', () => {
  const model = fresh(); call('ensurePaperIntakes', model);
  const selectedBoss = { ...ctx(model, boss), filters: { storeId: 'b' } };
  const filtered = call('renderPaperIntakeInbox', selectedBoss);
  assert.match(filtered, /许安然/); assert.doesNotMatch(filtered, /周沐|paper-demo-a/);
  const all = call('renderPaperIntakeInbox', { ...ctx(model, boss), filters: { storeId: '' } }); assert.match(all, /许安然/); assert.match(all, /周沐/);
  model.state.frontDesks.find(f => f.id === 'f1').storeIds.push('b');
  const selectedFront = call('renderPaperIntakeInbox', { ...ctx(model), filters: { storeId: 'b' } }); assert.match(selectedFront, /许安然/); assert.doesNotMatch(selectedFront, /周沐/);
  call('savePaperIntake', model, input({ clientId: 'c1', storeId: 'b', requestId: 'cross-owner-inbox' }), { type: 'frontdesk', id: 'f2' });
  const ownerView = call('renderPaperIntakeInbox', { ...ctx(model, owner), filters: { storeId: 'b' } }); assert.match(ownerView, /陈一诺/); assert.match(ownerView, /周沐/); assert.doesNotMatch(ownerView, /许安然/);
});

test('create form honors selected authorized store without adding a single-store front desk privilege', () => {
  const model = fresh();
  const bossForm = call('paperIntakeDialog', 'paper-intake-create', 'c1', { ...ctx(model, boss), filters: { storeId: 'b' } }).html;
  assert.match(bossForm, /value="b" selected/); assert.doesNotMatch(bossForm, /value="a" selected/);
  model.state.frontDesks.find(f => f.id === 'f1').storeIds.push('b');
  const frontForm = call('paperIntakeDialog', 'paper-intake-create', 'c1', { ...ctx(model), filters: { storeId: 'b' } }).html;
  assert.match(frontForm, /value="b" selected/);
  model.state.frontDesks.find(f => f.id === 'f1').storeIds = ['a'];
  const singleForm = call('paperIntakeDialog', 'paper-intake-create', 'c1', { ...ctx(model), filters: { storeId: 'b' } }).html;
  assert.match(singleForm, /value="a" selected/); assert.doesNotMatch(singleForm, /value="b"/);
});

test('detail displays recording and review times in Chinese Shanghai local time without ISO timestamps', () => {
  const model = fresh(), row = call('savePaperIntake', model, input(), front);
  model.now = () => '2026-10-09T04:15:00.000Z';
  call('reviewPaperIntake', model, row.id, { decision: 'assessment', nextStep: '安排专业评估', requestId: 'human-time-review' }, owner);
  const detail = call('paperIntakeDialog', 'paper-intake-detail', row.id, ctx(model, boss)).html;
  assert.match(detail, /2026年10月9日 11:00/); assert.match(detail, /2026年10月9日 12:15/);
  assert.doesNotMatch(detail, /2026-10-09T03:00:00.000Z|2026-10-09T04:15:00.000Z/);
});
