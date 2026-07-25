import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { aircraftStatus, can, CheckStatus, closedDefects, ClosingItem, Correction, currentAircraft, DefectBrief, listCorrections, MfaRequired, raiseCorrection, ReleaseStatus, releaseSector, releaseStatus, requestCrsReset, revokeRelease, saveMaintWork, sectorDetail, setClosedDefects, sectorTlHtml, sectorTlHtmlCached, userLicence, userName, sectorCheckOverrideMechanic } from '../api/client';
import { finalizeServiceable } from '../util/finalize';
import RoBanner from '../components/RoBanner';
import OfflineFlash from '../components/OfflineFlash';
import { deleteSector, getSector, localReleaseStatus, markLocalReleased } from '../db/sectors';
import { getSectorDefects } from '../db/defects';
import { airPrint, bluetoothAvailable, bluetoothPrint, printHtml, printServerPdf, shareHtml, sharePdf } from '../print';
import SignaturePad from '../components/SignaturePad';
import HilRemaining from '../components/HilRemaining';
import AmmPicker from '../components/AmmPicker';
import MelPicker from '../components/MelPicker';
import CdlPicker from '../components/CdlPicker';
import { ammIawLine } from '../api/client';
import { confirmAction } from '../util/confirm';
import { theme } from '../theme';

// Assemble the TL from the server, or fall back to the local cache when offline.
async function tlData(sectorId: string) {
  try { return await sectorDetail(sectorId); }
  catch {
    const sector = await getSector(sectorId);
    const defects = await getSectorDefects(sectorId);
    return { sector, aircraft: { registration: sector?.aircraft_id }, defects, signatures: [] };
  }
}

const KIND: Record<string, string> = {
  nil: 'NIL DEFECT', deferred: 'Deferred (MEL/HIL)', rectified: 'Defect rectified', with_defects: 'Released with defects',
};

export default function ReleaseScreen({ route, navigation }: any) {
  const { sectorId } = route.params;
  const [st, setSt] = useState<ReleaseStatus | null>(null);
  const [note, setNote] = useState('');
  const [workDone, setWorkDone] = useState('');       // action taken for a standalone W/O (maintenance log)
  const [workSaved, setWorkSaved] = useState('');     // last-saved value, to show the Save state
  const [woRef, setWoRef] = useState('');             // editable W/O ref / scope — build up the TL with more work
  const [woSaved, setWoSaved] = useState('');
  const [maintBad, setMaintBad] = useState<{ wo?: boolean; work?: boolean }>({});   // highlight missing mandatory fields on Complete
  const [ammOpen, setAmmOpen] = useState(false);
  const [melOpen, setMelOpen] = useState(false);
  const [cdlOpen, setCdlOpen] = useState(false);
  const [clearSel, setClearSel] = useState<Set<string>>(new Set());   // defects / HIL ticked to clear on this TL
  const toggleClear = (d: any) => {
    const has = clearSel.has(d.id);
    setClearSel((prev) => { const n = new Set(prev); has ? n.delete(d.id) : n.add(d.id); return n; });
    if (!has) {   // ticking: auto-add its HIL / MEL / CDL reference to the work carried out
      const bits = [d.hil_no ? `HIL ${d.hil_no}` : null, d.mel_ref ? `MEL ${d.mel_ref}` : null, d.cdl_ref ? `CDL ${d.cdl_ref}` : null,
        (!d.mel_ref && !d.cdl_ref && d.approved_ref) ? `Approved data ${d.approved_ref}` : null].filter(Boolean);
      const ref = [bits.join(' · '), d.title || d.description].filter(Boolean).join(' — ');
      if (ref) setWorkDone((w) => (w || '').includes(ref) ? w : (w.trim() ? `${w.trim()}\n${ref}` : ref));
    }
  };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [finalize, setFinalize] = useState<{ frac: number; label: string } | null>(null);   // post-release progress
  const [signing, setSigning] = useState(false);     // signature pad open
  const [previewing, setPreviewing] = useState(false);
  const previewingRef = useRef(false);   // synchronous re-entry guard (state is async — double-fire opens twice)
  const [sig, setSig] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [signer, setSigner] = useState(userName() ?? '');   // pre-filled from profile, editable
  const [licence, setLicence] = useState(userLicence() ?? '');   // pre-filled from profile, editable
  const [showReset, setShowReset] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const isMech = can('release', 'crs');

  const [checks, setChecks] = useState<CheckStatus[]>([]);
  const [closing, setClosing] = useState<ClosingItem[] | null>(null);   // maintenance log: items this TL page claims
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [corr, setCorr] = useState({ field: '', new_value: '', reason: '' });
  const [showCorr, setShowCorr] = useState(false);
  const load = useCallback(() => {
    releaseStatus(sectorId).then((r) => {
      setSt(r); const w = (r as any).work_performed || ''; setWorkDone(w); setWorkSaved(w); const o = (r as any).wo_ref || ''; setWoRef(o); setWoSaved(o);
      if ((r as any).checks) setChecks((r as any).checks);   // sector-scoped; shows 2/10-day currency even when current
      // Fold locally-signed (offline) checks using the sector's OWN tail — not currentAircraft, which is
      // unset when the Sign-off is opened straight from Your Sectors.
      const reg = (r as any).registration || currentAircraft()?.registration;
      if (reg) aircraftStatus(reg).then((x) => setChecks(x.checks || [])).catch(() => {});
    })   // online → authoritative
      .catch(() => localReleaseStatus(sectorId).then(setSt).catch(() => setMsg('Release page unavailable offline for this sector.')));
    listCorrections(sectorId).then(setCorrections).catch(() => {});
    // Direct server call — the endpoint 404s for flight sectors (card hidden); never depend on the
    // local copy (a server-created maintenance log may not be in the device DB yet).
    closedDefects(sectorId).then((r) => setClosing(r.items)).catch(() => setClosing(null));
  }, [sectorId]);

  async function saveWork() {
    try {
      const r: any = await saveMaintWork(sectorId, { work_performed: workDone, wo_ref: woRef });
      setWorkSaved(workDone); setWoSaved(woRef);
      setMsg(r?.queued ? 'Work saved offline — will sync ✓' : 'Work order saved ✓');
    } catch (e: any) { setMsg(`Could not save: ${e.message}`); }
  }
  // Complete the Tech Log = sign the CRS (releases the aircraft, closing every item on the page).
  // Used by the button in the W/O box and the one at the bottom of the page.
  function completeTL() {
    // A FLIGHT CRS must clear open defects + the delayed-OASES bridge; a MAINTENANCE TL never blocks
    // on those (it certifies the work — the aircraft stays unserviceable for dispatch).
    if (!((st as any).maintenance_only)) {
      const unticked = (st!.blockers || []).filter((b) => !clearSel.has(b.id));
      if (unticked.length) { setMsg('Defer (MEL/HIL) or rectify the open defect(s) before the flight CRS.'); return; }
      const bp = !!((st as any).check_blockers?.length) && !((st as any).check_override?.mechanic_by);
      if (bp) { setMsg('Confirm the delayed-OASES conditions first (card above the defect list).'); return; }
    } else {
      // Maintenance TL: the work order / scope and the work carried out are mandatory. Don't disable
      // the button — highlight what's missing when it's pressed so the mechanic sees why.
      const bad = { wo: !woRef.trim(), work: !workDone.trim() };
      if (bad.wo || bad.work) {
        setMaintBad(bad);
        setMsg(bad.wo && bad.work ? 'Enter the Work order / scope and the Work carried out before completing.'
          : bad.wo ? 'Enter the Work order / scope before completing.'
          : 'Enter the Work carried out before completing.');
        return;
      }
      setMaintBad({});
    }
    if (!signer.trim() || !licence.trim()) { setMsg('Enter your name and licence, then Complete.'); return; }
    sig ? submitRelease(sig) : setSigning(true);
  }
  // Discard an unsigned maintenance Tech Log opened by mistake / no longer required (double-confirm).
  // Only possible BEFORE the CRS is signed — once released it is an official record (reset/back office).
  async function discardTL() {
    if (!(await confirmAction('Discard this maintenance Tech Log?\n\nIt was opened but not signed — this removes it entirely, including any draft work order, ticked items and component-change entries on it.', 'Discard Tech Log'))) return;
    if (!(await confirmAction('Confirm once more — permanently delete this Tech Log? This cannot be undone.', 'Confirm delete'))) return;
    try { await deleteSector(sectorId); navigation.goBack(); }
    catch (e: any) {
      setMsg(/409|released|signed|closed/i.test(e?.message || '')
        ? 'This Tech Log is already signed/closed and can no longer be discarded — request a CRS reset or ask the back office.'
        : (e?.message || 'Could not discard the Tech Log.'));
    }
  }
  async function submitCorrection() {
    if (!corr.reason.trim()) { setMsg('Enter a reason for the correction.'); return; }
    try {
      await raiseCorrection(sectorId, { field: corr.field.trim() || undefined, new_value: corr.new_value.trim() || undefined, reason: corr.reason.trim() });
      setCorr({ field: '', new_value: '', reason: '' }); setShowCorr(false); setMsg('Correction raised ✓'); load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }
  async function submitResetRequest() {
    if (resetReason.trim().length < 15) { setMsg('Enter a full reason (at least 15 characters) for the CRS reset.'); return; }
    try { await requestCrsReset(sectorId, resetReason.trim()); setResetReason(''); setShowReset(false); setMsg('CRS reset requested — pending CAMO Manager approval.'); load(); }
    catch (e: any) { setMsg(/departed|correction/i.test(e?.message || '') ? 'Aircraft has departed / closed — the CRS cannot be reset. Raise a correction instead.' : (e?.message || 'Could not submit the reset request.')); }
  }
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Preview the Tech Log / CRS page for this sector before signing (writes nothing).
  async function previewCRS() {
    if (previewingRef.current) return;                         // synchronous guard: never open the preview twice
    previewingRef.current = true;
    setPreviewing(true); setMsg('');
    // On a maintenance TL, preview ONLY the ticked items + the W/O (not every open aircraft defect).
    const q = (st as any)?.maintenance_only && clearSel.size ? `?preview_clear=${Array.from(clearSel).join(',')}` : '';
    try {
      if (await printServerPdf(`/sectors/${sectorId}/pdf${q}`)) { setMsg(''); return; }     // server PDF: header + Page N of X
      const { html } = await sectorTlHtml(sectorId, q).catch(() => ({ html: '' })); if (html) await printHtml(html);
    }
    catch (e: any) { setMsg(/network|connection|offline|cached/i.test(e?.message || '') ? 'Open this Tech Log once online to view it offline.' : (e?.message || 'Could not open the preview.')); }
    finally { previewingRef.current = false; setPreviewing(false); }
  }

  // Sign first, then submit the release with signature (+ MFA code).
  async function resetReleaseBeforeDep() {
    if (!(await confirmAction('Reset this CRS to correct the release and sign again?\n\nIf the commander has already accepted, their acceptance is voided — they must approve again before flight. Allowed only before the aircraft departs.', 'Reset CRS'))) return;
    setBusy(true); setMsg('');
    try {
      const r: any = await revokeRelease(sectorId);
      setMsg(r?.acceptance_voided ? 'CRS reset — commander acceptance voided; they must approve again.' : 'CRS reset — make your changes and sign again.');
      load();
    } catch (e: any) {
      setMsg(e?.message?.includes('409') ? 'Cannot reset — the aircraft has departed. Request a correction via Feedback.' : (e?.message || 'Could not reset the CRS.'));
    } finally { setBusy(false); }
  }
  async function submitRelease(signature: string) {
    setBusy(true); setMsg('');
    try {
      if ((st as any)?.maintenance_only && (workDone !== workSaved || woRef !== woSaved)) {   // persist any unsaved W/O first
        await saveMaintWork(sectorId, { work_performed: workDone, wo_ref: woRef }).then(() => { setWorkSaved(workDone); setWoSaved(woRef); }).catch(() => {});
      }
      const r: any = await releaseSector(sectorId, {
        note: note.trim() || undefined, signer_name: signer.trim() || undefined,
        licence_no: licence.trim() || undefined, signature_image: signature, otp: otp.trim() || undefined,
        clear_ids: Array.from(clearSel),
      });
      setSig(null); setOtp(''); setNeedOtp(false);
      if (r?.queued) {
        const kind = st?.deferred?.length ? 'deferred' : (st?.serviceable ? 'nil' : 'rectified');
        await markLocalReleased(sectorId, { by: signer.trim() || undefined, kind, note: note.trim() || undefined }).catch(() => {});
        setSt((prev: any) => prev ? { ...prev, released: true, release: { by: signer.trim() || undefined, kind, note: note.trim() || undefined } } : prev);
        setMsg('CRS released offline — will sync when back online ✓');
      } else {
        setMsg(`Released · ${KIND[r.kind] || r.kind}`); load();
      }
      // Walk record→sync→serviceability so the crew see the aircraft cleared for departure.
      setFinalize({ frac: 0.15, label: 'Issuing the CRS…' });
      const reg = currentAircraft()?.registration;
      if (reg) {
        const { status } = await finalizeServiceable(reg, setFinalize, {
          finalLabel: (online, svc) => online
            ? (svc === false ? '✓ Released — deferred item(s) remain on the Hold Item List' : '✓ Released — aircraft cleared for departure')
            : '✓ Released offline — syncs when back online',
        });
        if (status?.checks) setChecks(status.checks);
        setTimeout(() => setFinalize(null), 2800);
      } else { setFinalize(null); }
      Alert.alert('Before leaving the aircraft',
        'Confirm before you leave:\n\n•  all flight-crew iPads are synced\n•  the tech log is backed up to the server (when you reconnect)');
    } catch (e: any) {
      if (e instanceof MfaRequired) { setSig(signature); setNeedOtp(true); setMsg('Enter your authenticator code to release.'); }
      else if (/licen[cs]e/i.test(e.message || '')) { setSig(signature); setMsg(`${e.message}. Correct the licence and release again.`); }   // keep the signature — retry the licence only
      else setMsg(`Failed: ${e.message}`);
    } finally { setBusy(false); }
  }

  async function print(kind: 'air' | 'pdf' | 'bt', doc: 'tl' | 'cabin' | 'hil' = 'tl') {
    try {
      // For the full TL, prefer the server-rendered complete form (carry-over defects,
      // all fields, logo); fall back to the local renderer when offline.
      if (doc === 'tl' && kind !== 'bt') {
        try {
          const { html } = await sectorTlHtmlCached(sectorId);   // server VAW-ETL-01, cached for offline
          if (kind === 'air') { if (await printServerPdf(`/sectors/${sectorId}/pdf`)) return; return await printHtml(html); }
          return await shareHtml(html);
        } catch { /* not cached (e.g. released offline, never synced) → local render below */ }
      }
      const data = await tlData(sectorId);
      if (kind === 'air') await airPrint(data, doc);
      else if (kind === 'pdf') await sharePdf(data, doc);
      else await bluetoothPrint(data);
    } catch (e: any) { Alert.alert('Print', e.message); }
  }

  if (!st) return <View style={s.wrap}>{msg ? <Text style={s.sub}>{msg}</Text> : <><ActivityIndicator color={theme.accent} /><Text style={s.sub}>Loading…</Text></>}</View>;

  const svc = st.serviceable;
  // Delayed-OASES bridge (checks OR overdue hold items): once the certifying staff have confirmed
  // the conditions for this leg (check_override.mechanic_by set), they no longer block the CRS — the
  // server allows the release. Only an UNCONFIRMED bridge condition holds the button.
  // The delayed-OASES bridge is a FLIGHT-release concept (dispatch). A maintenance TL certifies work
  // and doesn't dispatch, so the bridge never applies there.
  const bridgePending = !(st as any).maintenance_only && !!(st as any).check_blockers?.length && !(st as any).check_override?.mechanic_by;
  const bridgeIsHil = ((st as any).check_blockers || []).some((r: string) => /hold item/i.test(r));
  // Completing a MAINTENANCE Tech Log certifies the work — it is gated only by OPEN blocking defects
  // (which must be cleared/ticked or deferred first). Deferred HILs (in-date or overdue) do NOT block
  // it: they are the commander's dispatch concern, and completing the TL does not release the aircraft
  // for a flight. A ticked blocker is cleared on release, so it no longer blocks. Flight releases still
  // require the delayed-OASES bridge.
  const untickedBlockers = (st.blockers || []).filter((b) => !clearSel.has(b.id)).length;
  const untickedOverdue = (st.deferred || []).filter((d: any) => d.overdue && !clearSel.has(d.id)).length;
  // A MAINTENANCE Tech Log can always be accomplished (it certifies the work carried out) — open
  // blocking defects and overdue HILs keep the aircraft unserviceable for DISPATCH but never block
  // signing the TL. Only a FLIGHT CRS is gated by open defects + the delayed-OASES bridge.
  const relLocked = (st as any).maintenance_only ? false : (st.blockers.length > 0 || bridgePending);
  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={[s.banner, { backgroundColor: svc ? '#11351d' : '#3a1111', borderColor: svc ? theme.green : theme.red }]}>
        <Text style={[s.bannerTxt, { color: svc ? theme.green : theme.red }]}>
          {svc ? '● AIRCRAFT SERVICEABLE' : '▲ AIRCRAFT UNSERVICEABLE'}
        </Text>
        <Text style={s.sub}>{svc ? 'No defect holds dispatch.' : 'Open technical defect(s) hold the aircraft.'}</Text>
      </View>

      {(st as any).maintenance_only ? (
        <View style={{ backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginBottom: 4 }}>
          <Text style={{ color: theme.text, fontWeight: '800' }}>Ground Maintenance{(st as any).station ? ` · ${(st as any).station}` : ''}</Text>
          <Text style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>To accomplish the work order and clear defects.</Text>
          {route?.params?.resumed ? <Text style={{ color: theme.accent, fontSize: 12, marginTop: 2, fontWeight: '700' }}>✓ Resumed today's open Tech Log page — continue the work order here.</Text> : null}
          {/* Build up ONE Tech Log: edit / add work orders + task cards here, clear HILs / defects
              below, then a single CRS clears all. Standalone W/O releases even with NIL defects. */}
          {isMech ? (
            <>
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '800', marginTop: 8 }}>Work order(s) / scope <Text style={{ color: theme.red }}>*</Text>{(st as any).tl ? <Text style={{ color: theme.accent, fontWeight: '800' }}>   ·   TL #{(st as any).tl}</Text> : null}</Text>
              <TextInput style={[s.input, { minHeight: Math.max(56, woRef.split('\n').length * 22 + 24), textAlignVertical: 'top' }, maintBad.wo ? { borderColor: theme.red, borderWidth: 2 } : null]}
                value={woRef} onChangeText={(v) => { setWoRef(v); if (maintBad.wo) setMaintBad((b) => ({ ...b, wo: false })); }} multiline
                placeholder="Work order / task-card ref(s) and scope. Task Card / MEL / CDL below optional." placeholderTextColor={theme.sub} />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start' }]} onPress={() => setAmmOpen(true)}><Text style={s.btnTxt}>＋ Task Card (AMM)</Text></TouchableOpacity>
                <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start' }]} onPress={() => setMelOpen(true)}><Text style={s.btnTxt}>Pick MEL</Text></TouchableOpacity>
                <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start' }]} onPress={() => setCdlOpen(true)}><Text style={s.btnTxt}>Pick CDL</Text></TouchableOpacity>
                {/* Component Change Record — removed/installed parts (P/N & S/N off/on + Form 1); entries print on this Tech Log. */}
                <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start' }]} onPress={() => navigation.navigate('ComponentChange', { sectorId })}><Text style={s.btnTxt}>🔧 CCR</Text></TouchableOpacity>
              </View>
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '800', marginTop: 10 }}>Work carried out / action taken <Text style={{ color: theme.red }}>*</Text></Text>
              <TextInput style={[s.input, { minHeight: Math.max(64, workDone.split('\n').length * 22 + 28), textAlignVertical: 'top' }, maintBad.work ? { borderColor: theme.red, borderWidth: 2 } : null]}
                value={workDone} onChangeText={(v) => { setWorkDone(v); if (maintBad.work) setMaintBad((b) => ({ ...b, work: false })); }} multiline
                placeholder="Describe the maintenance carried out (e.g. Replaced RH landing light i.a.w AMM 33-42, ops check satisfactory). Ticking a defect / HIL below adds its reference here." placeholderTextColor={theme.sub} />
              {/* Save draft always shown, but unclickable until the work carried out is entered. The
                  work is also saved automatically when you sign the CRS — Save is only for drafts. */}
              {(() => { const dirty = workDone !== workSaved || woRef !== woSaved; const canSave = !!workDone.trim() && dirty; return (
                <TouchableOpacity disabled={!canSave} style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', opacity: canSave ? 1 : 0.5 }]} onPress={saveWork}>
                  <Text style={s.btnTxt}>{!dirty && (workDone.trim() || woRef.trim()) ? '✓ Draft saved' : 'Save draft'}</Text>
                </TouchableOpacity>
              ); })()}
              <AmmPicker visible={ammOpen} reg={currentAircraft()?.registration} onClose={() => setAmmOpen(false)}
                onPick={(m: any) => { const line = ammIawLine(m); setWorkDone((n) => n.trim() ? `${n.trim()}\n${line}` : line); if (m.task_card_ref) setWoRef((w) => (w || '').split(',').map((x) => x.trim()).filter(Boolean).includes(m.task_card_ref) ? w : (w ? `${w}, ${m.task_card_ref}` : m.task_card_ref)); setAmmOpen(false); }} />
              <MelPicker visible={melOpen} onClose={() => setMelOpen(false)}
                onPick={(m: any) => { const ref = `MEL ${m.ata || ''} · ${m.item}${m.category ? ` (Cat ${m.category}${m.rectification_interval ? `, ${m.rectification_interval}` : ''})` : ''}`.replace(/\s+/g, ' ').trim(); setWoRef((w) => w.trim() ? `${w.trim()}\n${ref}` : ref); setMelOpen(false); }} />
              <CdlPicker visible={cdlOpen} onClose={() => setCdlOpen(false)}
                onPick={(c: any) => { const ref = `CDL ${c.ata || ''}${c.code ? ` (${c.code})` : ''} · ${c.item || c.system}${c.dispatch ? ` — ${c.dispatch}` : ''}`.replace(/\s+/g, ' ').trim(); setWoRef((w) => w.trim() ? `${w.trim()}\n${ref}` : ref); setCdlOpen(false); }} />
            </>
          ) : (st as any).work_performed || (st as any).wo_ref ? (
            <Text style={{ color: theme.sub, fontSize: 12, marginTop: 8 }}>{(st as any).wo_ref ? `W/O: ${(st as any).wo_ref}` : ''}{(st as any).work_performed ? `\nWork carried out: ${(st as any).work_performed}` : ''}</Text>
          ) : null}
          {isMech ? (
            <View style={{ borderTopWidth: 1, borderTopColor: theme.border, marginTop: 12, paddingTop: 10, gap: 6 }}>
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '800' }}>This Tech Log — build it up, then complete it</Text>
              <Text style={{ color: theme.sub, fontSize: 12 }}>
                • Add another W/O or task card with the Task Card / MEL / CDL buttons above.{'\n'}
                • <Text style={{ fontWeight: '700' }}>Tick the defects / HIL to clear</Text> in the lists further down — the work above is their action taken.{'\n'}
                • To raise a NEW defect, use the <Text style={{ fontWeight: '700' }}>Defects</Text> page.
              </Text>
              {clearSel.size ? <Text style={{ color: theme.green, fontSize: 12, fontWeight: '700' }}>✓ {clearSel.size} item(s) ticked to clear on this Tech Log.</Text> : null}
              {untickedOverdue ? <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>ℹ {untickedOverdue} hold item(s) overdue — the aircraft stays unserviceable until each is extended (tap the HIL) or cleared. You can still complete this Tech Log.</Text> : null}
              {/* Certifying staff — prefilled from profile, editable. Needed to complete/sign the TL. */}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <TextInput style={[s.input, { flex: 1, minWidth: 160, marginTop: 0 }]} value={signer} onChangeText={setSigner} placeholder="Mechanic name *" placeholderTextColor={theme.sub} />
                <TextInput style={[s.input, { flex: 1, minWidth: 160, marginTop: 0 }]} value={licence} onChangeText={setLicence} placeholder="Licence / Part-145 auth no. *" placeholderTextColor={theme.sub} autoCapitalize="characters" />
              </View>
              {/* Preview then Complete — on one line. Completing signs the Tech Log (closing ticked items
                  + the W/O and releasing); the signature pad opens next. */}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity style={[s.btn, { flex: 1, marginTop: 0, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} disabled={previewing} onPress={previewCRS}>
                  <Text style={s.btnTxt}>{previewing ? 'Opening…' : '👁 Preview TL'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, { flex: 1, marginTop: 0, backgroundColor: relLocked ? '#444' : theme.green }]} disabled={busy || relLocked} onPress={completeTL}>
                  <Text style={s.btnTxt}>✍ Complete the Tech Log — Sign</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ color: theme.sub, fontSize: 11 }}>Completing signs this Tech Log and certifies the maintenance — it closes the ticked items + the W/O. It does NOT release the aircraft for a flight; the commander accepts that separately. A W/O with no defects completes NIL-defect.</Text>
              <Text style={{ color: theme.sub, fontSize: 11 }}>The Tech Log can be modified before the flight departs, or before the CRS is signed — whichever applies.</Text>
              {/* Discard an unsigned log opened by mistake / no longer required (double-confirm). Once
                  the CRS is signed it becomes an official record and this is no longer offered. */}
              {!st.released ? (
                <TouchableOpacity style={{ alignSelf: 'flex-start', marginTop: 12, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.red }} onPress={discardTL}>
                  <Text style={{ color: theme.red, fontWeight: '800', fontSize: 13 }}>🗑 Discard this Tech Log</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {checks.length ? (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
          {checks.map((c) => {
            const pending = !c.baseline;
            const color = (pending || c.expired) ? theme.red : (c.days_left != null && c.days_left <= 1 ? '#ffb84d' : theme.green);
            return (
              <View key={c.kind} style={{ flex: 1, borderWidth: 1, borderColor: color, borderRadius: 8, padding: 10 }}>
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 13 }}>{c.label}</Text>
                <Text style={{ color, fontSize: 11, marginTop: 2, fontWeight: '700' }}>
                  {pending ? 'Pending — due ASAP' : c.expired ? `OVERDUE · was ${c.due?.slice(0, 10)}` : `Due ${c.due?.slice(0, 10)} · ${c.days_left}d ${c.hours_left != null ? `${Math.round((c.hours_left % 24))}h` : ''} left`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {bridgePending ? (
        <View style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.accent, borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <Text style={{ color: theme.text, fontWeight: '800' }}>Certifying staff confirmation required — delayed OASES update</Text>
          <Text style={[s.sub, { marginTop: 4 }]}>The following show unserviceable due to the delayed OASES update. As certifying staff, confirm they are resolved before signing the CRS — the commander then signs the acceptance on the strength of your CRS:</Text>
          {(((st as any).check_override?.conditions || (st as any).check_blockers) || []).map((r: string) => (
            <Text key={r} style={{ color: theme.red, fontSize: 13, fontWeight: '700', marginTop: 4 }}>  • {r}</Text>
          ))}
          <TouchableOpacity style={{ backgroundColor: theme.accent, borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 10 }} onPress={async () => {
            const list = ((((st as any).check_override?.conditions || (st as any).check_blockers) || []) as string[]).join('\n• ');
            if (!(await confirmAction(`As certifying staff, confirm the following are RESOLVED despite the delayed OASES update?\n\n• ${list}\n\nThis leg only — printed on the Tech Log.`, 'Certifying staff confirmation'))) return;
            if (!(await confirmAction('Please confirm once more: the listed conditions are resolved. This is recorded with your name.', 'Confirm again'))) return;
            try { await sectorCheckOverrideMechanic(sectorId); await load(); } catch (e: any) { setNote(String(e?.message || e)); }
          }}>
            <Text style={{ color: theme.onAccent, fontWeight: '800' }}>Confirm — conditions resolved (this leg)</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {(st as any).check_override?.mechanic_by ? (
        <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>
          ✓ Delayed-OASES conditions confirmed: {(st as any).check_override.by ? `commander ${(st as any).check_override.by} · ` : ''}certifying staff {(st as any).check_override.mechanic_by}
        </Text>
      ) : null}
      {bridgePending ? (
        <View style={{ backgroundColor: '#3a1111', borderWidth: 1, borderColor: theme.red, borderRadius: 8, padding: 12, marginTop: 10 }}>
          <Text style={{ color: theme.red, fontWeight: '800' }}>▲ {(st as any).check_blockers.join(' · ')}</Text>
          <Text style={{ color: theme.sub, fontSize: 12, marginTop: 4 }}>{bridgeIsHil
            ? 'Extend or clear the overdue hold item first — or, when it is only a delayed OASES update (extended/closed in OASES but not yet posted), confirm the conditions above before signing the CRS.'
            : 'A flight CRS cannot be issued while a 2/10-day check is overdue or not recorded — complete the check first (2 Days / 10 Days Check buttons on the Main Menu), or confirm the conditions above if it is only a delayed OASES update.'}</Text>
        </View>
      ) : null}
      <Group title={`Blocking defects (${st.blockers.length})`} items={st.blockers} empty="None"
        color={theme.red} nav={navigation}
        selectable={(st as any).maintenance_only && isMech} selected={clearSel} onToggle={toggleClear} />
      <Group title={`Deferred · HIL (${st.deferred.length})`} items={st.deferred} empty="None"
        color={theme.accent} nav={navigation}
        selectable={(st as any).maintenance_only && isMech} selected={clearSel} onToggle={toggleClear} />

      <Text style={s.section}>Maintenance release (CRS)</Text>
      {st.released ? (
        <View style={[s.relCard, { borderColor: st.release.serviceable ? theme.green : theme.red }]}>
          <Text style={s.relKind}>{KIND[st.release.kind || ''] || st.release.kind}</Text>
          <Text style={s.sub}>Aircraft {st.release.serviceable ? 'serviceable' : 'unserviceable'} at release · {st.release.at?.slice(0, 16).replace('T', ' ')}</Text>
          {st.release.note ? <Text style={s.sub}>Note: {st.release.note}</Text> : null}
          {st.reset_request?.status === 'pending' ? (
            <Text style={[s.sub, { color: theme.accent, marginTop: 8 }]}>⏳ CRS reset requested by {st.reset_request.by} — pending CAMO Manager approval.{'\n'}Reason: {st.reset_request.reason}</Text>
          ) : st.reset_request?.status === 'rejected' ? (
            <Text style={[s.sub, { color: theme.red, marginTop: 8 }]}>CRS reset request was rejected by CAMO{st.reset_request.review_note ? ` — ${st.reset_request.review_note}` : ''}. The CRS stands.</Text>
          ) : isMech && !(st as any).departed ? (
            <View style={{ marginTop: 10 }}>
              {/* BEFORE DEPARTURE: certifying staff may reset their own CRS to correct + re-sign.
                  This voids any commander acceptance — the commander must approve again. */}
              <Text style={s.sub}>Need to change something? <Text style={{ fontWeight: '800' }}>Reset the CRS</Text> to correct the release and sign again. If the commander has already accepted, their acceptance is voided and they must approve again.</Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.red, marginTop: 8 }]} onPress={resetReleaseBeforeDep}>
                <Text style={[s.btnTxt, { color: theme.red }]}>↺ Reset CRS (before departure)</Text>
              </TouchableOpacity>
            </View>
          ) : isMech ? (
            <View style={{ marginTop: 10 }}>
              {/* AFTER DEPARTURE: a CRS correction is admin/CAMO-governed — request via Feedback. */}
              <Text style={s.sub}>The aircraft has departed on this CRS. A correction is now made by the <Text style={{ fontWeight: '800' }}>administrator only</Text> — send the request (flight, TL # and full reason) via <Text style={{ fontWeight: '800' }}>Feedback</Text>.</Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, marginTop: 8 }]} onPress={() => navigation.navigate('Feedback')}>
                <Text style={s.btnTxt}>Request a correction via Feedback ›</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={s.sub}>Not yet released.</Text>
      )}

      {closing !== null ? (
        <View style={{ backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 12 }}>
          <Text style={{ color: theme.text, fontWeight: '800' }}>To be closed on this Tech Log page — select the items</Text>
          <Text style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>
            Tick each HIL / cabin / other defect this TL # closes. The printed page lists exactly the selected items (each cited by its HIL / Cabin №).
          </Text>
          {closing.length === 0 ? <Text style={{ color: theme.sub, fontSize: 12, marginTop: 8 }}>No rectified/closed items since this log was opened.</Text> :
            closing.map((c) => (
              <TouchableOpacity key={c.id} disabled={!isMech} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border }}
                onPress={async () => {
                  const next = closing.map((x) => x.id === c.id ? { ...x, selected: !x.selected } : x);
                  setClosing(next);
                  try { await setClosedDefects(sectorId, next.filter((x) => x.selected).map((x) => x.id)); }
                  catch (e: any) { setMsg(e?.message || 'Could not save the selection'); load(); }
                }}>
                <Text style={{ fontSize: 16 }}>{c.selected ? '☑' : '☐'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13 }} numberOfLines={2}>{c.ref ? `${c.ref} · ` : ''}{c.title || c.description}</Text>
                  <Text style={{ color: theme.sub, fontSize: 11 }}>{c.area === 'cabin' ? 'CABIN' : 'TECH'} · {c.status.toUpperCase()}{c.at ? ` · ${c.at}z` : ''}</Text>
                </View>
              </TouchableOpacity>
            ))}
        </View>
      ) : null}

      {!isMech ? <RoBanner text="only certifying staff (mechanic) may issue a CRS release" /> : null}
      {isMech && (
        <>
          <TextInput style={s.input} value={signer} onChangeText={setSigner} placeholder="Mechanic name *" placeholderTextColor={theme.sub} />
          <TextInput style={s.input} value={licence} onChangeText={setLicence} placeholder="Licence / Part-145 auth no. *" placeholderTextColor={theme.sub} autoCapitalize="characters" />
          <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="Release note (optional)…" placeholderTextColor={theme.sub} multiline />
          <Text style={s.sub}>A CRS release requires the mechanic name, licence, a signature and MFA. The licence must match your registered licence on file.</Text>
          {needOtp ? (
            <TextInput style={s.input} value={otp} onChangeText={setOtp} keyboardType="number-pad"
              placeholder="Authenticator code" placeholderTextColor={theme.sub} />
          ) : null}
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} disabled={previewing}
            onPress={previewCRS}>
            <Text style={s.btnTxt}>{previewing ? 'Opening…' : '👁 Preview Tech Log / CRS'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btn, { backgroundColor: relLocked ? '#444' : theme.green }]} disabled={busy || relLocked}
            onPress={completeTL}>
            <Text style={[s.btnTxt, relLocked ? { color: theme.sub } : null]}>{busy ? 'Releasing…' : needOtp ? 'Verify & sign' : (st as any).maintenance_only ? (st.released ? '↺ Re-sign — Complete the Tech Log/CRS' : '✍ Complete the Tech Log/CRS') : (st.released ? 'Re-release flight (CRS)' : 'Sign & release flight (CRS)')}</Text>
          </TouchableOpacity>
          {st.blockers.length ? <Text style={[s.sub, { color: theme.red }]}>Cannot release: {st.blockers.length} open defect(s) must be deferred (MEL/HIL) or rectified first.</Text> : null}
        </>
      )}
      {finalize ? (
        <View style={{ marginTop: 12, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', flexShrink: 1, marginRight: 8 }}>{finalize.label}</Text>
            <Text style={{ color: theme.green, fontSize: 13, fontWeight: '800' }}>{Math.round(finalize.frac * 100)}%</Text>
          </View>
          <View style={{ height: 8, backgroundColor: theme.tile, borderRadius: 4, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(finalize.frac * 100)}%`, height: '100%', backgroundColor: finalize.frac >= 1 ? theme.green : theme.accent }} />
          </View>
        </View>
      ) : null}
      {/offline|will sync|queued/i.test(msg) ? <OfflineFlash message={msg} /> : (msg ? <Text style={s.msg}>{msg}</Text> : null)}

      <SignaturePad visible={signing} title="Sign maintenance release (CRS)"
        onClose={() => setSigning(false)}
        onDone={(dataUrl) => { setSigning(false); submitRelease(dataUrl); }} />

      <Text style={s.section}>Print / transfer Tech Log</Text>
      <Text style={s.sub}>Same format as the paper TL — at departure and destination.</Text>
      <View style={s.printRow}>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('air', 'tl')}><Text style={s.btnTxt}>Print (AirPrint)</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('pdf', 'tl')}><Text style={s.btnTxt}>PDF · Transfer</Text></TouchableOpacity>
      </View>

      <Text style={[s.section, { fontSize: 12 }]}>Cabin defect log (separate)</Text>
      <View style={s.printRow}>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('air', 'cabin')}><Text style={s.btnTxt}>Print</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('pdf', 'cabin')}><Text style={s.btnTxt}>PDF · Transfer</Text></TouchableOpacity>
      </View>

      <Text style={[s.section, { fontSize: 12 }]}>Hold Item List · HIL (separate)</Text>
      <View style={s.printRow}>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('air', 'hil')}><Text style={s.btnTxt}>Print</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('pdf', 'hil')}><Text style={s.btnTxt}>PDF · Transfer</Text></TouchableOpacity>
      </View>

      <TouchableOpacity style={[s.btn, { backgroundColor: bluetoothAvailable() ? theme.tile : '#2a2a2a' }]} onPress={() => print('bt')}>
        <Text style={[s.btnTxt, { color: bluetoothAvailable() ? '#fff' : theme.sub }]}>
          {bluetoothAvailable() ? 'Print to onboard Bluetooth printer' : 'Bluetooth printer — pending setup'}
        </Text>
      </TouchableOpacity>

      <Text style={s.section}>Corrections ({corrections.length})</Text>
      <Text style={s.sub}>Amend an already-recorded entry. The original stays; the amendment is logged with who, when and why.</Text>
      {corrections.map((c) => (
        <View key={c.id} style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 4, borderLeftColor: theme.accent, borderRadius: 8, padding: 10, marginTop: 8 }}>
          <Text style={{ color: theme.text, fontWeight: '700' }}>{c.field ? `${c.field}: ` : ''}{c.new_value || ''}</Text>
          <Text style={{ color: '#cde', fontSize: 13, marginTop: 2 }}>{c.reason}</Text>
          <Text style={s.sub}>{c.raised_by_name} · {c.raised_at?.slice(0, 16).replace('T', ' ')} · {c.status}</Text>
        </View>
      ))}
      {showCorr ? (
        <View style={{ marginTop: 8 }}>
          <TextInput style={s.input} value={corr.field} onChangeText={(v) => setCorr({ ...corr, field: v })} placeholder="What changed (e.g. Off-block time, Fuel uplift)" placeholderTextColor={theme.sub} />
          <TextInput style={s.input} value={corr.new_value} onChangeText={(v) => setCorr({ ...corr, new_value: v })} placeholder="Corrected value" placeholderTextColor={theme.sub} />
          <TextInput style={s.input} value={corr.reason} onChangeText={(v) => setCorr({ ...corr, reason: v })} placeholder="Reason for the correction (required)" placeholderTextColor={theme.sub} multiline />
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.accent }]} onPress={submitCorrection}><Text style={[s.btnTxt, { color: theme.onAccent }]}>Submit correction</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setShowCorr(false)} style={{ marginTop: 6 }}><Text style={s.sub}>Cancel</Text></TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, marginTop: 8 }]} onPress={() => setShowCorr(true)}><Text style={s.btnTxt}>＋ Raise correction</Text></TouchableOpacity>
      )}
    </ScrollView>
  );
}

function Group({ title, items, empty, color, nav, selectable, selected, onToggle }:
  { title: string; items: DefectBrief[]; empty: string; color: string; nav: any;
    selectable?: boolean; selected?: Set<string>; onToggle?: (d: DefectBrief) => void }) {
  return (
    <>
      <Text style={s.section}>{title}</Text>
      {selectable && items.length ? <Text style={[s.sub, { marginTop: -2, marginBottom: 6 }]}>Tick each item to clear on this Tech Log; tap the row to open it.</Text> : null}
      {items.length ? items.map((d) => (
        <View key={d.id} style={s.row}>
          {selectable ? (
            <TouchableOpacity onPress={() => onToggle?.(d)} style={{ paddingRight: 10 }}>
              <Text style={{ fontSize: 20, color: selected?.has(d.id) ? theme.green : theme.sub }}>{selected?.has(d.id) ? '☑' : '☐'}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={() => nav.navigate('DefectDetail', { defectId: d.id })}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{(d as any).hil_no ? `${(d as any).hil_no}  ` : ''}{d.title || d.description}</Text>
              <Text style={s.sub}>{(d.source || '').toUpperCase()} · {d.area === 'cabin' ? 'CABIN' : 'TECH'} · ATA {d.ata_chapter || '—'}{d.mel_ref ? ` · MEL ${d.mel_ref}` : ''}{(d as any).due_date ? ` · due ${(d as any).due_date}` : ''}</Text>
            </View>
            {(d as any).due_date != null || (d as any).max_fh != null || (d as any).max_cycles != null
              ? <HilRemaining item={d} style={{ minWidth: 150, marginHorizontal: 6, paddingHorizontal: 8, borderLeftWidth: 1, borderLeftColor: theme.border }} />
              : <Text style={[s.rowStatus, { color }]}>{d.status}</Text>}
          </TouchableOpacity>
        </View>
      )) : <Text style={s.sub}>{empty}</Text>}
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  banner: { borderWidth: 1, borderRadius: 10, padding: 14 },
  bannerTxt: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  sub: { color: theme.sub, marginTop: 4, fontSize: 13 },
  section: { color: theme.text, fontWeight: '800', fontSize: 14, marginTop: 22, marginBottom: 8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border, padding: 12, marginBottom: 8 },
  rowTitle: { color: theme.text, fontWeight: '700' },
  rowStatus: { fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  relCard: { backgroundColor: theme.panel, borderWidth: 1, borderRadius: 8, padding: 12 },
  relKind: { color: theme.text, fontWeight: '800' },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 12, minHeight: 54 },
  btn: { borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  btnTxt: { color: '#fff', fontWeight: '700' },
  msg: { color: theme.green, marginTop: 10 },
  printRow: { flexDirection: 'row', gap: 10 },
  printBtn: { flex: 1 },
});
