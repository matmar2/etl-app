import React, { useRef } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';
import { theme } from '../theme';

// Drawn-signature capture. Returns a base64 PNG data URI via onDone.
export default function SignaturePad({ visible, onClose, onDone, title = 'Sign' }: {
  visible: boolean; onClose: () => void; onDone: (dataUrl: string) => void; title?: string;
}) {
  const ref = useRef<any>(null);
  const style = `.m-signature-pad{box-shadow:none;border:none} .m-signature-pad--body{border:1px solid #ccc}
    .m-signature-pad--footer{display:none}`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>Sign with your finger or Apple Pencil.</Text>
        <View style={s.canvas}>
          <SignatureScreen
            ref={ref}
            onOK={(sig: string) => onDone(sig)}            // sig = data:image/png;base64,...
            webStyle={style}
            backgroundColor="#ffffff"
            penColor="#000000"
            autoClear={false}
          />
        </View>
        <View style={s.row}>
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile }]} onPress={onClose}><Text style={s.btnTxt}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile }]} onPress={() => ref.current?.clearSignature()}><Text style={s.btnTxt}>Clear</Text></TouchableOpacity>
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.green }]} onPress={() => ref.current?.readSignature()}><Text style={[s.btnTxt, { color: '#fff' }]}>Use signature</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 16, paddingTop: 48 },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 4, marginBottom: 10 },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, borderRadius: 8, padding: 14, alignItems: 'center' },
  btnTxt: { color: theme.text, fontWeight: '700' },
});
