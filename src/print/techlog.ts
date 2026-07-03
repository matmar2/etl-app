// Aircraft Technical Log page — HTML in the same layout as the paper TL (TFLB),
// rendered to PDF for AirPrint / share, or to ESC/POS text for a Bluetooth printer.
import { FLY2SKY_LOGO } from './logo';
import { fmtTl } from '../util/tl';

export type TLData = {
  sector: any;
  aircraft: any;
  defects: any[];
  signatures: any[];
  servicing?: any[];
};

const OPERATOR = 'Fly2Sky';

function esc(v: any): string {
  return v === null || v === undefined || v === '' ? '' : String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function t(v: any): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? esc(v) : d.toISOString().slice(11, 16);
}
function d(v: any): string {
  if (!v) return '';
  const dt = new Date(v);
  return isNaN(dt.getTime()) ? esc(v) : dt.toISOString().slice(0, 10);
}
function hhmm(min: any): string {        // minutes -> h:mm
  if (min == null || min === '') return '';
  const n = Number(min);
  return isNaN(n) ? '' : `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
}

const KIND: Record<string, string> = {
  nil: 'NIL DEFECT', deferred: 'RELEASED WITH DEFERRED DEFECT (MEL/HIL)',
  rectified: 'DEFECT RECTIFIED', with_defects: 'RELEASED — SEE DEFECTS',
};

export function techLogHtml(data: TLData): string {
  const { sector: s, aircraft: ac } = data;
  const reg = esc(ac?.registration);
  const defects = data.defects ?? [];
  const sigs = data.signatures ?? [];

  const sig = (k: string) => sigs.find((g) => g.kind === k);
  const pre = sig('preflight'); const post = sig('postflight'); const crs = sig('crs');

  const defectRows = defects.length ? defects.map((x) => `
    <tr>
      <td>${esc(x.title)}${x.title ? ': ' : ''}${esc(x.description)}</td>
      <td class="c">${esc(x.ata_chapter)}</td>
      <td class="c">${esc((x.source || '').toUpperCase())}</td>
      <td class="c">${esc(x.area === 'cabin' ? 'CABIN' : 'TECH')}</td>
      <td class="c">${esc(x.mel_ref)}</td>
      <td class="c">${esc((x.status || '').toUpperCase())}</td>
    </tr>`).join('') : `<tr><td colspan="6" class="c">NIL</td></tr>`;

  const release = s.released_at ? `
    <div class="rel ${s.release_serviceable ? 'svc' : 'unsvc'}">
      <b>MAINTENANCE RELEASE / CRS:</b> ${esc(KIND[s.release_kind] || s.release_kind || '')}
      &nbsp;·&nbsp; Aircraft ${s.release_serviceable ? 'SERVICEABLE' : 'UNSERVICEABLE'}
      &nbsp;·&nbsp; ${d(s.released_at)} ${t(s.released_at)}
      ${s.release_note ? `<br/>Note: ${esc(s.release_note)}` : ''}
    </div>` : `<div class="rel unsvc"><b>MAINTENANCE RELEASE / CRS:</b> NOT RELEASED</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; margin: 16px; }
    .hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:6px; }
    .hdr h1 { font-size: 15px; margin: 0; letter-spacing: .5px; }
    .hdr .sub { font-size: 10px; }
    table { border-collapse: collapse; width: 100%; margin-top: 8px; }
    td, th { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
    th { background: #eee; text-align: left; font-size: 10px; }
    .c { text-align: center; }
    .grid td { width: 16.66%; }
    .lbl { color:#333; font-size: 9px; display:block; }
    .val { font-size: 12px; font-weight: 700; }
    h2 { font-size: 11px; margin: 12px 0 0; text-transform: uppercase; }
    .rel { margin-top: 10px; padding: 6px 8px; border: 1px solid #000; font-size: 11px; }
    .svc { background: #e7f6e7; }
    .unsvc { background: #fde7e7; }
    .sigs { margin-top: 10px; }
    .sigs td { height: 38px; }
  </style></head><body>
    <div class="hdr">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${FLY2SKY_LOGO}" style="height:30px"/>
        <div><h1>AIRCRAFT TECHNICAL LOG</h1><div class="sub">${OPERATOR}</div></div>
      </div>
      <div class="sub" style="text-align:right">
        <div><b>${reg}</b> · ${esc(ac?.type)}</div>
        <div>MSN ${esc(ac?.msn)}</div>
        <div>TL # ${esc(fmtTl(s.page_no))}</div>
      </div>
    </div>

    <table class="grid">
      <tr>
        <td><span class="lbl">FLIGHT</span><span class="val">${esc(s.flight_no) || '&nbsp;'}</span></td>
        <td><span class="lbl">DATE</span><span class="val">${d(s.flight_date) || '&nbsp;'}</span></td>
        <td><span class="lbl">DEP</span><span class="val">${esc(s.dep) || '&nbsp;'}</span></td>
        <td><span class="lbl">ARR</span><span class="val">${esc(s.arr) || '&nbsp;'}</span></td>
        <td><span class="lbl">STD</span><span class="val">${t(s.std) || '&nbsp;'}</span></td>
        <td><span class="lbl">STA</span><span class="val">${t(s.sta) || '&nbsp;'}</span></td>
      </tr>
      <tr>
        <td><span class="lbl">OUT</span><span class="val">${t(s.off_block) || '&nbsp;'}</span></td>
        <td><span class="lbl">OFF</span><span class="val">${t(s.takeoff) || '&nbsp;'}</span></td>
        <td><span class="lbl">ON</span><span class="val">${t(s.landing) || '&nbsp;'}</span></td>
        <td><span class="lbl">IN</span><span class="val">${t(s.on_block) || '&nbsp;'}</span></td>
        <td><span class="lbl">BLOCK</span><span class="val">${hhmm(s.block_time_min)}</span></td>
        <td><span class="lbl">FLIGHT</span><span class="val">${hhmm(s.flight_time_min)}</span></td>
      </tr>
      <tr>
        <td><span class="lbl">DEP FUEL (kg)</span><span class="val">${esc(s.dep_fuel_kg)}</span></td>
        <td><span class="lbl">TAXI FUEL (kg)</span><span class="val">${esc(s.taxi_fuel_kg)}</span></td>
        <td><span class="lbl">UPLIFT (kg)</span><span class="val">${esc(s.fuel_uplift_kg)}</span></td>
        <td><span class="lbl">FOB REMAIN (kg)</span><span class="val">${esc(s.fuel_remaining_kg)}</span></td>
        <td><span class="lbl">TOW (kg)</span><span class="val">${esc(s.tow_kg)}</span></td>
        <td><span class="lbl">LW (kg)</span><span class="val">${esc(s.lw_kg)}</span></td>
      </tr>
      <tr>
        <td><span class="lbl">LDGS (this flt)</span><span class="val">${esc(s.this_flight_ldgs)}</span></td>
        <td><span class="lbl">LDGS C/FWD</span><span class="val">${esc(s.ldgs_fwd)}</span></td>
        <td colspan="4"></td>
      </tr>
    </table>

    <h2>Defects / Deferred items (HIL)</h2>
    <table>
      <tr><th>Description</th><th class="c">ATA</th><th class="c">Src</th><th class="c">Area</th><th class="c">MEL/HIL</th><th class="c">Status</th></tr>
      ${defectRows}
    </table>

    ${release}

    <h2>Certification</h2>
    <table class="sigs">
      <tr><th>Commander acceptance (pre-flight)</th><th>Post-flight</th><th>Maintenance release (CRS)</th></tr>
      <tr>
        <td>${pre ? esc(pre.signer_name) + '<br/>' + d(pre.signed_at) + ' ' + t(pre.signed_at) : ''}</td>
        <td>${post ? esc(post.signer_name) + '<br/>' + d(post.signed_at) + ' ' + t(post.signed_at) : ''}</td>
        <td>${crs ? esc(crs.signer_name) + (crs.licence_no ? ' · ' + esc(crs.licence_no) : '') + '<br/>' + d(crs.signed_at) + ' ' + t(crs.signed_at) : ''}</td>
      </tr>
    </table>
  </body></html>`;
}

// Stand-alone CABIN DEFECT LOG — cabin-crew defects only, printed separately.
export function cabinDefectHtml(data: TLData): string {
  const cabin = (data.defects ?? []).filter((x) => x.area === 'cabin');
  const decision = (x: any) => x.dispatch_accepted === true ? 'DISPATCHABLE'
    : x.dispatch_accepted === false ? 'NOT DISPATCHABLE' : 'PENDING CDR';
  return _listDoc(data, 'CABIN DEFECT LOG', cabin,
    ['Defect', 'Raised', 'Captain decision', 'Status'],
    (x) => [`${esc(x.title)}${x.title ? ': ' : ''}${esc(x.description)}`, t(x.raised_at), decision(x), esc((x.status || '').toUpperCase())]);
}

// Stand-alone HOLD ITEM LIST (HIL) — deferred items carried forward per MEL/CDL.
export function hilHtml(data: TLData): string {
  const hil = (data.defects ?? []).filter((x) => x.status === 'deferred');
  return _listDoc(data, 'HOLD ITEM LIST (HIL)', hil,
    ['Item', 'ATA', 'MEL/CDL', 'Cat', 'Raised', 'Due'],
    (x) => [`${esc(x.title)}${x.title ? ': ' : ''}${esc(x.description)}`, esc(x.ata_chapter),
      esc(x.mel_ref || x.cdl_ref), esc(x.rect_interval), d(x.raised_at), esc(x.due_date)]);
}

function _listDoc(data: TLData, heading: string, items: any[], cols: string[], cells: (x: any) => string[]): string {
  const ac = data.aircraft; const s = data.sector;
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = items.length ? items.map((x) => `<tr>${cells(x).map((v, i) => `<td${i === 0 ? '' : ' class="c"'}>${v}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="c">NIL</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;margin:16px}
    h1{font-size:15px;margin:0;border-bottom:2px solid #000;padding-bottom:6px}
    .sub{font-size:10px;margin:4px 0 8px}
    table{border-collapse:collapse;width:100%} td,th{border:1px solid #000;padding:3px 5px}
    th{background:#eee;text-align:left;font-size:10px} .c{text-align:center}</style></head><body>
    <h1>${esc(heading)}</h1>
    <div class="sub">${OPERATOR} &nbsp;·&nbsp; <b>${esc(ac?.registration)}</b> ${esc(ac?.type)}
      &nbsp;·&nbsp; TLB Page ${esc(fmtTl(s?.page_no))} &nbsp;·&nbsp; ${d(s?.flight_date)} ${esc(s?.dep)}→${esc(s?.arr)}</div>
    <table><tr>${head}</tr>${body}</table>
  </body></html>`;
}

// Compact ESC/POS-style plain text for a 58/80mm Bluetooth thermal printer.
export function techLogText(data: TLData): string {
  const { sector: s, aircraft: ac } = data;
  const L = (k: string, v: any) => `${k.padEnd(9)}: ${v ?? ''}`;
  const lines = [
    OPERATOR, 'AIRCRAFT TECHNICAL LOG', '------------------------',
    L('A/C', `${ac?.registration ?? ''} ${ac?.type ?? ''}`),
    L('TLB PAGE', fmtTl(s.page_no) || ''),
    L('FLIGHT', `${s.flight_no ?? ''} ${d(s.flight_date)}`),
    L('ROUTE', `${s.dep ?? ''} -> ${s.arr ?? ''}`),
    L('OUT/IN', `${t(s.off_block)} / ${t(s.on_block)}`),
    L('OFF/ON', `${t(s.takeoff)} / ${t(s.landing)}`),
    L('BLK/FLT', `${s.block_time_min ?? ''}/${s.flight_time_min ?? ''} min`),
    L('UPLIFT', `${s.fuel_uplift_kg ?? ''} kg`),
    '------------------------', 'DEFECTS / HIL',
  ];
  const ds = data.defects ?? [];
  if (!ds.length) lines.push('  NIL');
  else ds.forEach((x) => lines.push(
    `  [${(x.area === 'cabin' ? 'CAB' : 'TEC')}] ${(x.title ? x.title + ': ' : '')}${x.description}`,
    `    ATA ${x.ata_chapter ?? '-'} ${x.mel_ref ? 'MEL ' + x.mel_ref + ' ' : ''}${(x.status || '').toUpperCase()}`));
  lines.push('------------------------',
    `RELEASE: ${s.released_at ? (KIND[s.release_kind] || s.release_kind) : 'NOT RELEASED'}`,
    `A/C: ${s.released_at ? (s.release_serviceable ? 'SERVICEABLE' : 'UNSERVICEABLE') : '-'}`,
    s.released_at ? `${d(s.released_at)} ${t(s.released_at)}` : '',
    '');
  return lines.join('\n');
}
