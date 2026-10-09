/* Test-only fixtures: legacy workflow tests explicitly begin with confirmed shifts.
   Production loads never call this helper or infer availability from missing data. */
export function confirmTestShift(model, { therapistId, storeId, date, startTime = '00:00', endTime = '23:30' }) {
  const therapist = model.state.therapists.find(row => row.id === therapistId);
  if (!therapist) throw new Error('Test fixture requires an existing therapist');
  model.state.staffSchedules ??= []; model.state.scheduleChangeRequests ??= []; model.state.scheduleNotifications ??= [];
  const row = { id: `test-confirmed-${therapistId}-${date}`, therapistId, storeId: storeId || therapist.storeId, date, status: 'work', startTime, endTime, version: 1, changedBy: 'boss', changedRole: 'boss', changedAt: '2026-10-09T00:00:00.000Z', reason: '已确认测试排班' };
  const index = model.state.staffSchedules.findIndex(item => item.therapistId === therapistId && item.date === date);
  if (index < 0) model.state.staffSchedules.push(row); else model.state.staffSchedules[index] = row;
  return model;
}

export function confirmedTestSchedules(model, { days = 31 } = {}) {
  // Reconstructed test states retain the already-confirmed shifts verbatim.
  if (Array.isArray(model.state.staffSchedules)) return model;
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(`${model.today}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + offset);
    for (const therapist of model.state.therapists) confirmTestShift(model, { therapistId: therapist.id, date: day.toISOString().slice(0, 10) });
  }
  return model;
}
