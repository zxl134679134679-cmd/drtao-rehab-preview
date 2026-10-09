const pick = (row, keys) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const clone = value => JSON.parse(JSON.stringify(value));

export function managerClientInStore(model, client, storeId) {
  return client.storeId === storeId || model.state.packages.some(pack => pack.clientId === client.id && pack.storeId === storeId) ||
    model.state.therapists.some(person=>person.active&&person.storeId===storeId&&client.storeTherapistIds?.[storeId]===person.id) ||
    ['appointments', 'services', 'receipts', 'refunds', 'assessments', 'paperIntakes', 'tasks'].some(collection =>
      (model.state[collection] || []).some(row => row.clientId === client.id && row.storeId === storeId && (collection !== 'tasks' || row.type !== 'review_followup' && !row.reviewId)));
}

// Scope every record by its actual store. A shared client or visiting member of
// staff never makes their other-store work visible to this account.
export function storeWorkSnapshot(model, role, filters = {}) {
  const storeId = model.managerStoreId(role);
  if (filters.storeId && filters.storeId !== storeId) throw new Error('店长仅能查看本店工作');
  const state = model.state;
  const cash = model.cashSummary({ ...filters, storeId }, role);
  const from = filters.from || '', to = filters.to || '';
  const between = value => (!from || value >= from) && (!to || value <= to);
  const local = rows => (rows || []).filter(row => row.storeId === storeId);
  const dated = rows => local(rows).filter(row => between(row.date));
  const clients = state.clients.filter(client => managerClientInStore(model, client, storeId));
  const clientIds = new Set(clients.map(client => client.id));
  const allServices = local(state.services), allAppointments = local(state.appointments), allAssessments = local(state.assessments);
  const tasks = state.tasks.filter(task => {
    if (task.type === 'review_followup' || task.reviewId || !clientIds.has(task.clientId)) return false;
    if (task.appointmentId) return allAppointments.some(row => row.id === task.appointmentId);
    if (task.serviceId) return allServices.some(row => row.id === task.serviceId);
    if (task.storeId) return task.storeId === storeId;
    // Older unlinked tasks have no service-store attribution. Treat them as
    // work of the client's home store, rather than every store they visited.
    return clients.find(client => client.id === task.clientId)?.storeId === storeId;
  });
  const therapistIds = new Set([
    ...clients.map(client => client.ownerId), ...tasks.map(task => task.assigneeId),
    ...allServices.flatMap(row => [row.principalId, ...(row.participantIds || []), row.recordedBy]),
    ...allAppointments.map(row => row.principalId), ...allAssessments.map(row => row.therapistId),
  ]);
  const localEvaluations = local(state.frontDeskEvaluations);
  const frontDeskIds = new Set([
    ...allAppointments.filter(row => row.arrivalByRole === 'frontdesk').map(row => row.arrivalBy),
    ...local(state.receipts).filter(row => row.recordedRole === 'frontdesk').map(row => row.recordedBy),
    ...allAssessments.filter(row => row.recordedRole === 'frontdesk').map(row => row.recordedBy),
    ...localEvaluations.map(row => row.frontDeskId),
  ]);
  const cashKeys = ['packageId', 'packageAction', 'packageReason', 'id', 'clientId', 'storeId', 'date', 'time', 'amount', 'amountMinor', 'status', 'channel', 'method', 'purpose', 'businessType', 'reference', 'notes', 'parentId', 'receiptId', 'settlementReceiptId', 'settlementStatus', 'recordedBy', 'recordedRole', 'recordedAt', 'createdAt', 'reason', 'voidReason', 'voidedAt', 'voidedBy'];
  const receiptRows = dated(state.receipts).map(row => pick(row, cashKeys));
  const refundRows = dated(state.refunds).map(row => pick(row, cashKeys));
  return clone({
    manager: pick(state.storeManagers.find(row => row.id === role.id), ['id', 'name', 'storeId', 'active']),
    store: pick(state.stores.find(row => row.id === storeId), ['id', 'name', 'address']), storeId, from, to,
    clients: clients.map(client => {
      const packs = model.availablePackages(client.id,storeId);
      const pack = packs[0];
      const remaining = model.remainingInStore(client.id,storeId), total=packs.reduce((sum,p)=>sum+p.total,0);
      return { ...pick(client, ['id', 'name', 'phone', 'age', 'problem', 'ownerId', 'storeId', 'planName', 'goal', 'phase', 'nextStep', 'phaseNote', 'progress', 'homeAdvice']), packageId:pack?.id || null, remaining, total, used:total-remaining, packageName:pack?.name || '暂无本店可用套餐' };
    }),
    services: dated(state.services).map(row => ({
      ...pick(row, ['id', 'clientId', 'packageId', 'storeId', 'date', 'time', 'project', 'principalId', 'participantIds', 'ownerId', 'recordedBy', 'recordedAt', 'createdAt', 'amount', 'amountMinor', 'sessions', 'billingMode', 'receiptId', 'nextStepSuggestion', 'status', 'notes', 'revokeReason', 'revokedBy', 'revokedAt']),
      // Keep large photo bytes out of summary responses. The photo viewer reads
      // the requested photo only after checking this service's store again.
      evidencePhotos: (row.evidencePhotos || []).map(photo => pick(photo, ['id', 'width', 'height', 'recordedAt', 'recordedBy'])),
    })),
    appointments: dated(state.appointments).map(row => pick(row, ['id', 'clientId', 'storeId', 'date', 'time', 'project', 'principalId', 'participantIds', 'status', 'groupId', 'serviceId', 'request', 'requestNote', 'arrivalAt', 'arrivalBy', 'arrivalByRole', 'cancellationRequest', 'cancellationHistory', 'createdAt', 'cancelReason', 'cancelledAt', 'noShowReason', 'noShowAt'])),
    tasks: tasks.map(row => pick(row, ['id', 'clientId', 'title', 'assigneeId', 'dueDate', 'status', 'type', 'appointmentId', 'serviceId', 'paperIntakeId', 'storeId', 'completedAt', 'completedBy', 'completionResult'])),
    assessments: dated(state.assessments).map(row => pick(row, ['id', 'clientId', 'storeId', 'date', 'time', 'type', 'project', 'therapistId', 'summary', 'metrics', 'status', 'recordedBy', 'recordedRole', 'createdAt', 'confirmedBy', 'confirmedAt', 'voidReason', 'voidedBy', 'voidedAt'])),
    receipts: receiptRows, refunds: refundRows,
    frontDeskEvaluations: localEvaluations.filter(row => (!from || row.to >= from) && (!to || row.from <= to)).map(row => pick(row, ['id', 'frontDeskId', 'storeId', 'from', 'to', 'dataConclusion', 'receptionConclusion', 'cashConclusion', 'summary', 'improvement', 'dueDate', 'status', 'createdAt', 'voidReason'])),
    therapists: state.therapists.filter(row => row.storeId === storeId || therapistIds.has(row.id)).map(row => pick(row, ['id', 'name', 'storeId', 'active'])),
    frontDesks: (state.frontDesks || []).filter(row => row.storeIds.includes(storeId) || frontDeskIds.has(row.id)).map(row => ({ ...pick(row, ['id', 'name', 'active']), storeIds: row.storeIds.filter(id => id === storeId) })),
    cash: { ...pick(cash, ['receivedMinor', 'refundedMinor', 'netMinor', 'received', 'refunded', 'net', 'pendingMinor', 'pending', 'channels']), receipts: receiptRows.filter(row => row.status === 'valid'), refunds: refundRows.filter(row => row.status === 'valid') },
  });
}
