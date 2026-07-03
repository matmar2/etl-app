import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { techlogPage } from '../api/client';
import { fmtTl } from '../util/tl';
import { theme } from '../theme';

const hm = (v: any) => { if (!v) return '—'; const m = String(v).match(/T?(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : '—'; };
const kg = (v: any) => (v == null || v === '') ? '—' : Number(v).toLocaleString('en-US');
const m2hm = (m: any) => (m == null) ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

// Read-only Tech Log page — the record that goes to OASES — beside the matching Leon
// flight-watch. Same layout as the CAMO tech-log sector page, without accept buttons.
export default function TechLogPageModal({ sectorId, onClose }: { sectorId: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { techlogPage(sectorId).then(setD).catch((e) => setErr(e.message || 'Could not load')); }, [sectorId]);
  const t = d?.tech || {}, l = d?.leon || {};

  const HeadRow = () => (
    <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
      <View style={{ flex: 1.5 }} />
      <Text style={{ flex: 1, textAlign: 'right', color: theme.sub, fontSize: 11, fontWeight: '800' }}>TECH LOG</Text>
      <Text style={{ flex: 1, textAlign: 'right', color: theme.sub, fontSize: 11, fontWeight: '800' }}>LEON</Text>
    </View>
  );
  const cell = (v: any, diff: boolean, green?: boolean) => (
    <View style={{ flex: 1, backgroundColor: theme.bg, borderWidth: 1, borderColor: diff ? '#d9a300' : theme.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 8 }}>
      <Text style={{ textAlign: 'center', color: diff ? '#d9a300' : (green ? theme.green : theme.text), fontSize: 13, fontWeight: '700' }}>{v}</Text>
    </View>
  );
  const Row = ({ label, a, b }: any) => {
    const diff = a !== '—' && b !== '—' && String(a) !== String(b);
    return (
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ flex: 1.4, color: theme.sub, fontSize: 13 }}>{label}</Text>
        {cell(a, diff)}
        {cell(b, diff, true)}
      </View>
    );
  };
  const Field = ({ label, value }: any) => (
    <View style={{ width: 118, marginBottom: 8 }}>
      <Text style={{ color: theme.sub, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      <View style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 8, marginTop: 3 }}>
        <Text style={{ color: theme.text, fontSize: 14 }}>{(value == null || value === '') ? '—' : String(value)}</Text>
      </View>
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: theme.panel, borderRadius: 14, maxHeight: '92%', borderWidth: 1, borderColor: theme.border, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>Tech Log Sector{t.flight_no ? ` — ${t.flight_no}` : ''}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={{ color: theme.sub, fontSize: 20 }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {err ? <Text style={{ color: theme.red }}>{err}</Text> : !d ? <Text style={{ color: theme.sub }}>Loading…</Text> : (<>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Field label="Tech Log Page" value={t.page_no ? `${d.reg}/${fmtTl(t.page_no)}` : '—'} />
                <Field label="Sector Date" value={t.flight_date} />
                <Field label="Flight Number" value={t.flight_no} />
                <Field label="Flight Type" value={t.flight_type} />
                <Field label="Sector Type" value={t.cancelled ? 'CANCELLED' : 'FLOWN'} />
                <Field label="From" value={t.dep} />
                <Field label="To" value={t.diversion || t.arr} />
                <Field label="Landings" value={t.landings} />
              </View>

              <Text style={{ color: theme.text, fontWeight: '800', fontSize: 14, marginTop: 14, marginBottom: 6 }}>Flight Times (GMT) · Block {m2hm(t.block_min)} · Flt {m2hm(t.flight_min)}</Text>
              <HeadRow />
              <Row label="Chocks OFF" a={hm(t.off_block)} b={hm(l.out)} />
              <Row label="Takeoff" a={hm(t.takeoff)} b={hm(l.off)} />
              <Row label="Landing" a={hm(t.landing)} b={hm(l.on)} />
              <Row label="Chocks ON" a={hm(t.on_block)} b={hm(l.in)} />

              <Text style={{ color: theme.text, fontWeight: '800', fontSize: 14, marginTop: 16, marginBottom: 6 }}>Fuel &amp; Oil</Text>
              <HeadRow />
              <Row label="Fuel uplift (KG)" a={kg(t.uplift_kg)} b={kg(l.uplift_kg)} />
              <Row label="Fuel at departure (KG)" a={kg(t.dep_fuel_kg)} b={kg(l.dep_fuel_kg)} />
              <Row label="Landing fuel (KG)" a={kg(t.landing_fuel_kg)} b={kg(l.landing_fuel_kg)} />
              <Row label="Fuel at arrival (KG)" a={kg(t.arrival_fuel_kg)} b={kg(l.jl_remaining_fuel_kg ?? l.landing_fuel_kg)} />
              <Row label="Fuel used (KG)" a={kg(t.fuel_burnt)} b={kg(l.used_fuel_kg)} />
              <Row label="Planned fuel (KG)" a={kg(t.planned_kg)} b={kg(l.planned_fuel_kg)} />
              <Row label="Oil — ENG 1 (QT)" a={t.oil_eng1 ?? '—'} b={'—'} />
              <Row label="Oil — ENG 2 (QT)" a={t.oil_eng2 ?? '—'} b={'—'} />
              <Row label="Oil — APU (QT)" a={t.oil_apu ?? '—'} b={'—'} />

              <Text style={{ color: theme.sub, fontSize: 11, marginTop: 12, lineHeight: 16 }}>Amber = Tech Log and Leon differ. Read-only — this is the record that goes to OASES.</Text>
            </>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
