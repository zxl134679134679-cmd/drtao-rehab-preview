import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel, ensureStorePackageExamples } from './core.js';
import { receptionStores } from './reception.js';
import { ensureEvaluations, assessmentRows, frontDeskEvaluationRows } from './evaluations.js';
import { ensureCustomerBooking, customerBookingRows } from './customer-booking.js';
import { ensurePaperIntakes, paperIntakeRows } from './paper-intake.js';
import { ensureSchedules, scheduleRows, scheduleRequestRows, bossScheduleNotifications } from './schedules.js';

const boss = { type: 'boss', id: 'boss' };
const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const replayKeys = new Set(['inputKey', 'requestId', 'personnelOperation']);
const sourceFunction = (name, next) => {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `actual app function ${name} must remain available`);
  return source.slice(start, end);
};
function forbiddenKeys(value, names = replayKeys) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [...(names.has(key) ? [key] : []), ...forbiddenKeys(child, names)]);
}
// Exercise the shipped export boundary. Only the browser download destination
// is replaced; role guards and all scoped domain readers use production code.
async function exported(model, role) {
  let download;
  const scope = {
    model, role, ctx: () => ({ model, role, filters: {} }),
    receptionStores, assessmentRows, frontDeskEvaluationRows, customerBookingRows, paperIntakeRows,
    scheduleRows, scheduleRequestRows, bossScheduleNotifications,
    Blob, URL: { createObjectURL: blob => { download = blob; return 'blob:personnel-export-test'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) }, setTimeout() {}, toast() {},
  };
  vm.runInNewContext(`${sourceFunction('assertBoss', '\nfunction assertStaff')}\n${sourceFunction('exportPreview', '\n// Use the layout breakpoint')}\nglobalThis.downloadRecords = exportPreview;`, scope);
  scope.downloadRecords();
  return JSON.parse(await download.text()).数据;
}
function fixture() {
  const model = new DemoModel({ now: () => '2026-10-09T04:00:00.000Z' });
  ensureStorePackageExamples(model); ensureEvaluations(model); ensureCustomerBooking(model); ensurePaperIntakes(model); ensureSchedules(model);
  const people = [
    { kind: 'therapist', collection: 'therapists', add: 'addTherapist', edit: 'updateTherapist', idKey: 'therapistId', store: { storeId: 'a' } },
    { kind: 'frontdesk', collection: 'frontDesks', add: 'addFrontDesk', edit: 'updateFrontDesk', idKey: 'frontDeskId', store: { storeIds: ['a'] } },
    { kind: 'manager', collection: 'storeManagers', add: 'addStoreManager', edit: 'updateStoreManager', idKey: 'managerId', store: { storeId: 'a' } },
  ].map((person, index) => {
    const before = model[person.add]({ name: `新增人员示例${index}`, phone: `1389909210${index}`, notes: `人员专用备注-新增-${index}`, ...person.store, requestId: `secret-personnel-add-${index}` }, boss);
    const after = model[person.edit]({ id: before.id, name: `更正人员示例${index}`, phone: `1399909210${index}`, notes: `人员专用备注-编辑-${index}`, ...person.store, active: true, expectedVersion: before.profileVersion, reason: `老板更正资料原因${index}`, requestId: `secret-personnel-edit-${index}` }, boss);
    return { ...person, before, after, reason: `老板更正资料原因${index}` };
  });
  return { model, people };
}

test('actual boss export retains personnel history, reasons and contacts while removing replay metadata', async () => {
  const { model, people } = fixture(), data = await exported(model, boss);
  for (const person of people) {
    const row = data[person.collection].find(row => row.id === person.after.id);
    assert.equal(row.name, person.after.name); assert.equal(row.phone, person.after.phone); assert.equal(row.notes, person.after.notes);
    const added = data.audit.find(row => row.type === `${person.kind}_added` && row[person.idKey] === person.after.id);
    const edited = data.audit.find(row => row.type === `${person.kind}_updated` && row[person.idKey] === person.after.id);
    assert.equal(added.before, null); assert.equal(added.after.name, person.before.name); assert.equal(added.after.phone, person.before.phone);
    assert.equal(edited.before.name, person.before.name); assert.equal(edited.before.phone, person.before.phone);
    assert.equal(edited.after.name, person.after.name); assert.equal(edited.after.phone, person.after.phone); assert.equal(edited.reason, person.reason);
    assert.equal(edited.actorId, 'boss'); assert.equal(edited.actorType, 'boss');
    assert.deepEqual(forbiddenKeys(added), []); assert.deepEqual(forbiddenKeys(edited), []);
  }
  assert.ok(model.state.audit.some(row => row.personnelOperation && row.requestId && row.inputKey), 'raw replay metadata exists so removal is exercised');
});

test('all non-boss exports retain their scoped business projection without disclosing personnel contacts or notes', async () => {
  const { model, people } = fixture();
  // Also protect the currently signed-in manager and staff already connected
  // to client work, rather than only unassigned newly added employees.
  for (const [index, person] of people.entries()) {
    const existing = model.state[person.collection][0];
    model[person.edit]({ id: existing.id, name: existing.name, ...person.store, active: true, phone: `1379909220${index}`, notes: `人员专用备注-已有-${index}`, expectedVersion: existing.profileVersion ?? 0, reason: '老板补录在职人员资料', requestId: `secret-existing-edit-${index}` }, boss);
  }
  const personnel = ['therapists', 'frontDesks', 'storeManagers'].flatMap(collection => model.state[collection]);
  for (const role of [{ type: 'therapist', id: 't1' }, { type: 'frontdesk', id: 'f1' }, { type: 'manager', id: 'm1' }, { type: 'customer', id: 'c1' }]) {
    const data = await exported(model, role), encoded = JSON.stringify(data);
    assert.ok(data.clients.some(row => row.id === 'c1'), `${role.type} keeps the already authorized client`);
    assert.ok(data.appointments.some(row => row.id === (role.type === 'customer' ? 'a1' : 'a3')), `${role.type} keeps their existing authorized appointment`);
    for (const row of personnel) for (const value of [row.phone, row.notes].filter(Boolean)) {
      assert.ok(!encoded.includes(value), `${role.type} must not disclose private staff field ${value}`);
    }
    // Legacy package export may retain its own requestId. Do not broaden or
    // replace that business projection to test newly private personnel data.
    assert.ok(!encoded.includes('secret-personnel-') && !encoded.includes('secret-existing-edit-'), `${role.type} must not receive personnel submission identifiers`);
    assert.deepEqual(forbiddenKeys(data, new Set(['personnelOperation'])), [], `${role.type} must not receive personnel replay operations`);
    const projectedPeople = [data.manager, ...(data.therapists || []), ...(data.frontDesks || []), ...(data.storeManagers || [])].filter(Boolean);
    for (const row of projectedPeople) assert.deepEqual(forbiddenKeys(row, new Set([...replayKeys, 'phone', 'notes'])), [], `${role.type} staff projection remains minimal`);
    if (role.type === 'manager') {
      assert.equal(data.storeId, 'a');
      assert.ok(data.therapists.some(row => row.id === 't1')); assert.ok(data.frontDesks.some(row => row.id === 'f1'));
      for (const row of [data.manager, ...data.therapists, ...data.frontDesks]) {
        assert.ok(!Object.hasOwn(row, 'phone')); assert.ok(!Object.hasOwn(row, 'notes'));
      }
      assert.ok(data.services.every(row => row.storeId === 'a'), 'manager still exports only their store work');
    }
  }
});

test('forged boss identity cannot download personnel records through the actual export function', async () => {
  const { model } = fixture();
  await assert.rejects(() => exported(model, { type: 'boss', id: 'm1' }), /老板|权限/);
});
