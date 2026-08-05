import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { syncPush } from '../api/client';
import { getSector, pullSector, updateSector } from '../db/sectors';
import { theme } from '../theme';
import { confirmAction } from '../util/confirm';

const isWeb = Platform.OS === 'web';

export const hhmm = (iso?: string) => (iso ? new Date(iso).toISOString().slice(11, 16) + 'z' : '—');
// minutes -> h:mm (flight/block hours)
export const hm = (min?: number | null) => (min == null ? '—' : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`);
const mins = (a?: string, b?: string) =>
  a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : undefined;
// Add one calendar day to a YYYY-MM-DD string (cross-midnight OOOI).
const nextDay = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
export const num = (v: any) => (v === '' || v == null ? null : Number(v));
// Strip anything that isn't a number from an input value. decimals=true keeps a single '.'
// (integer fields pass decimals=false). Use in onChangeText so numeric fields reject letters/paste.
export const numericOnly = (v: string, decimals = true): string => {
  let s = (v || '').replace(/,/g, '.');             // accept comma as decimal separator
  s = s.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, '');
  if (decimals) {                                   // keep only the first decimal point
    const i = s.indexOf('.');
    if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
  }
  return s;
};
// thousands separators for read-only figures (e.g. 12,300 · 1,234.5). Never use on an editable input value.
export const fmt = (v: any) => { const x = Number(v); return (v === '' || v == null || isNaN(x)) ? '' : x.toLocaleString('en-US', { maximumFractionDigits: 1 }); };
// airframe hours (TSN) as H:MM with thousands separators on the hours, e.g. 47,484:58
export const fmtHM = (hours: any) => {
  const x = Number(hours);
  if (hours === '' || hours == null || isNaN(x)) return '—';
  const total = Math.round(x * 60);
  const hh = Math.floor(total / 60), mm = total % 60;
  return hh.toLocaleString('en-US') + ':' + String(mm).padStart(2, '0');
};
const round1 = (x: number) => Math.round(x * 10) / 10;
export { round1 };

const OOOI_LABEL: Record<string, string> = {
  off_block: 'Off Blocks', takeoff: 'Take-off', landing: 'Landed', on_block: 'On Blocks',
};

export function useSector(sectorId: string) {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [syncing, setSyncing] = useState(true);   // initial server pull in flight — screens block input

  const reload = useCallback(async () => { setS(await getSector(sectorId)); }, [sectorId]);
  const refresh = useCallback(async () => { setS(await pullSector(sectorId)); }, [sectorId]);
  useEffect(() => {
    let alive = true;
    const done = () => { if (alive) setSyncing(false); };
    if (isWeb) {
      // Web has no local SQLite — must fetch from server.
      const t = setTimeout(done, 6000);
      refresh().then(done).catch(done).finally(() => clearTimeout(t));
      return () => { alive = false; clearTimeout(t); };
    }
    // iPad: read local SQLite only — no server call on screen entry.
    // Data was synced at login; the 30 s syncPush cycle keeps it current.
    reload().then(done).catch(done);
    return () => { alive = false; };
  }, [sectorId]);

  async function save(patch: any) {
    const next = await updateSector(sectorId, patch);
    setS(next); setMsg('Saved');
    syncPush().then(() => setMsg('Saved ✓ synced')).catch(() => setMsg('Saved · offline (queued)'));
  }
  async function setTime(field: string, iso: string) {
    const n = { ...s, [field]: iso };
    await save({ [field]: iso, block_time_min: mins(n.off_block, n.on_block), flight_time_min: mins(n.takeoff, n.landing) });
  }
  const stamp = (f: string) => setTime(f, new Date().toISOString());
  function setManual(field: string, t: string) {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(t.trim());
    if (!m || !s) return;
    // Cross-midnight: if the typed HH:MM is earlier than the preceding OOOI event, the flight
    // crossed midnight → add one day.  The OOOI sequence is OUT → OFF → ON → IN; each event's
    // date is anchored to the immediately preceding event's timestamp.  For OFF (the first event)
    // the anchor is STD — a flight delayed past midnight (STD 2300, actual OUT 0030) rolls over.
    const OOOI = ['off_block', 'takeoff', 'landing', 'on_block'] as const;
    const idx = OOOI.indexOf(field as any);
    let anchor: string | undefined;
    for (let i = idx - 1; i >= 0; i--) { if ((s as any)[OOOI[i]]) { anchor = (s as any)[OOOI[i]]; break; } }
    if (!anchor && s.std) anchor = s.std;          // OFF with no preceding OOOI → use STD
    const hh = m[1].padStart(2, '0'), mm = m[2];
    const newMin = parseInt(hh) * 60 + parseInt(mm);
    let date: string;
    if (anchor) {
      const aDate = anchor.slice(0, 10);
      const aMin = parseInt(anchor.slice(11, 13)) * 60 + parseInt(anchor.slice(14, 16));
      date = newMin < aMin ? nextDay(aDate) : aDate;
    } else {
      date = s.flight_date || new Date().toISOString().slice(0, 10);
    }
    setTime(field, `${date}T${hh}:${mm}:00Z`);
  }
  // Clear an OOOI time (e.g. return-to-stand: clear Off-blocks and re-stamp on the next push-back).
  async function clearTime(field: string) {
    if (!s) return;
    const n = { ...s, [field]: null };
    await save({ [field]: null, block_time_min: mins(n.off_block, n.on_block), flight_time_min: mins(n.takeoff, n.landing) });
  }
  return { s, msg, syncing, save, stamp, setManual, clearTime, reload, refresh };
}

// Schedule / ETA: ETA = STA shifted by the departure delay (actual off-block vs STD).
export function schedule(s: any): { sta?: string; eta?: string; delayMin: number; arrived: boolean } {
  if (!s?.sta) return { delayMin: 0, arrived: !!s?.on_block };
  const sta = new Date(s.sta).getTime();
  let delayMs = 0;
  if (s.std && s.off_block) delayMs = Math.max(0, new Date(s.off_block).getTime() - new Date(s.std).getTime());
  return { sta: s.sta, eta: s.on_block || new Date(sta + delayMs).toISOString(), delayMin: Math.round(delayMs / 60000), arrived: !!s.on_block };
}

// EFF import highlight — a value pulled from the EFF flight folder shows bold blue with a blue left
// accent so it reads as "imported, still untouched"; the red `bad` (missing/invalid) style always
// wins over it. Once the crew edits the field the screen prunes the key and it reverts to normal.
export const effInputStyle = { color: theme.eff, fontWeight: '700' as const, borderColor: theme.eff, borderLeftWidth: 3 };
export const effHintStyle = { color: theme.eff, fontSize: 10, fontWeight: '700' as const };
// Inline " · from EFF" tag appended to a field label. Renders nothing when `on` is false.
export function EffHint({ on }: { on?: boolean }) {
  return on ? <Text style={effHintStyle}> · from EFF</Text> : null;
}
// One-line legend shown near a section header when any field in it is EFF-sourced.
export function EffLegend({ show }: { show?: boolean }) {
  if (!show) return null;
  return <Text style={{ color: theme.eff, fontSize: 11, fontWeight: '600', marginTop: 2, marginBottom: 4 }}>● Blue = imported from EFF (editable)</Text>;
}

export function NumField({ label, value, onChange, bad, eff, onLayout, decimals = true }: any) {
  const effOn = !!eff && !bad;   // red `bad` takes precedence over the blue EFF style
  return (
    <View style={styles.field} onLayout={onLayout}>
      <Text style={styles.lbl}>{label}<EffHint on={effOn} /></Text>
      <TextInput style={[styles.input, effOn ? effInputStyle : null, bad ? { borderColor: '#d7263d', borderWidth: 2 } : null]} value={value == null ? '' : String(value)}
        keyboardType="decimal-pad" inputMode={decimals ? 'decimal' : 'numeric'}
        onChangeText={(v) => onChange(numericOnly(v, decimals))} />
    </View>
  );
}

// Controlled OOOI time input — auto-formats as HH:MM, auto-saves on valid 4-digit entry.
// The old uncontrolled input (defaultValue + onEndEditing) silently lost manual times when the
// keyboard wasn't dismissed — the sign button stayed disabled because the sector record was never
// updated. This controlled version saves as soon as 4 valid digits are entered.
function OOOITimeInput({ field, sector, setManual, disabled, isEff, onEdit }: {
  field: string; sector: any; setManual: (f: string, t: string) => void;
  disabled?: boolean; isEff?: boolean; onEdit?: () => void;
}) {
  const saved = sector[field] ? hhmm(sector[field]).replace('z', '') : '';
  const [text, setText] = useState(saved);
  const lastSaved = useRef(saved);
  // Sync displayed text when the saved value changes externally (stamp, sync, clear).
  useEffect(() => { if (saved !== lastSaved.current) { setText(saved); lastSaved.current = saved; } }, [saved]);

  function handleChange(raw: string) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 4);
    let fmt = digits;
    if (digits.length > 2) fmt = digits.slice(0, 2) + ':' + digits.slice(2);
    setText(fmt);
    if (digits.length === 4) {
      const hh = parseInt(digits.slice(0, 2), 10);
      const mm = parseInt(digits.slice(2), 10);
      if (hh <= 23 && mm <= 59) {
        lastSaved.current = fmt;          // prevent the useEffect from clobbering during save
        if (onEdit) onEdit();
        setManual(field, fmt);
      }
    }
  }

  return (
    <TextInput
      style={[styles.oooiInput, disabled && { opacity: 0.4 }, isEff ? effInputStyle : null]}
      editable={!disabled}
      keyboardType="numbers-and-punctuation"
      value={text}
      placeholder="hh:mm"
      placeholderTextColor={theme.sub}
      onChangeText={handleChange}
      maxLength={5}
    />
  );
}

// OOOI stamp tiles + manual inputs for the given fields.
// effSet/onEdit: OOOI times imported from EFF render blue; stamping or typing one prunes it (onEdit).
export function OOOISection({ s, fields, stamp, setManual, clear, disabled, effSet, onEdit }: any) {
  const isEff = (f: string) => !!effSet && effSet.has(f);
  const edit = (f: string) => { if (isEff(f) && onEdit) onEdit(f); };   // any manual change/stamp → no longer EFF
  return (
    <>
      <View style={styles.oooiRow}>
        {fields.map((f: string) => (
          <TouchableOpacity key={f} style={[styles.oooiBtn, disabled && { opacity: 0.4 }, isEff(f) ? { borderColor: theme.eff, borderLeftWidth: 3 } : null]} disabled={disabled} onPress={() => { edit(f); stamp(f); }}
            onLongPress={!disabled && clear ? async () => { if (await confirmAction(`Clear ${OOOI_LABEL[f]} time?\n(e.g. delay / return to stand — re-stamp on the next push-back)`)) { edit(f); clear(f); } } : undefined}>
            <Text style={styles.oooiLbl}>{OOOI_LABEL[f]}<EffHint on={isEff(f)} /></Text>
            <Text style={[styles.oooiVal, isEff(f) ? { color: theme.eff } : null]}>{hhmm(s[f])}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.oooiRow}>
        {fields.map((f: string) => (
          <OOOITimeInput key={f} field={f} sector={s} setManual={setManual} disabled={disabled}
            isEff={isEff(f)} onEdit={() => edit(f)} />
        ))}
      </View>
      {!disabled ? <Text style={styles.sub}>Tap to stamp now{clear ? ' · long-press to clear (return to stand)' : ''} · or type UTC time (auto-formats hh:mm).</Text> : null}
    </>
  );
}

export const sx = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 4 },
  msg: { color: theme.green, marginTop: 6 },
  // modern section header — uppercase label with a hairline divider
  section: { color: theme.text, fontWeight: '800', fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase',
    marginTop: 22, marginBottom: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: theme.border },
  // grouped content panel
  card: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, marginTop: 2 },
  subhead: { color: theme.sub, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 6, maxWidth: 320 },
  save: { borderRadius: 8, padding: 13, alignItems: 'center', marginTop: 10, maxWidth: 360, backgroundColor: theme.green },
  saveText: { color: '#fff', fontWeight: '700' },
});

const styles = StyleSheet.create({
  field: { width: 150, marginBottom: 10 },
  lbl: { color: theme.sub, fontSize: 12, marginBottom: 4 },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 },
  sub: { color: theme.sub, marginTop: 4 },
  oooiRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  oooiBtn: { flex: 1, maxWidth: 210, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  oooiLbl: { color: theme.sub, fontSize: 12 },
  oooiVal: { color: theme.text, fontWeight: '800', fontSize: 16, marginTop: 2 },
  oooiInput: { flex: 1, maxWidth: 210, backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 8, textAlign: 'center' },
});
