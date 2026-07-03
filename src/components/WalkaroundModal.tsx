import React from 'react';
import { Image, Modal, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { WALKAROUND_AREAS, WALKAROUND_H, WALKAROUND_PNG, WALKAROUND_REF, WALKAROUND_W } from '../print/walkaround';
import { theme } from '../theme';

// FCOM Exterior Walkaround page shown when the crew start the PFI. They review the
// schematic (with the FCOM reference) and accept it here — acceptance then signs the PFI.
export default function WalkaroundModal({ visible, inspector, onAccept, onClose }:
  { visible: boolean; inspector?: string; onAccept: () => void; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const side = (width || 800) >= 720;                       // drawing + area list side-by-side (like the FCOM page)
  const inner = Math.min((width || 800) - 24, 1100);        // modal content width
  const tableW = side ? 250 : inner - 28;
  const imgW = side ? Math.min(WALKAROUND_W, inner - tableW - 44) : Math.min(WALKAROUND_W, inner - 28);
  const imgH = imgW * (WALKAROUND_H / WALKAROUND_W);
  const AreaList = (
    <View style={{ width: tableW, borderWidth: 1, borderColor: theme.border, borderRadius: 8, overflow: 'hidden', alignSelf: 'flex-start' }}>
      <Text style={{ color: theme.text, fontWeight: '800', fontSize: 12, padding: 8, backgroundColor: theme.tile }}>Inspection areas (1–21)</Text>
      {WALKAROUND_AREAS.map((it, i) => (
        <View key={it.n} style={{ flexDirection: 'row', gap: 8, paddingVertical: 5, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
          <Text style={{ color: theme.accent, fontWeight: '800', fontSize: 12, width: 22, textAlign: 'right' }}>{it.n}</Text>
          <Text style={{ color: theme.text, fontSize: 12, flex: 1 }}>{it.area}</Text>
        </View>
      ))}
    </View>
  );
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 12 }}>
        <View style={{ backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.border, maxHeight: '94%', width: inner, overflow: 'hidden' }}>
          <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16 }}>Exterior Walkaround — Pre‑Flight Inspection</Text>
            <Text style={{ color: theme.sub, fontSize: 11, marginTop: 3 }}>{WALKAROUND_REF}</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14 }}>
            <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 10 }}>
              Walk the aircraft points 1–21 in sequence. Confirm the exterior inspection is complete, then accept to sign the PFI.
            </Text>
            <View style={{ flexDirection: side ? 'row' : 'column', gap: 14, alignItems: 'flex-start' }}>
              <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 6 }}>
                <Image source={{ uri: WALKAROUND_PNG }} style={{ width: imgW, height: imgH }} resizeMode="contain" />
              </View>
              {AreaList}
            </View>
            {inspector ? <Text style={{ color: theme.sub, fontSize: 12, marginTop: 12 }}>Inspector: <Text style={{ color: theme.text, fontWeight: '700' }}>{inspector}</Text></Text> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: theme.border }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 13, alignItems: 'center' }}>
              <Text style={{ color: theme.text, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onAccept} style={{ flex: 2, backgroundColor: theme.green, borderRadius: 8, padding: 13, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>Walkaround complete — sign PFI</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
