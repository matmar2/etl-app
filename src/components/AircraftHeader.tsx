import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { aircraftConfig, listHIL, markNoticeRead, myNotices, Notice } from '../api/client';
import { theme } from '../theme';

function Chip({ label, alert, onPress }: { label: string; alert?: boolean; onPress?: () => void }) {
  const body = <View style={[styles.chip, alert ? styles.chipAlert : null]}><Text style={[styles.chipText, alert ? styles.chipAlertText : null]}>{label}</Text></View>;
  return onPress ? <TouchableOpacity onPress={onPress}>{body}</TouchableOpacity> : body;
}

export default function AircraftHeader({ reg, type, msn }: { reg: string; type: string; msn: string }) {
  const utc = new Date().toISOString().slice(11, 16);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [hil, setHil] = useState<any[]>([]);
  const [cfg, setCfg] = useState<any>(null);
  const [show, setShow] = useState<null | 'notice' | 'lim'>(null);

  useEffect(() => {
    myNotices().then(setNotices).catch(() => {});
    listHIL(reg).then((d) => setHil(Array.isArray(d) ? d : [])).catch(() => setHil([]));
    aircraftConfig(reg).then(setCfg).catch(() => {});
  }, [reg]);

  const unread = notices.filter((n) => !n.read).length;

  async function readNotice(n: Notice) {
    if (n.read) return;
    try { await markNoticeRead(n.id); setNotices((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x))); } catch { /* offline */ }
  }

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Chip label={`Crew Notice (${unread})`} alert={unread > 0} onPress={() => setShow('notice')} />
        <Chip label={`Limitations (${hil.length})`} alert={hil.length > 0} onPress={() => setShow('lim')} />
      </View>
      <View style={styles.center}>
        <Text style={styles.reg}>{reg}</Text>
        <Text style={styles.sub}>{type} · MSN {msn}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.utc}>UTC {utc}</Text>
      </View>

      <Modal visible={show === 'notice'} transparent animationType="fade" onRequestClose={() => setShow(null)}>
        <View style={styles.backdrop}><View style={styles.modalCard}>
          <View style={styles.head}><Text style={styles.title}>Crew / Mechanic Notices</Text><TouchableOpacity onPress={() => setShow(null)}><Text style={styles.closeTxt}>Close</Text></TouchableOpacity></View>
          <ScrollView style={{ maxHeight: 460 }}>
            {notices.length === 0 ? <Text style={styles.empty}>No notices.</Text> : notices.map((n) => (
              <TouchableOpacity key={n.id} style={[styles.notice, { borderLeftColor: n.read ? theme.green : theme.red }]} onPress={() => readNotice(n)}>
                <Text style={styles.nTitle}>{n.severity === 'important' ? '⚠ ' : ''}{n.title} <Text style={{ color: n.read ? theme.green : theme.red, fontSize: 11 }}>{n.read ? '· read ✓' : '· tap to mark read'}</Text></Text>
                <Text style={styles.nBody}>{n.body}</Text>
                <Text style={styles.nMeta}>{n.audience} · {n.created_at.slice(0, 10)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View></View>
      </Modal>

      <Modal visible={show === 'lim'} transparent animationType="fade" onRequestClose={() => setShow(null)}>
        <View style={styles.backdrop}><View style={styles.modalCard}>
          <View style={styles.head}><Text style={styles.title}>Limitations · {reg}</Text><TouchableOpacity onPress={() => setShow(null)}><Text style={styles.closeTxt}>Close</Text></TouchableOpacity></View>
          <ScrollView style={{ maxHeight: 460 }}>
            <Text style={styles.secTitle}>Hold Item List (deferred / MEL) — {hil.length}</Text>
            {hil.length === 0 ? <Text style={styles.empty}>No open limitations for {reg}.</Text> : hil.map((d) => (
              <View key={d.id} style={styles.notice}>
                <Text style={styles.nTitle}>{d.title || d.description}</Text>
                <Text style={styles.nMeta}>ATA {d.ata_chapter || '—'}{d.mel_ref ? ` · MEL ${d.mel_ref}` : ''}{d.due_date ? ` · due ${d.due_date}` : ''}</Text>
              </View>
            ))}
            {cfg ? (
              <>
                <Text style={styles.secTitle}>FCOM limits (admin-maintained)</Text>
                <Text style={styles.nBody}>Min fuel (take-off): {cfg.min_fuel_kg ?? '—'} kg · Usable fuel: {cfg.fuel_capacity_kg ?? '—'} kg</Text>
                <Text style={styles.nBody}>Oil min: {cfg.oil_min_qt ?? '—'} qt · Hyd LO LVL G{cfg.hyd_min_green_l ?? '—'} / B{cfg.hyd_min_blue_l ?? '—'} / Y{cfg.hyd_min_yellow_l ?? '—'} L</Text>
                {cfg.fuel_ref ? <Text style={styles.nMeta}>{cfg.fuel_ref}</Text> : null}
                {cfg.oil_hyd_ref ? <Text style={styles.nMeta}>{cfg.oil_hyd_ref}</Text> : null}
              </>
            ) : null}
          </ScrollView>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  left: { flexDirection: 'row', gap: 8 },
  right: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  center: { alignItems: 'center' },
  reg: { color: theme.text, fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  sub: { color: theme.sub, fontSize: 12 },
  utc: { color: theme.sub, fontSize: 12 },
  chip: { borderWidth: 1, borderColor: theme.accent, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { color: theme.text, fontSize: 11 },
  chipAlert: { borderColor: theme.red, backgroundColor: 'rgba(255,80,80,0.12)' },
  chipAlertText: { color: theme.red, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 18 },
  modalCard: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 16, maxHeight: '90%' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: theme.text, fontSize: 18, fontWeight: '800' },
  closeTxt: { color: theme.accent, fontWeight: '700' },
  empty: { color: theme.sub, paddingVertical: 8 },
  secTitle: { color: theme.sub, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginTop: 12, marginBottom: 6 },
  notice: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 4, borderRadius: 8, padding: 10, marginBottom: 8 },
  nTitle: { color: theme.text, fontWeight: '800', fontSize: 14 },
  nBody: { color: '#cde', fontSize: 13, lineHeight: 19, marginTop: 4 },
  nMeta: { color: theme.sub, fontSize: 11, marginTop: 4 },
});
