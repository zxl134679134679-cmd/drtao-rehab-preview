import { paperIntakeRows } from './paper-intake.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel, ensureStorePackageExamples } from './core.js';
import { workSummary, renderStaff, staffDialog } from './staff.js';
import { receptionStores } from './reception.js';
import { assessmentRows, frontDeskEvaluationRows, ensureEvaluations } from './evaluations.js';
import { customerBookingRows } from './customer-booking.js';

const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const boss = { type: 'boss', id: 'boss' };
const customer = { type: 'customer', id: 'c1' };
const secret = '只给老板的测试反馈';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx = (model, role, view = 'work') => ({ model, role, view, filters: {}, esc, icon: () => '' });
function fixture(score = 2, wantContact = false) {
  const model = new DemoModel({ now: () => '2026-10-09T04:00:00.000Z' });
  ensureEvaluations(model);
  const review = model.submitReview('s1', { score, feedback: secret, wantContact }, customer);
  return { model, review };
}
function originalFunction(name, next) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `找不到真实的 ${name} 函数`);
  return source.slice(start, end);
}
// Execute the real app readers/renderers. Only browser download and unrelated
// visual helpers are replaced; privacy decisions and model state remain real.
function appReaders(model, role) {
  let download;
  const find = (kind, id) => model.state[kind].find(r => r.id === id);
  const scope = {
    model, role, find, esc, name: (kind, id) => find(kind, id)?.name || id,
    date: v => v, money: v => `¥${v}`, pair: (k, v) => `<p>${esc(k)} ${esc(v)}</p>`,
    button: label => `<button>${esc(label)}</button>`, serviceEvidence: () => '',
    ctx: () => ctx(model, role), receptionStores, assessmentRows, frontDeskEvaluationRows, customerBookingRows, paperIntakeRows,
    Blob, URL: { createObjectURL: blob => { download = blob; return 'blob:test'; }, revokeObjectURL: () => {} },
    document: { createElement: () => ({ click() {} }) }, setTimeout: () => {}, toast: () => {},
  };
  vm.runInNewContext([
    source.match(/^const reviewFor = .*;$/m)[0],
    originalFunction('assertBoss', '\nfunction assertStaff'),
    originalFunction('assertService', '\nfunction toast'),
    originalFunction('serviceDialog', '\nfunction serviceEvidence'),
    originalFunction('exportPreview', '\n// Use the layout breakpoint'),
    'globalThis.readService = serviceDialog; globalThis.downloadRecords = exportPreview;',
  ].join('\n'), scope);
  return {
    service: id => scope.readService(id),
    export: async () => { scope.downloadRecords(); return JSON.parse(await download.text()).数据; },
  };
}

test('only the review author and the actual boss can read ratings, including collaboration and transferred clients', () => {
  const { model, review } = fixture();
  for (const score of [2, 5]) {
    review.score = score;
    assert.deepEqual(model.reviewRows(boss).map(r => r.id), [review.id]);
    assert.deepEqual(model.reviewRows(customer).map(r => r.id), [review.id]);
    for (const role of [
      ...['t1','t2','t3','t4','t5'].map(id => ({ type: 'therapist', id })),
      ...['f1','f2'].map(id => ({ type: 'frontdesk', id })),
      { type: 'customer', id: 'c2' }, { type: 'boss', id: 't1' }, undefined,
    ]) assert.deepEqual(model.reviewRows(role), [], JSON.stringify(role));
  }
  model.transferClient('c1', 't4', '更换负责康复师', boss);
  assert.deepEqual(model.reviewRows({ type: 'therapist', id: 't4' }), []);
  assert.deepEqual(model.reviewRows(customer).map(r => r.id), [review.id]);
});

test('actual service detail hides score, feedback and follow-up from owner, principal and collaborators', () => {
  const { model } = fixture();
  for (const id of ['t1','t2','t3']) {
    const html = appReaders(model, { type: 'therapist', id }).service('s1').html;
    assert.ok(html.includes('首次评估'));
    assert.ok(!html.includes(secret), id);
    assert.ok(!html.includes('客户评价'), id);
    assert.ok(!html.includes('待跟进'), id);
  }
  for (const role of [boss, customer]) assert.ok(appReaders(model, role).service('s1').html.includes(secret));
});

test('actual exports exclude other customers reviews and all employee rating records and legacy feedback tasks', async () => {
  const { model, review } = fixture();
  model.state.tasks.find(t => t.reviewId === review.id).assigneeId = 't1';
  for (const role of [
    ...['t1','t2','t3','t4','t5'].map(id => ({ type: 'therapist', id })),
    ...['f1','f2'].map(id => ({ type: 'frontdesk', id })),
    { type: 'customer', id: 'c2' },
  ]) {
    const data = await appReaders(model, role).export();
    assert.ok(!JSON.stringify(data).includes(secret), JSON.stringify(role));
    assert.ok(!JSON.stringify(data).includes(review.id), JSON.stringify(role));
    assert.equal((data.reviews || []).length, 0);
    assert.ok(!(data.tasks || []).some(t => t.type === 'review_followup'));
  }
  for (const role of [boss, customer]) {
    const data = await appReaders(model, role).export();
    assert.deepEqual(data.reviews.map(r => r.id), [review.id]);
  }
});

test('actual frontdesk export reports the authorized store sessions instead of another stores current package', async () => {
  const { model } = fixture();
  ensureStorePackageExamples(model);
  model.createStorePackage({clientId:'c1',storeId:'a',name:'麦岛加次套餐',amount:1200,total:3,requestId:'export-local-card'}, boss);
  assert.equal(model.remaining('c1'), 9, '当前套餐指针仍属于崂山店');
  assert.equal(model.remainingInStore('c1', 'a'), 13);
  const data = await appReaders(model, {type:'frontdesk',id:'f1'}).export();
  const client = data.clients.find(row => row.id === 'c1');
  assert.deepEqual(client.storeSessions, [{storeId:'a',storeName:'麦岛店',remainingSessions:13}]);
  assert.ok(!Object.hasOwn(client, 'remaining'), '不导出没有门店归属的余次');
  assert.ok(!JSON.stringify(data).includes(secret), '新投影不能暴露私密评价');
});

test('actual frontdesk export separates each authorized store and excludes an unassigned stores card', async () => {
  const { model } = fixture();
  ensureStorePackageExamples(model);
  const thirdStore = model.addStore({name:'待开第三店',address:'虚构门店地址'}, boss);
  model.createStorePackage({clientId:'c1',storeId:thirdStore.id,name:'第三店套餐',amount:5000,total:25,requestId:'export-third-card'}, boss);
  const frontdesk = model.addFrontDesk({name:'两店前台',storeIds:['a','b']}, boss);
  const data = await appReaders(model, {type:'frontdesk',id:frontdesk.id}).export();
  const client = data.clients.find(row => row.id === 'c1');
  assert.deepEqual(client.storeSessions, [
    {storeId:'a',storeName:'麦岛店',remainingSessions:10},
    {storeId:'b',storeName:'崂山店',remainingSessions:9},
  ]);
  assert.ok(!Object.hasOwn(client, 'remaining'));
  assert.ok(!JSON.stringify(data).includes(thirdStore.id));
  assert.ok(!JSON.stringify(data).includes(secret));
});

test('misassigned historical feedback tasks never appear in therapist work counts or work UI', () => {
  const { model, review } = fixture();
  const task = model.state.tasks.find(t => t.reviewId === review.id);
  task.assigneeId = 't1';
  task.title = '私密反馈待办测试';
  const role = { type: 'therapist', id: 't1' };
  assert.ok(!workSummary(model, role).tasks.some(t => t.id === task.id));
  assert.ok(!renderStaff(ctx(model, role)).includes(task.title));
  assert.ok(workSummary(model, boss).tasks.some(t => t.id === task.id));
});

test('a forged boss identifier cannot bypass the real export boundary', () => {
  const { model } = fixture();
  assert.throws(() => appReaders(model, { type: 'boss', id: 't1' }).service('s1'), /权限/);
  return assert.rejects(() => appReaders(model, { type: 'boss', id: 't1' }).export(), /老板|权限/);
});

test('follow-up dialog rejects non-boss readers even if a caller bypasses the outer UI guard', () => {
  const { model, review } = fixture();
  for (const role of [customer, { type: 'therapist', id: 't1' }, { type: 'frontdesk', id: 'f1' }, { type: 'boss', id: 't1' }]) {
    assert.throws(() => staffDialog('followup', review.id, ctx(model, role)), /权限|老板/);
  }
  assert.ok(staffDialog('followup', review.id, ctx(model, boss)).html.includes(secret));
});

test('closed historical feedback tasks cannot be completed by a therapist despite stale assignment', () => {
  const { model, review } = fixture();
  const task = model.state.tasks.find(t => t.reviewId === review.id);
  task.assigneeId = 't1';
  model.closeFollowup(review.id, '老板已联系客户', boss);
  assert.throws(() => model.completeTask(task.id, { type: 'therapist', id: 't1' }), /老板|权限/);
  assert.equal(model.completeTask(task.id, boss).completedBy, 'boss');
});

test('ratings route requested contacts only to the boss and never change sessions or consumption performance', () => {
  for (const [score, wantContact, pending] of [[2,false,true],[5,true,true],[5,false,false]]) {
    const model = new DemoModel({ now: () => '2026-10-09T04:00:00.000Z' });
    const before = JSON.stringify([model.state.services, model.state.packages, model.state.receipts, model.performance('t2'), model.remaining('c1')]);
    const review = model.submitReview('s1', { score, wantContact, feedback: secret }, customer);
    const tasks = model.state.tasks.filter(t => t.reviewId === review.id);
    assert.equal(tasks.length, pending ? 1 : 0);
    if (pending) assert.equal(tasks[0].assigneeId, 'boss');
    assert.equal(JSON.stringify([model.state.services, model.state.packages, model.state.receipts, model.performance('t2'), model.remaining('c1')]), before);
    assert.throws(() => model.submitReview('s1', { score, feedback: '重复' }, customer), /已评价/);
  }
});
