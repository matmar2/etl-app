import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { theme } from '../theme';

// Scan a part label (1D/2D barcode or QR) to fill Part № / Serial № on the Component Change form.
// Native module (expo-camera) — active only in a native build; the camera permission string is set
// by the expo-camera config plugin (app.json).
export default function BarcodeScanner({ visible, onClose, onScanned }: {
  visible: boolean;
  onClose: () => void;
  onScanned: (value: string) => void;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const [done, setDone] = useState(false);   // one-shot guard: fire onScanned once per open
  useEffect(() => { if (visible) setDone(false); }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        {!perm?.granted ? (
          <View style={s.center}>
            <Text style={s.msg}>Camera access is needed to scan a part barcode / QR code.</Text>
            <TouchableOpacity style={s.btn} onPress={() => requestPerm()}><Text style={s.btnT}>Allow camera</Text></TouchableOpacity>
            <TouchableOpacity style={s.close} onPress={onClose}><Text style={s.closeT}>Cancel</Text></TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'datamatrix', 'pdf417', 'ean13', 'aztec', 'itf14'] }}
              onBarcodeScanned={done ? undefined : (r) => { setDone(true); onScanned(r.data); onClose(); }}
            />
            <View style={s.overlay} pointerEvents="none"><View style={s.frame} /></View>
            <Text style={s.hint}>Point at the part’s barcode / QR</Text>
            <TouchableOpacity style={s.close} onPress={onClose}><Text style={s.closeT}>Cancel</Text></TouchableOpacity>
          </>
        )}
      </View>
    </Modal>
  );
}

// Best-effort parse of an aviation part label into Part № / Serial №. Handles common key-prefixed
// formats (P/N, PNR, S/N, SER, SEQ); a plain code is treated as the part number for the user to adjust.
export function parsePartBarcode(raw: string): { pn?: string; sn?: string } {
  const str = (raw || '').replace(/[]/g, ' ').trim();   // strip GS1/ISO group separators
  const pn = str.match(/(?:P\/?N|PNR|PART\s*N[O.]?)[:\s=#]+([A-Za-z0-9][A-Za-z0-9\-\/.]*)/i)?.[1];
  const sn = str.match(/(?:S\/?N|SER(?:IAL)?|SEQ)[:\s=#]+([A-Za-z0-9][A-Za-z0-9\-\/.]*)/i)?.[1];
  if (pn || sn) return { pn, sn };
  return { pn: str };
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: theme.bg },
  msg: { color: theme.text, fontSize: 15, textAlign: 'center', marginBottom: 16 },
  btn: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20 },
  btnT: { color: theme.onAccent, fontWeight: '800' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 260, height: 160, borderWidth: 3, borderColor: theme.accent, borderRadius: 12, backgroundColor: 'transparent' },
  hint: { position: 'absolute', top: 80, alignSelf: 'center', color: '#fff', fontSize: 15, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 },
  close: { position: 'absolute', bottom: 44, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 28 },
  closeT: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
