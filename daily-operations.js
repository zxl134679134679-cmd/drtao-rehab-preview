/* Read-only daily store operations. Cash, completed work and reception are
   separate measures; this module never creates commission or inferred visits. */
const SHANGHAI_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效的统计日期');
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error('请选择有效的统计日期');
  return value;
}
function businessDay(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '';
  const parts = Object.fromEntries(SHANGHAI_DAY.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function period(model, options) {
  const has = value => value !== undefined && value !== null && value !== '';
  if (has(options.date) && (has(options.from) || has(options.to))) throw new Error('单日日期与期间不能同时选择');
  const from = date(has(options.date) ? options.date : has(options.from) ? options.from : has(options.to) ? options.to : model.today);
  const to = date(has(options.date) ? options.date : has(options.to) ? options.to : from);
  if (from > to) throw new Error('统计期间的开始日期不能晚于结束日期');
  return { from, to, date: from === to ? from : '', dayCount: (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1 };
}
function scope(model, role, options) {
  const selected = options.storeId ?? '';
  if (typeof selected !== 'string' || selected.length > 80) throw new Error('请选择有效的统计门店');
  const storeId = selected.trim();
  if (role?.type === 'boss') model._boss(role);
  else if (role?.type !== 'manager') throw new Error('仅老板和在职店长有权限查看每日店务');
  const local = role.type === 'manager' ? model.managerStoreId(role) : '';
  if (storeId) model._store(storeId);
  if (local && storeId && local !== storeId) throw new Error('店长仅有本店店务查看权限');
  const actual = local || storeId;
  return { storeId: actual, storeIds: actual ? [actual] : model.state.stores.map(row => row.id) };
}
function income(model, role, storeIds, storeId, range) {
  const cash = model.cashSummary({ storeId, from: range.from, to: range.to }, role);
  const values = Object.fromEntries(['receivedMinor', 'refundedMinor', 'netMinor', 'pendingMinor', 'received', 'refunded', 'net', 'pending'].map(key => [key, cash[key]]));
  return { ...values, receiptIds: cash.receipts.map(row => row.id), refundIds: cash.refunds.map(row => row.id),
    pendingReceiptIds: model.state.receipts.filter(row => row.status === 'pending_settlement' && storeIds.has(row.storeId) && row.date >= range.from && row.date <= range.to).map(row => row.id) };
}
function receptions(model, stores, range) {
  const groups = new Map();
  for (const row of model.state.appointments) {
    const day = businessDay(row.arrivalAt);
    if (!stores.has(row.storeId) || !day || day < range.from || day > range.to || !model.state.clients.some(client => client.id === row.clientId)) continue;
    const key = JSON.stringify([row.clientId, row.storeId, day]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(rows => {
    rows.sort((a, b) => Date.parse(a.arrivalAt) - Date.parse(b.arrivalAt) || a.id.localeCompare(b.id));
    const first = rows[0], tied = rows.filter(row => Date.parse(row.arrivalAt) === Date.parse(first.arrivalAt));
    const sameActor = tied.every(row => row.arrivalBy === first.arrivalBy && row.arrivalByRole === first.arrivalByRole);
    const frontDeskId = sameActor && first.arrivalByRole === 'frontdesk' && model.state.frontDesks.some(person => person.id === first.arrivalBy) ? first.arrivalBy : '';
    // A boss's arrival and a timestamp tie between different actors are real
    // visits, but neither supplies evidence for assigning a receptionist.
    return { appointmentId: first.id, frontDeskId };
  });
}
function newFiles(model, stores, range) {
  const imported = new Set(model.state.audit.filter(row => row.type === 'opening_import').map(row => row.clientId));
  const created = new Map();
  for (const event of model.state.audit) if (event.type === 'reception_client_created' && !created.has(event.clientId)) created.set(event.clientId, event);
  return model.state.clients.flatMap(client => {
    if (imported.has(client.id) || !stores.has(client.storeId)) return [];
    const event = created.get(client.id), day = businessDay(client.createdAt) || businessDay(event?.createdAt);
    if (!day || day < range.from || day > range.to) return [];
    const actorType = client.createdRole || event?.actorType, actorId = client.createdBy || event?.actorId;
    return [{ clientId: client.id, frontDeskId: actorType === 'frontdesk' && model.state.frontDesks.some(person => person.id === actorId) ? actorId : '' }];
  });
}
function summarize(model, role, storeIds, storeId, range) {
  const stores = new Set(storeIds), validServices = model.state.services.filter(row => row.status === 'valid' && stores.has(row.storeId) && row.date >= range.from && row.date <= range.to);
  const consumedSessions = validServices.reduce((sum, row) => {
    if (!Number.isSafeInteger(row.sessions) || row.sessions < 0 || !Number.isSafeInteger(sum + row.sessions)) throw new Error('服务扣课次数待核对，不能生成店务统计');
    return sum + row.sessions;
  }, 0);
  const people = new Map();
  const therapist = id => {
    if (!people.has(id)) people.set(id, { therapistId: id, name: model.state.therapists.find(row => row.id === id)?.name || '历史康复师', serviceCount: 0, serviceIds: [], collaborationCount: 0, collaborationServiceIds: [] });
    return people.get(id);
  };
  for (const row of validServices) {
    const main = therapist(row.principalId); main.serviceCount++; main.serviceIds.push(row.id);
    for (const id of new Set(row.participantIds || [])) if (id !== row.principalId) {
      const participant = therapist(id); participant.collaborationCount++; participant.collaborationServiceIds.push(row.id);
    }
  }
  const arrivals = receptions(model, stores, range), files = newFiles(model, stores, range);
  const frontDesks = model.state.frontDesks.filter(person => person.storeIds.some(id => stores.has(id)) || arrivals.some(row => row.frontDeskId === person.id) || files.some(row => row.frontDeskId === person.id)).map(person => {
    const visits = arrivals.filter(row => row.frontDeskId === person.id), clients = files.filter(row => row.frontDeskId === person.id);
    return { frontDeskId: person.id, name: person.name, receptionCount: visits.length, appointmentIds: visits.map(row => row.appointmentId), newClientCount: clients.length, newClientIds: clients.map(row => row.clientId) };
  });
  const unassigned = arrivals.filter(row => !row.frontDeskId);
  return { income: income(model, role, stores, storeId, range), serviceCount: validServices.length, consumedSessions, serviceIds: validServices.map(row => row.id),
    therapists: [...people.values()], receptionCount: arrivals.length, frontDesks,
    unassignedReception: { receptionCount: unassigned.length, appointmentIds: unassigned.map(row => row.appointmentId) }, newClientCount: files.length, newClientIds: files.map(row => row.clientId) };
}

export function dailyOperationsSummary(model, role, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('请选择有效的店务日期和门店');
  const selected = scope(model, role, options), range = period(model, options);
  const total = summarize(model, role, selected.storeIds, selected.storeId, range);
  const stores = selected.storeIds.map(storeId => {
    const local = summarize(model, role, [storeId], storeId, range);
    return { storeId, name: model._store(storeId).name, income: local.income, serviceCount: local.serviceCount, consumedSessions: local.consumedSessions, receptionCount: local.receptionCount, newClientCount: local.newClientCount };
  });
  return { ...range, ...selected, receptionScope: 'store-day-deduplicated', ...total, stores };
}
