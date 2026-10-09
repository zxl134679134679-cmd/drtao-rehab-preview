/* Whole-hour choices for appointment starts in the preview. */
export function hourTimeField(value, esc) {
  const selected = /^(?:[01]\d|2[0-3]):00$/.test(value) ? value : '';
  const previous = !selected && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '';
  const options = Array.from({ length: 24 }, (_, hour) => {
    const time = `${String(hour).padStart(2, '0')}:00`;
    return `<option value="${time}"${selected === time ? ' selected' : ''}>${hour}点</option>`;
  }).join('');
  return `<label class="field"><span>开始时间</span><select name="time" aria-label="开始时间" required><option value="" disabled${selected ? '' : ' selected'}>请选择整点</option>${options}</select>${previous ? `<small class="muted">原开始时间 ${esc(previous)}，请选择整点后保存。</small>` : ''}</label>`;
}
