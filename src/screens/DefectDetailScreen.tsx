import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from 'react-native';
import { acceptDispatch, addDefectAction, ammIawLine, ammRevision, can, CdlItem, clearanceAuthorized, classifyDefect, closeDefect, defectCrsPreview, deleteDefect, getDefect, MelItem, MfaRequired, reverseRectification, setAirworthiness, userLicence, userName, workSigned, closedDefects, listActiveDefects, listHIL, serverSectors, setClosedDefects } from '../api/client';
import { printHtml, printServerPdf } from '../print';
import { appendLocalDefectAction, cacheDefect, getLocalDefect } from '../db/defects';
import MelPicker from '../components/MelPicker';
import CdlPicker from '../components/CdlPicker';
import AmmPicker from '../components/AmmPicker';
import PhotoCapture from '../components/PhotoCapture';
import HilRemaining from '../components/HilRemaining';
import SignaturePad from '../components/SignaturePad';
import SignatureBlock from '../components/SignatureBlock';
import { confirmAction, notifyAction } from '../util/confirm';
import { trackActivity } from '../db/activity';
import { theme } from '../theme';

const INTERVALS = ['A', 'B', 'C', 'D'];
const BASIS_LABEL = { '': 'Select', mel: 'MEL', cdl: 'CDL', approved_data: 'Approved data' } as const;
// Approved-data deferral authorities (doc types) — prefix the Doc reference.
// FH limits are entered/displayed as hh:mm; the API carries decimal hours.
const parseFH = (v: string): number | null => {
  const m = v.trim().match(/^(\d+)(?::([0-5]?\d))?$/);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) : 0) / 60 : null;
};
const fmtFH = (h: number): string => {
  const t = Math.round(h * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export default function DefectDetailScreen({ route, navigation }: any) {
  const { defectId } = route.params;
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [narr, setNarr] = useState('');
  const [amo, setAmo] = useState('');
  const [mel, setMel] = useState('');                    // doc reference (MEL/CDL item or approved-data doc)
  const [basis, setBasis] = useState<'' | 'mel' | 'cdl' | 'approved_data'>('');   // deferral authority — starts unselected
  const [basisOpen, setBasisOpen] = useState(false);     // authority dropdown expanded
  const [maxFh, setMaxFh] = useState('');                // FH-based limit: flight hours allowed from deferral
  const [rectIv, setRectIv] = useState('');
  const [due, setDue] = useState('');
  const [maxCyc, setMaxCyc] = useState('');              // cycle-based MEL: max landings/cycles
  const [melOpen, setMelOpen] = useState(false);
  const [cdlOpen, setCdlOpen] = useState(false);
  const [ammOpen, setAmmOpen] = useState(false);
  // Rectify + CRS: validate entries -> confirm -> signature -> MFA
  const [lic, setLic] = useState(userLicence() ?? '');   // pre-filled from profile, editable
  const [signing, setSigning] = useState(false);
  const [crsSig, setCrsSig] = useState<string | null>(null);
  const [diOpen, setDiOpen] = useState(false);           // double-inspection (DI) — second person's signature
  const [diName, setDiName] = useState('');
  const [diLic, setDiLic] = useState('');
  const [diTask, setDiTask] = useState('');           // what was inspected — required
  const [ata, setAta] = useState('');                 // maintenance ATA classification (crew raise without it)
  const [diSigning, setDiSigning] = useState(false);
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  // Two-step W/O: Step 1 signs the Tech Log for the work (no CRS). Its own signature/MFA state.
  const [workSigning, setWorkSigning] = useState(false);
  const [workNeedOtp, setWorkNeedOtp] = useState(false);
  const [workRetrySig, setWorkRetrySig] = useState<string | null>(null);
  const [workOtp, setWorkOtp] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const [approver, setApprover] = useState('');
  const isMech = can('defects', 'rectify');     // rectification / CRS action — maintenance
  // Chain-closure: after a CRS, offer to close ANOTHER item on the same ground TL # until 'no more'.
  const [chain, setChain] = useState<{ logId: string; tl: string; items: any[] } | null>(null);
  // Defer is a next ACTION — only offered while the item is still workable (open / troubleshooting),
  // never when reviewing a rectified/closed/deferred record (e.g. opened from Flight Sign Off).
  // Cabin defects are commander-dispatch items (Cabin Defect Log) — never MEL/HIL-deferrable.
  // Open/troubleshooting → defer; deferred (HIL) → amend the deferral. Never cabin, never rectified/closed.
  const canDefer = can('defects', 'defer') && ['open', 'troubleshooting', 'deferred'].includes(d?.status) && d?.area !== 'cabin';
  const amending = d?.status === 'deferred';
  // Cabin-defect dispatch/clearance is the commander's decision — driven by the permission matrix
  // (departure.cabin_decision: captain/pilot rw, cabin/mechanic ro), never a role literal. Clearing
  // additionally requires the user's commander-clearance authorisation flag.
  const canCabinDispatch = can('departure', 'cabin_decision');
  const canCommanderClear = canCabinDispatch && clearanceAuthorized();

  function appendNarr(line: string) { setNarr((n) => (n ? n.replace(/\s+$/, '') + '\n\n' : '') + line); }
  // Time remaining to a calendar due date (limit = end of that day). "Nd Hh Mm left" / "OVERDUE …".
  function remainingDue(dd?: string | null): string | null {
    if (!dd || !/^\d{4}-\d{2}-\d{2}$/.test(dd)) return null;
    const ms = new Date(`${dd}T23:59:59Z`).getTime() - Date.now();
    const a = Math.abs(ms), d = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000), m = Math.floor((a % 3600000) / 60000);
    return ms < 0 ? `OVERDUE by ${d}d ${h}h ${m}m` : `${d}d ${h}h ${m}m left`;
  }
  function pickMel(m: MelItem) {
    setBasis('mel');
    setMel(m.ata || '');                              // deferral ref + category
    if (m.category) setRectIv(m.category);
    appendNarr(`MEL ${m.ata || ''} · ${m.item}${m.category ? ` (Cat ${m.category}${m.rectification_interval ? `, ${m.rectification_interval}` : ''})` : ''}`.replace(/\s+/g, ' ').trim());
    setMelOpen(false);
  }
  function pickCdl(c: CdlItem) {
    setBasis('cdl');
    setMel(`${c.ata || c.code || ''}${(c.item || c.system) ? ' — ' + (c.item || c.system) : ''}`.trim());
    appendNarr(`CDL ${c.ata || ''}${c.code ? ` (${c.code})` : ''} · ${c.item || c.system}${c.dispatch ? ` — ${c.dispatch}` : ''}`.replace(/\s+/g, ' ').trim());
    setCdlOpen(false);
  }

  const [ammRev, setAmmRev] = useState('');
  async function load() {
    try { const dd = await getDefect(defectId); setD(dd); cacheDefect(dd).catch(() => {}); }   // online → cache for offline
    catch (e: any) {
      const local = await getLocalDefect(defectId);                                             // offline → local mirror
      if (local) { setD(local); setMsg(''); }
      else setMsg('This defect isn’t available offline — open it once with a signal.');
    }
  }
  useEffect(() => { load(); }, [defectId]);
  // HIL item → prefill the amend-deferral form from the record (once, when it loads).
  const prefilled = React.useRef(false);
  useEffect(() => {
    if (!d || d.status !== 'deferred' || prefilled.current) return;
    prefilled.current = true;
    // Basis stays at 'Select' — amending requires an explicit authority choice; the existing
    // doc reference and limits are prefilled for editing.
    setMel(d.cdl_ref && !d.mel_ref ? d.cdl_ref : d.approved_ref && !d.mel_ref ? d.approved_ref : (d.mel_ref || ''));
    if (d.rect_interval) setRectIv(d.rect_interval);
    if (d.due_date) setDue(String(d.due_date).slice(0, 10));
    if (d.max_fh != null) setMaxFh(fmtFH(d.max_fh));
    if (d.max_cycles != null) setMaxCyc(String(d.max_cycles));
  }, [d]);
  useEffect(() => {
    ammRevision().then(setAmmRev).catch(() => {});
  }, []);
  // Reflect the current ATA into the maintenance-classification field when the defect loads.
  const ataInit = React.useRef(false);
  useEffect(() => { if (d && !ataInit.current) { ataInit.current = true; setAta(d.ata_chapter || ''); } }, [d]);

  async function saveAta() {
    setMsg('Saving ATA…');
    try {
      const r = await classifyDefect(defectId, ata.trim());
      setMsg(r?.queued ? 'ATA saved offline — will sync ✓' : 'ATA saved ✓');
      load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }

  async function act(kind: string, body: any = {}) {
    setMsg('Saving…');
    try {
      const a = { kind, narrative: narr || undefined, ...body };
      const r = await addDefectAction(defectId, a);
      if (r?.queued) { await appendLocalDefectAction(defectId, a); setMsg('Saved offline — will sync ✓'); }
      else setMsg('Done ✓');
      trackActivity(kind, 'defect', defectId, 'DefectDetail', { title: d?.title });
      setNarr(''); load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }
  async function close() {
    try {
      const r = await closeDefect(defectId);
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'close' }, { status: 'closed' }); setMsg('Closed offline — will sync ✓'); }
      else setMsg('Closed ✓');
      trackActivity('close', 'defect', defectId, 'DefectDetail', { title: d?.title });
      load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }

  // Preview the Tech Log / CRS page this rectification will be recorded on, before signing.
  async function previewCRS() {
    setPreviewing(true); setMsg('');
    try {
      if (!(await printServerPdf(`/defects/${defectId}/crs-preview.pdf`)))
        { const { html } = await defectCrsPreview(defectId); if (html) await printHtml(html); }
    }
    catch (e: any) { setMsg(e?.message?.includes('Network') ? 'Preview needs a connection.' : (e?.message || 'Could not open the preview.')); }
    finally { setPreviewing(false); }
  }

  // Rectify + CRS — a certification: all entries complete, confirm, sign, MFA. Missing entries
  // pop as a dialog (same pattern as the Departure/Arrival sign-offs).
  async function rectifyCRS() {
    const miss = [
      !narr.trim() ? '• Rectification / action narrative' : null,
      !amo.trim() ? '• AMO / Part-145 approval number' : null,
      !lic.trim() ? '• Licence / authorisation number' : null,
    ].filter(Boolean) as string[];
    if (miss.length) { setMsg('Complete before the CRS: ' + miss.map((m) => m.slice(2)).join(', ')); notifyAction(miss.join('\n'), 'Complete the rectification first'); return; }
    if (!(await confirmAction('Issue the CRS for this rectification? You will sign and authenticate.', 'Rectify + CRS'))) return;
    setSigning(true);
  }
  // Step 1 of the two-step W/O: sign the Tech Log for the work, no CRS (aircraft stays unserviceable).
  async function recordWork() {
    const miss = [
      !narr.trim() ? '• Work carried out / action narrative' : null,
      !lic.trim() ? '• Licence / authorisation number' : null,
    ].filter(Boolean) as string[];
    if (miss.length) { setMsg('Complete before signing: ' + miss.map((m) => m.slice(2)).join(', ')); notifyAction(miss.join('\n'), 'Complete before signing the Tech Log'); return; }
    if (!(await confirmAction('Sign the Tech Log for this work now? No CRS is issued yet — the aircraft stays UNSERVICEABLE until the CRS (release) is signed, which needs every other open item cleared.', 'Record work + sign TL'))) return;
    setWorkSigning(true);
  }
  async function submitWork(signature: string) {
    setMsg('Signing the Tech Log…');
    try {
      const r = await workSigned(defectId, { narrative: narr, licence_no: lic.trim() || undefined, signature_image: signature, otp: workOtp.trim() || undefined });
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'work_completed', narrative: narr }, { status: 'work_done' }); setMsg('Work signed offline — will sync ✓'); }
      else setMsg('Work signed on the Tech Log — CRS pending ✓');
      trackActivity('sign', 'work', defectId, 'DefectDetail', { title: d?.title });
      setWorkOtp(''); setWorkNeedOtp(false); setWorkRetrySig(null); load();
    } catch (e: any) {
      if (e instanceof MfaRequired) { setWorkRetrySig(signature); setWorkNeedOtp(true); setMsg('Enter your authenticator code to sign the Tech Log.'); }
      else setMsg(`Failed: ${e.message}`);
    }
  }
  async function submitCRS(signature: string) {
    // On a work_done item the work is already signed — this is a standalone CRS ('crs'); otherwise
    // it is the one-step rectify-and-certify ('rectification'). Both seal the release CRS.
    const kind = d?.status === 'work_done' ? 'crs' : 'rectification';
    setMsg('Issuing CRS…');
    try {
      const r = await addDefectAction(defectId, { kind, narrative: narr, amo_approval_no: amo,
        licence_no: lic.trim() || undefined, signature_image: signature, otp: otp.trim() || undefined });
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind, narrative: narr, amo_approval_no: amo }, { status: 'rectified' }); setMsg('CRS saved offline — will sync when back online ✓'); }
      else setMsg('Rectified + CRS issued ✓');
      trackActivity('sign', 'crs', defectId, 'DefectDetail', { title: d?.title, kind });
      setNarr(''); setOtp(''); setNeedOtp(false); setCrsSig(null); load();
      offerChain();   // same-TL# chaining: claim this item on the open ground log + offer the next
    } catch (e: any) {
      if (e instanceof MfaRequired) { setCrsSig(signature); setNeedOtp(true); setMsg('Enter your authenticator code to issue the CRS.'); }
      else setMsg(`Failed: ${e.message}`);
    }
  }
  // After a CRS on this defect: if an open (unsealed) ground maintenance log exists, claim the
  // item on that TL # and offer the remaining open/HIL/cabin items — repeat until "No more".
  async function offerChain() {
    try {
      const secs = await serverSectors(d?.aircraft_id);
      const log = (secs || []).filter((x: any) => (x.page_kind === 'maintenance_only' || x.flight_no === 'MAINT') && x.status === 'maintenance')
        .sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
      if (!log) return;
      try {
        const cur = await closedDefects(log.id);
        const keep = cur.items.filter((i: any) => i.selected).map((i: any) => i.id);
        if (!keep.includes(defectId)) await setClosedDefects(log.id, [...keep, defectId]);
      } catch { /* sealed or offline — selection stays manual on the Release page */ }
      const [act, hil] = await Promise.all([
        listActiveDefects(d?.aircraft_id).catch(() => []), listHIL(d?.aircraft_id).catch(() => [])]);
      const seen = new Set<string>([defectId]);
      const items = [...(act || []), ...(hil || [])].filter((x: any) => !seen.has(x.id) && !(seen.add(x.id) && false));
      const tl = log.page_no ? `${String(Math.floor(log.page_no / 1000)).padStart(3, '0')}-${String(log.page_no % 1000).padStart(3, '0')}` : '—';
      setChain({ logId: log.id, tl, items });
    } catch { /* no chaining offline */ }
  }

  // Double inspection (DI): a second qualified person's independent inspection — captures their
  // name, licence, signature and the date/time.
  async function submitDI(signature: string) {
    setMsg('Recording double inspection…');
    try {
      const a = { kind: 'double_inspection', signer_name: diName.trim(), licence_no: diLic.trim() || undefined, narrative: diTask.trim(), signature_image: signature };
      const r = await addDefectAction(defectId, a);
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'double_inspection', narrative: `Double inspection · ${diName.trim()}` }); setMsg('Double inspection saved offline — will sync ✓'); }
      else setMsg('Double inspection recorded ✓');
      trackActivity('sign', 'double_inspection', defectId, 'DefectDetail', { title: d?.title });
      setDiOpen(false); setDiName(''); setDiLic(''); load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }
  async function reverse() {
    if (!(await confirmAction('Reverse this Rectify + CRS? The rectification and its CRS signature will be voided and the defect re-opened.', 'Reverse CRS'))) return;
    try {
      const r: any = await reverseRectification(defectId);
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'reverse' }, { status: 'open' }); setMsg('Reversal saved offline — will sync'); }
      else setMsg('Rectification reversed — defect re-opened');
      trackActivity('reverse', 'crs', defectId, 'DefectDetail', { title: d?.title });
      load();
    }
    catch (e: any) { setMsg(e?.message?.includes('409') ? 'Cannot reverse — defect is closed' : `Failed: ${e.message}`); }
  }
  function dispatch(ok: boolean) {
    Alert.alert(
      ok ? 'Accept as dispatchable' : 'Mark NOT dispatchable',
      ok ? 'Confirm the commander accepts this cabin defect as dispatchable.'
         : 'Confirm this cabin defect makes the aircraft NOT dispatchable (will hold the aircraft).',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: ok ? 'Accept' : 'Not dispatchable', style: ok ? 'default' : 'destructive', onPress: async () => {
          try {
            const r = await acceptDispatch(defectId, ok);
            if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'dispatch', dispatchable: ok }); setMsg('Saved offline — will sync ✓'); }
            else setMsg(ok ? 'Accepted as dispatchable ✓' : 'Marked not dispatchable');
            trackActivity('dispatch', 'defect', defectId, 'DefectDetail', { ok, title: d?.title });
            load();
          }
          catch (e: any) { setMsg(`Failed: ${e.message}`); }
        } },
      ]);
  }
  async function assessAirworthiness(aw: boolean) {
    if (!(await confirmAction(
      aw ? 'Assess this cabin defect as AIRWORTHINESS-related? The aircraft becomes UNSERVICEABLE (AOG) until it is rectified or deferred — the captain cannot dispatch it.'
         : 'Assess this cabin defect as NOT airworthiness-related? The commander then makes the dispatch decision.',
      'Airworthiness assessment'))) return;
    try {
      const r = await setAirworthiness(defectId, aw);
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'airworthiness', airworthiness: aw }); setMsg('Saved offline — will sync ✓'); }
      else setMsg(aw ? 'Airworthiness-related — aircraft AOG' : 'Not airworthiness — commander to decide');
      trackActivity('assess', 'airworthiness', defectId, 'DefectDetail', { airworthy: aw, title: d?.title });
      load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }
  async function del() {
    // Admin only, with the CAMO Manager's approval recorded. `force` is the admin cleanup path for a
    // deferred (HIL) test / wrongly-deferred item — when the normal by-mistake delete isn't offered.
    // Double confirmation for a permanent removal (the server enforces the same rules).
    const force = !d.can_delete;   // can_delete = open/troubleshooting; else this is a deferred cleanup
    if (!approver.trim()) { setMsg('Record the CAMO Manager who approved this removal first.'); return; }
    const intro = force
      ? `Remove this DEFERRED (HIL) defect as an admin cleanup?\n\n${d.hil_no ? d.hil_no + '\n' : ''}Approved by CAMO Manager: ${approver.trim()}\n\nUse this for test data or a wrongly-deferred item.`
      : `Remove this defect entered by mistake?\n\nApproved by CAMO Manager: ${approver.trim()}\n\nThis is only for entries made in error, before the flight is dispatched/released.`;
    if (!(await confirmAction(intro, force ? 'Admin cleanup — remove HIL' : 'Remove defect'))) return;
    if (!(await confirmAction('Are you sure? This cannot be undone — the defect, its rectification/CCR history and any photos are permanently removed.', 'Confirm removal'))) return;
    try { await deleteDefect(defectId, approver.trim(), force); navigation?.goBack(); }
    catch (e: any) {
      const m = e?.message || '';
      setMsg(/409|dispatched|released|departed/i.test(m) ? 'The flight has been dispatched/released — this defect is now part of the record; raise a correction instead.'
        : /400/.test(m) ? 'CAMO Manager approval is required.'
        : /403/.test(m) ? 'Only an admin with CAMO Manager approval can remove a defect.'
        : `Failed: ${m}`);
    }
  }

  if (!d) return <View style={styles.wrap}><Text style={styles.sub}>{msg || 'Loading…'}</Text></View>;
  const color = d.status === 'deferred' ? theme.accent : d.status === 'closed' || d.status === 'rectified' ? theme.green : theme.red;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>{d.title || 'Defect'} <Text style={[styles.badge, { color }]}>· {d.status}</Text></Text>
      <Text style={styles.desc}>{d.description}</Text>
      <Text style={styles.sub}>{(() => { const r = String(d.raised_at || ''); if (!r) return ''; const p = r.slice(0, 10).split('-'); return `Opened ${p[2]}/${p[1]}/${p[0].slice(2)} ${r.slice(11, 16)}z · `; })()}{d.source?.toUpperCase()} · ATA {d.ata_chapter || '—'}{d.tl ? ` · TL # ${d.tl}${d.tl_flight ? ` (${d.tl_flight})` : ''}` : ''}{d.mel_ref ? ` · MEL ${d.mel_ref}` : ''}{d.cdl_ref ? ` · CDL ${d.cdl_ref}` : ''}{d.approved_ref ? ` · Approved data ${d.approved_ref}` : ''}{d.rect_interval ? ` · Cat ${d.rect_interval}` : ''}{d.due_date ? ` · due ${d.due_date}` : ''}</Text>
      {/* Deferred item: the standard remaining columns (Days / Hrs / Cyc) — same presentation as the
          HIL lists; whichever limit is reached first applies. */}
      {d.status === 'deferred' ? (
        <HilRemaining item={d} style={{ alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }} />
      ) : null}
      {d.last_updated_by ? <Text style={[styles.sub, { fontSize: 12 }]}>Last updated by {d.last_updated_by}</Text> : null}
      {/* The reporter's drawn signature — cabin crew / PIREP / MAREP sign when raising the defect. */}
      {d.reporter_signature ? (
        <SignatureBlock label={`${(d.source || 'report').toUpperCase()} — reported & signed`}
          sig={{ signer_name: d.reported_by_name, licence_no: d.reporter_licence, signed_at: d.raised_at, signature_image: d.reporter_signature }} />
      ) : null}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      {/* Once the CRS is signed (rectified/closed) the photos are part of the signed record — view only, no re-take/library. */}
      <PhotoCapture defectId={defectId} kind="damage" label="Damage / receipt photos" readOnly={d.status === 'closed' || d.status === 'rectified'} />

      {(d.can_delete || d.can_force_delete) ? (
        !askDel ? (
          <TouchableOpacity onPress={() => { setMsg(''); setAskDel(true); }} style={{ marginTop: 14 }}>
            <Text style={{ color: theme.red, fontWeight: '700' }}>{d.can_delete ? 'Delete defect (entered by mistake)' : 'Delete defect (admin cleanup — test / deferred)'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ marginTop: 14, borderWidth: 1, borderColor: theme.red, borderRadius: 8, padding: 12 }}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>{d.can_delete ? 'Remove defect (entered by mistake)' : 'Admin cleanup — remove test / deferred defect'}</Text>
            <Text style={styles.sub}>{d.can_delete
              ? 'Admin only, before the flight is dispatched/released, and only with the CAMO Manager’s approval.'
              : 'Admin only, with CAMO Manager approval. For test data or a wrongly-deferred item — a rectified/closed (signed CRS) defect cannot be deleted.'}</Text>
            <TextInput style={[styles.input, { marginTop: 10, minHeight: 0 }]} value={approver} onChangeText={setApprover}
              placeholder="CAMO Manager who approved (name / authorisation) *" placeholderTextColor={theme.sub} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.red }]} onPress={del}>
                <Text style={styles.act2t}>Remove defect</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} onPress={() => { setAskDel(false); setApprover(''); }}>
                <Text style={styles.act2t}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )
      ) : null}

      {/* MAINTENANCE decides airworthiness first: airworthiness-related → AOG; otherwise the captain
          makes the dispatch call. */}
      {d.area === 'cabin' && isMech && d.status !== 'closed' && (
        <>
          <Text style={styles.section}>Cabin defect — airworthiness assessment (maintenance)</Text>
          <Text style={styles.sub}>
            {d.airworthiness === true ? 'Assessed AIRWORTHINESS-related — aircraft UNSERVICEABLE (AOG). Rectify or defer it.' :
             d.airworthiness === false ? 'Assessed NOT airworthiness — the commander makes the dispatch decision.' :
             'Is this defect airworthiness-related? Your assessment decides whether it grounds the aircraft.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <TouchableOpacity style={[styles.act2, { backgroundColor: d.airworthiness === true ? theme.red : theme.tile, borderWidth: 1, borderColor: theme.red }]} onPress={() => assessAirworthiness(true)}>
              <Text style={[styles.act2t, d.airworthiness === true ? null : { color: theme.red }]}>Airworthiness-related (AOG)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.act2, { backgroundColor: d.airworthiness === false ? theme.green : theme.tile, borderWidth: 1, borderColor: theme.border }]} onPress={() => assessAirworthiness(false)}>
              <Text style={styles.act2t}>Not airworthiness — captain decides</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {d.area === 'cabin' && canCabinDispatch && d.status !== 'closed' && (
        <>
          <Text style={styles.section}>Cabin defect — commander dispatch decision</Text>
          {d.airworthiness === true ? (
            <Text style={[styles.sub, { color: theme.red }]}>▲ Airworthiness-related (maintenance) — the aircraft is AOG and NOT dispatchable. It must be rectified or deferred.</Text>
          ) : d.airworthiness == null ? (
            <Text style={styles.sub}>Awaiting maintenance's airworthiness assessment before the dispatch decision.</Text>
          ) : (
            <>
              <Text style={styles.sub}>
                {d.dispatch_accepted === true ? 'Accepted as dispatchable.' :
                 d.dispatch_accepted === false ? 'Marked NOT dispatchable — aircraft held.' :
                 'Assessed not airworthiness — your decision (does not auto-ground the aircraft).'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green }]} onPress={() => dispatch(true)}>
                  <Text style={styles.act2t}>Accept dispatchable</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.act2, { backgroundColor: theme.red }]} onPress={() => dispatch(false)}>
                  <Text style={styles.act2t}>Not dispatchable</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </>
      )}

      <Text style={styles.section}>Action timeline ({d.actions?.length || 0})</Text>
      {(d.actions || []).map((a: any, i: number) => (
        <View key={i} style={styles.action}>
          <Text style={styles.actKind}>{a.kind}</Text>
          <Text style={styles.sub}>{a.narrative || ''}{a.amo_approval_no ? ` · AMO ${a.amo_approval_no}` : ''}</Text>
          <Text style={styles.actTime}>{a.at?.slice(0, 16).replace('T', ' ')}</Text>
        </View>
      ))}

      {d.oases_sourced && (isMech || canDefer) && d.status !== 'closed' && (
        <Text style={[styles.sub, { marginTop: 14 }]}>ℹ︎ Mirrored from OASES. You can rectify or defer it here — the CRS is recorded on a VAW-ETL-01 Tech Log page (preview below).</Text>
      )}

      {isMech && d.status !== 'closed' && d.area !== 'cabin' && (
        <>
          <Text style={styles.section}>ATA classification</Text>
          <Text style={styles.sub}>Crew report the symptom without an ATA — assign or correct it here (maintenance classification).</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <TextInput style={[styles.input, { flex: 1, marginTop: 0 }]} value={ata} onChangeText={setAta} autoCapitalize="characters"
              placeholder="ATA ref — e.g. 21‑21‑01" placeholderTextColor={theme.sub} />
            <TouchableOpacity style={[styles.act2, { backgroundColor: theme.accent, opacity: ata.trim() === (d.ata_chapter || '') ? 0.4 : 1 }]}
              disabled={ata.trim() === (d.ata_chapter || '')} onPress={saveAta}>
              <Text style={[styles.act2t, { color: theme.onAccent }]}>Save ATA</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {(isMech || canDefer) && d.status !== 'closed' && (
        <>
          <Text style={styles.section}>Maintenance action</Text>
          <TextInput style={[styles.input, { minHeight: Math.max(88, narr.split('\n').length * 22 + 28), textAlignVertical: 'top' }]}
            value={narr} onChangeText={setNarr} placeholder="Narrative / action taken… (add task cards below)" placeholderTextColor={theme.sub} multiline />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setAmmOpen(true)}>
              <Text style={styles.act2t}>＋ Task Card (AMM)</Text>
            </TouchableOpacity>
          </View>
          <AmmPicker visible={ammOpen} reg={d?.aircraft_id} defaultAta={(d?.ata_chapter || '').split('-')[0] || undefined} onClose={() => setAmmOpen(false)}
            onPick={(m) => { setNarr((n) => { const line = ammIawLine(m); const base = (n || '').trim(); return base ? `${line}\n\n${base}` : line; }); setAmmOpen(false); }} />
          {isMech && d.status !== 'work_done' && (<>
          <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => act('troubleshooting')}><Text style={styles.act2t}>Troubleshooting</Text></TouchableOpacity>

          {/* Component Change Report — required whenever a component is replaced during rectification. */}
          <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]}
            onPress={() => navigation.navigate('ComponentChange', { defectId })}>
            <Text style={styles.act2t}>🔩 Component Change (CCR) ›</Text>
          </TouchableOpacity>

          {/* Double Inspection (DI) — a second qualified person signs an independent inspection (name + licence + signature + date/time). */}
          <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setDiOpen((v) => !v)}>
            <Text style={styles.act2t}>👥 Double Inspection (DI){diOpen ? ' ▴' : ' ▾'}</Text>
          </TouchableOpacity>
          {diOpen ? (
            <View style={{ marginTop: 8, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 }}>
              <Text style={styles.sub}>The independent second inspection required for a critical task. The DI signature and its date/time are recorded.</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <TextInput style={[styles.input, { width: 200, minHeight: 0 }]} value={diName} onChangeText={setDiName} placeholder="DI — inspector name *" placeholderTextColor={theme.sub} />
                <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={diLic} onChangeText={setDiLic} placeholder="DI — licence / auth no *" placeholderTextColor={theme.sub} />
                <TextInput style={[styles.input, { width: 260, minHeight: 0 }]} value={diTask} onChangeText={setDiTask} placeholder="DI — inspected item / task *" placeholderTextColor={theme.sub} />
              </View>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.accent, marginTop: 8 }]} onPress={() => {
                if (!diName.trim() || !diLic.trim() || !diTask.trim()) {
                  const miss = [!diName.trim() ? '• DI — inspector name' : null, !diLic.trim() ? '• DI — licence / auth no' : null, !diTask.trim() ? '• DI — inspected item / task' : null].filter(Boolean) as string[];
                  setMsg('Enter the DI inspector name, their licence, and the inspected item / task.');
                  notifyAction(miss.join('\n'), 'Complete the Double Inspection entries');
                  return;
                }
                if (diName.trim().toLowerCase() === (userName() || '').trim().toLowerCase() || (userLicence() && diLic.trim().toUpperCase() === (userLicence() || '').trim().toUpperCase())) {
                  setMsg('The double inspection must be a DIFFERENT qualified person than the one rectifying.'); return;
                }
                setDiSigning(true);
              }}>
                <Text style={[styles.act2t, { color: theme.onAccent }]}>Sign double inspection</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <SignaturePad visible={diSigning} title="Double inspection signature"
            onClose={() => setDiSigning(false)} onDone={(dataUrl) => { setDiSigning(false); submitDI(dataUrl); }} />

          <Text style={styles.lbl}>Rectify + CRS (certification — M.A.801)</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={amo} onChangeText={setAmo} placeholder="AMO / Part-145 no *" placeholderTextColor={theme.sub} />
            <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={lic} onChangeText={setLic} placeholder="Licence / auth no *" placeholderTextColor={theme.sub} />
          </View>
          {needOtp ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={otp} onChangeText={setOtp} keyboardType="number-pad" placeholder="Authenticator code" placeholderTextColor={theme.sub} />
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green }]} onPress={() => crsSig && submitCRS(crsSig)}><Text style={styles.act2t}>Submit CRS</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile }]} onPress={previewCRS} disabled={previewing}><Text style={styles.act2t}>{previewing ? 'Opening…' : '👁 Preview Tech Log / CRS'}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green }]} onPress={rectifyCRS}><Text style={styles.act2t}>Rectify + CRS · sign</Text></TouchableOpacity>
            </View>
          )}
          <Text style={styles.sub}>Preview the Tech Log / CRS page before you sign. The CRS requires the work narrative, AMO/licence, a signature and MFA before it goes ahead — and releases only when every other open item is cleared and the checks are current.</Text>
          <SignaturePad visible={signing} title="Sign rectification CRS"
            onClose={() => setSigning(false)} onDone={(dataUrl) => { setSigning(false); submitCRS(dataUrl); }} />

          {/* Two-step alternative: sign the Tech Log for the work now, issue the CRS separately later
              (used when other items are still open — you cannot release until the aircraft is clear). */}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.border, marginTop: 12, paddingTop: 10 }}>
            <Text style={styles.sub}>Other items still open? Sign the Tech Log for the work now and issue the CRS once the aircraft is clear.</Text>
            <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.accent, alignSelf: 'flex-start', marginTop: 8 }]} onPress={recordWork}>
              <Text style={[styles.act2t, { color: theme.accent }]}>🔧 Record work + sign TL (no CRS)</Text>
            </TouchableOpacity>
          </View>
          <SignaturePad visible={workSigning} title="Sign Tech Log — work carried out (no CRS)"
            onClose={() => setWorkSigning(false)} onDone={(dataUrl) => { setWorkSigning(false); submitWork(dataUrl); }} />
          {workNeedOtp ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={workOtp} onChangeText={setWorkOtp} keyboardType="number-pad" placeholder="Authenticator code" placeholderTextColor={theme.sub} />
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.accent }]} onPress={() => workRetrySig && submitWork(workRetrySig)}><Text style={[styles.act2t, { color: theme.onAccent }]}>Sign Tech Log</Text></TouchableOpacity>
            </View>
          ) : null}
          </>)}

          {/* work_done: the work is TL-signed; only the CRS (release) remains — gated on the aircraft
              being otherwise clear. */}
          {isMech && d.status === 'work_done' && (<>
          <View style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.accent, borderRadius: 8, padding: 12, marginTop: 6 }}>
            <Text style={{ color: theme.accent, fontWeight: '800' }}>Work accomplished — CRS pending</Text>
            <Text style={[styles.sub, { marginTop: 4 }]}>The work is signed on the Tech Log. Issue the CRS to release the aircraft — this closes every item worked on this reg together, and is allowed only when no other defect is open and the 2/10-day checks are current.</Text>
          </View>
          <Text style={styles.lbl}>Issue CRS · release (certification — M.A.801)</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={amo} onChangeText={setAmo} placeholder="AMO / Part-145 no *" placeholderTextColor={theme.sub} />
            <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={lic} onChangeText={setLic} placeholder="Licence / auth no *" placeholderTextColor={theme.sub} />
          </View>
          {needOtp ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={otp} onChangeText={setOtp} keyboardType="number-pad" placeholder="Authenticator code" placeholderTextColor={theme.sub} />
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green }]} onPress={() => crsSig && submitCRS(crsSig)}><Text style={styles.act2t}>Submit CRS</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile }]} onPress={previewCRS} disabled={previewing}><Text style={styles.act2t}>{previewing ? 'Opening…' : '👁 Preview Tech Log / CRS'}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green }]} onPress={() => { if (!amo.trim()) { setMsg('Enter the AMO / Part-145 approval number.'); return; } if (!lic.trim()) { setMsg('Enter your licence / authorisation number.'); return; } confirmAction('Issue the CRS and release the aircraft? This certifies the work and closes every item worked on this reg.', 'Issue CRS · release').then((ok) => ok && setSigning(true)); }}><Text style={styles.act2t}>Issue CRS · release</Text></TouchableOpacity>
            </View>
          )}
          <SignaturePad visible={signing} title="Sign release CRS"
            onClose={() => setSigning(false)} onDone={(dataUrl) => { setSigning(false); submitCRS(dataUrl); }} />
          </>)}

          {canDefer && (<>
          <Text style={styles.section}>{amending ? 'Deferral — amend (Hold Item List)' : 'Defer (Hold Item List)'}</Text>
          {/* Deferral authority — dropdown. Picking MEL/CDL opens that CAMO picker directly; the
              chosen item lands in Doc reference (manually editable). Approved data = manual entry. */}
          <TouchableOpacity style={[styles.input, { width: 220, minHeight: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
            onPress={() => setBasisOpen((o) => !o)}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>{BASIS_LABEL[basis]}</Text>
            <Text style={{ color: theme.sub }}>▾</Text>
          </TouchableOpacity>
          {basisOpen ? (
            <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, width: 220, backgroundColor: theme.tile }}>
              {(['mel', 'cdl', 'approved_data'] as const).map((b) => (
                <TouchableOpacity key={b} style={{ paddingVertical: 10, paddingHorizontal: 12 }}
                  onPress={() => {
                    setBasis(b); setBasisOpen(false);
                    setMel(''); setRectIv('');            // never carry a MEL/CDL pick into another basis
                    if (b === 'mel') setMelOpen(true);
                    else if (b === 'cdl') setCdlOpen(true);
                  }}>
                  <Text style={[styles.ivt, basis === b && { color: theme.accent }]}>{BASIS_LABEL[b]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {basis === 'approved_data' ? (
            <Text style={[styles.sub, { marginTop: 4 }]}>Approved data — AMM, SRM, RDAS, CRAS, Airbus request, SB or another approved document. Enter the document reference below.</Text>
          ) : null}
          <View style={styles.row}>
            <TextInput style={[styles.input, { width: 180, minHeight: 0 }]} value={mel} onChangeText={setMel} placeholder="Doc reference" placeholderTextColor={theme.sub} />
            {/* Category A–D applies to MEL items only — shown once a MEL item is picked/entered. */}
            {basis === 'mel' && mel ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {INTERVALS.map((iv) => (
                  <TouchableOpacity key={iv} onPress={() => {
                    const sel = rectIv === iv ? '' : iv;
                    setRectIv(sel);
                    // MEL Cat B/C/D carry a standard rectification interval — auto-fill the due date
                    // (editable). Cat A is "as per remarks", so the mechanic enters a limit manually.
                    const days: any = { B: 3, C: 10, D: 120 };
                    if (days[sel]) { const t = new Date(); t.setUTCDate(t.getUTCDate() + days[sel]); setDue(t.toISOString().slice(0, 10)); }
                  }} style={[styles.iv, rectIv === iv && { backgroundColor: theme.accent, borderColor: theme.accent }]}>
                    <Text style={[styles.ivt, rectIv === iv && { color: theme.onAccent }]}>{iv}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <TextInput style={[styles.input, { width: 120, minHeight: 0 }]} value={due} onChangeText={setDue} placeholder="due YYYY-MM-DD" placeholderTextColor={theme.sub} />
          </View>
          {/* Calendar-day limit: show the time remaining live as the due date is entered. */}
          {remainingDue(due) ? <Text style={[styles.sub, { marginTop: 4, color: /OVERDUE/.test(remainingDue(due) || '') ? theme.red : theme.accent }]}>Remaining: {remainingDue(due)}</Text> : null}
          {/* FH/FC limits: the rectification interval can also be flight-hours and/or cycles limited —
              whichever limit (date / FH / FC) is reached first applies. Remaining is tracked from
              the aircraft TSN/CSN stamped at deferral. */}
          <View style={[styles.row, { marginTop: 8 }]}>
            <TextInput style={[styles.input, { width: 150, minHeight: 0 }]} value={maxFh} onChangeText={(v) => setMaxFh(v.replace(/[^0-9:]/g, ''))} keyboardType="numbers-and-punctuation" placeholder="Max FH — hh:mm (e.g. 50:00)" placeholderTextColor={theme.sub} />
            <TextInput style={[styles.input, { width: 150, minHeight: 0 }]} value={maxCyc} onChangeText={(v) => setMaxCyc(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="Max cycles (whole number)" placeholderTextColor={theme.sub} />
            <Text style={[styles.sub, { flex: 1, minWidth: 140 }]}>Limit = date / FH / FC, whichever is reached first — remaining FH/cycles are tracked from the aircraft hours/landings after deferral.</Text>
          </View>
          <TouchableOpacity style={[styles.act2, { backgroundColor: theme.accent, marginTop: 10 }]}
            onPress={() => {
              if (!basis) { setMsg('Select the deferral authority first (MEL / CDL / Approved data).'); return; }
              if (maxFh && parseFH(maxFh) == null) { setMsg('Max FH must be hh:mm — e.g. 50:00 or 50:30.'); return; }
              // A deferral must carry at least one limit — a due date, an FH limit, or a cycle limit.
              if (!due.trim() && !maxFh.trim() && !maxCyc.trim()) {
                setMsg('Enter at least one limit — due date, FH, or cycles. (MEL Cat B/C/D fill the due date automatically.)'); return;
              }
              act('deferral', {
              defer_basis: basis,
              mel_ref: basis === 'mel' ? (mel || undefined) : undefined,
              cdl_ref: basis === 'cdl' ? (mel || undefined) : undefined,
              approved_ref: basis === 'approved_data' ? (mel || undefined) : undefined,
              rect_interval: basis === 'mel' ? rectIv : undefined, due_date: due || undefined,
              max_cycles: maxCyc ? Number(maxCyc) : undefined,
              max_fh: maxFh ? (parseFH(maxFh) as number) : undefined,
            }); }}>
            <Text style={[styles.act2t, { color: theme.onAccent }]}>{amending ? 'Update deferral' : 'Defer'}{basis ? ` per ${basis === 'approved_data' ? 'Approved data' : basis.toUpperCase()}` : ''}{basis === 'mel' && rectIv ? ' ' + rectIv : ''}</Text>
          </TouchableOpacity>
          </>)}

          {/* The CRS clears the item straight to the Sign Off page. It can still be REVERSED (CRS done
              by mistake) until the aircraft next departs — after that, raise a correction. */}
          {isMech && d.reversible && (
            <View style={{ marginTop: 18, gap: 8 }}>
              <Text style={styles.sub}>✓ CRS issued — this item is cleared and now on the Sign Off page.</Text>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.red, alignSelf: 'flex-start' }]} onPress={reverse}>
                <Text style={[styles.act2t, { color: theme.red }]}>Reverse Rectify + CRS</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {canCommanderClear && d.captain_clearable && d.status !== 'closed' && (
        <>
          <Text style={styles.section}>Commander clearance</Text>
          <Text style={styles.sub}>This item is approved for clearance by the commander (e.g. cabin defect).</Text>
          <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green, marginTop: 12 }]} onPress={close}>
            <Text style={styles.act2t}>Clear as commander</Text>
          </TouchableOpacity>
        </>
      )}

      <MelPicker visible={melOpen} ata={(d?.ata_chapter || '').split('-')[0] || undefined} onClose={() => setMelOpen(false)} onPick={pickMel} />
      <CdlPicker visible={cdlOpen} ata={(d?.ata_chapter || '').split('-')[0] || undefined} onClose={() => setCdlOpen(false)} onPick={pickCdl} />

      {chain ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setChain(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(10,20,35,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 16, width: '100%', maxWidth: 560, maxHeight: '80%' }}>
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16 }}>Close another item on TL # {chain.tl}?</Text>
            <Text style={{ color: theme.sub, fontSize: 12, marginTop: 4 }}>
              This defect has been claimed on the ground log. Pick the next open / HIL / cabin item to work under the same TL #, or finish and go to the CRS.
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 10, maxHeight: 300 }}>
              {chain.items.length === 0 ? <Text style={{ color: theme.sub, fontSize: 12 }}>No other active items on this aircraft.</Text> :
                chain.items.map((c: any) => (
                  <TouchableOpacity key={c.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}
                    onPress={() => { setChain(null); navigation.replace('DefectDetail', { defectId: c.id }); }}>
                    <Text style={{ color: c.status === 'deferred' ? theme.sub : theme.red, fontWeight: '800', fontSize: 11 }}>
                      {(c.status || 'open').toUpperCase()}{c.mel_ref ? ` · ${c.mel_ref}` : ''}{c.hil_no ? ` · ${c.hil_no}` : ''}{c.area === 'cabin' ? ' · CABIN' : ''}
                    </Text>
                    <Text style={{ color: theme.text, fontSize: 13 }} numberOfLines={2}>{c.title || c.description}</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
            <TouchableOpacity style={{ backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 12 }}
              onPress={() => { const id = chain.logId; setChain(null); navigation.navigate('Release', { sectorId: id }); }}>
              <Text style={{ color: theme.onAccent, fontWeight: '800' }}>No more — go to the TL CRS ›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 10 }} onPress={() => setChain(null)}>
              <Text style={{ color: theme.sub, fontSize: 13 }}>Stay on this defect</Text>
            </TouchableOpacity>
          </View>
        </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  badge: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  desc: { color: theme.text, marginTop: 8 },
  sub: { color: theme.sub, marginTop: 4, fontSize: 13 },
  lbl: { color: theme.text, fontWeight: '800', fontSize: 13, marginTop: 16, marginBottom: 6 },
  msg: { color: theme.green, marginTop: 8 },
  section: { color: theme.text, fontWeight: '700', fontSize: 15, marginTop: 22, marginBottom: 10 },
  action: { backgroundColor: theme.panel, borderRadius: 8, padding: 10, marginBottom: 8 },
  actKind: { color: theme.text, fontWeight: '700', textTransform: 'uppercase', fontSize: 12 },
  actTime: { color: theme.sub, fontSize: 11, marginTop: 4 },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, minHeight: 44 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 10 },
  act2: { borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  act2t: { color: '#fff', fontWeight: '700' },
  iv: { borderWidth: 1, borderColor: theme.border, borderRadius: 6, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  ivt: { color: theme.text, fontWeight: '800' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: theme.panel, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: theme.border },
  melRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  melAta: { color: theme.accent, fontWeight: '800', width: 64 },
  melTitle: { color: theme.text, fontSize: 17, fontWeight: '800', marginBottom: 12 },
  melTable: { flexDirection: 'row', borderWidth: 1, borderColor: theme.border, borderRadius: 6, overflow: 'hidden' },
  melCell: { flex: 1, borderRightWidth: 1, borderRightColor: theme.border, padding: 8, alignItems: 'center' },
  melCellHead: { color: theme.sub, fontSize: 11, textAlign: 'center' },
  melCellVal: { color: theme.text, fontWeight: '800', marginTop: 4 },
  melBody: { color: theme.text, marginTop: 12, lineHeight: 20 },
  melSec: { color: theme.accent, fontWeight: '700', marginTop: 14 },
});
