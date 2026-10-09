/* Half-hour choices for appointment starts in the preview. */
export function hourTimeField(value, esc, label = '开始时间') {
  const selected = /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(value) ? value : '';
  const previous = !selected && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '';
  const options = Array.from({ length: 48 }, (_, slot) => {
    const time = `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
    return `<option value="${time}"${selected === time ? ' selected' : ''}>${time}</option>`;
  }).join('');
  return `<label class="field"><span>${esc(label)}</span><select name="time" aria-label="${esc(label)}" required><option value="" disabled${selected ? '' : ' selected'}>请选择时间</option>${options}</select>${previous ? `<small class="muted">原开始时间 ${esc(previous)}，请重新选择整点或半点。</small>` : ''}</label>`;
}
