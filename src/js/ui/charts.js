import { h } from './dom.js';

// Charts are plain HTML, not SVG in a scaled viewBox: labels keep their real font size at
// 320 px, where a scaled SVG's text would shrink below legibility.

let tip = null;

function showTip(target) {
  tip ??= document.body.appendChild(h('div', { class: 'chart-tip', role: 'presentation' }));
  tip.textContent = target.getAttribute('data-tip');
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, r.top - t.height - 6 + window.scrollY)}px`;
}
const hideTip = () => { if (tip) tip.hidden = true; };

const tipProps = (text) => ({ 'data-tip': text, tabindex: '0', onpointerenter: (e) => showTip(e.currentTarget), onpointerleave: hideTip, onfocus: (e) => showTip(e.currentTarget), onblur: hideTip });

/** Round the axis top to 1, 2 or 5 × 10^n, so the grid lands on readable numbers. */
export function niceMax(value) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const n = value / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
}

/** Horizontal bars. rows: [{label, value, color, shown?}] */
export function barList(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'bars' }, rows.map((r) => {
    const shown = r.shown ?? String(r.value);
    return h('div', { class: 'bar-row' },
      h('span', { class: 'bar-label' }, r.label),
      h('span', { class: 'bar-track' },
        r.value > 0 ? h('span', { class: 'bar-fill', css: { width: `${(r.value / max) * 100}%`, background: r.color }, ...tipProps(`${r.label}: ${shown}`) }) : null),
      h('span', { class: 'bar-value' }, shown));
  }));
}

/** Vertical columns on one axis with a recessive grid. Counts are whole numbers, so a
 *  half-way tick like 2.5 stays unlabelled. rows: [{label, value, short}] */
export function columns(rows, { unit = 'items', color = 'var(--accent-mark)' } = {}) {
  const top = niceMax(Math.max(0, ...rows.map((r) => r.value)));
  const ticks = [top, top / 2, 0];
  return h('div', { class: 'cols' },
    h('div', { class: 'cols-axis', 'aria-hidden': 'true' }, ticks.map((t) => h('span', null, Number.isInteger(t) ? t : '\u00a0'))),
    h('div', { class: 'cols-plot' },
      h('i', { class: 'grid g1' }), h('i', { class: 'grid g2' }), h('i', { class: 'grid g3' }),
      rows.map((r) => h('div', { class: 'col', ...tipProps(`${r.label}: ${r.value} ${unit}`) },
        h('span', { class: 'col-fill', css: { height: `${(r.value / top) * 100}%`, background: color } }),
        h('span', { class: 'col-label' }, r.short ?? r.label)))));
}

/** Every chart has a Chart and Table toggle, so the numbers can always be read as text. */
export function chartCard(title, note, chartEl, headers, rows) {
  const table = h('table', { class: 'data-table plain' },
    h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: i > 0 ? 'num' : null, 'data-label': headers[i] }, c))))));
  table.hidden = true;
  const chartBtn = h('button', { type: 'button', class: 'seg', 'aria-pressed': 'true' }, 'Chart');
  const tableBtn = h('button', { type: 'button', class: 'seg', 'aria-pressed': 'false' }, 'Table');
  const show = (asTable) => {
    chartEl.hidden = asTable;
    table.hidden = !asTable;
    chartBtn.setAttribute('aria-pressed', String(!asTable));
    tableBtn.setAttribute('aria-pressed', String(asTable));
    hideTip();
  };
  chartBtn.addEventListener('click', () => show(false));
  tableBtn.addEventListener('click', () => show(true));
  return h('section', { class: 'card chart-card', 'aria-label': title },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, title), note ? h('p', { class: 'sub' }, note) : null),
      h('div', { class: 'segs', role: 'group', 'aria-label': `${title} view` }, chartBtn, tableBtn)),
    chartEl, table);
}
