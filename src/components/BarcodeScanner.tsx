import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';

// Scan a part label (1D/2D barcode or QR) to fill Part № / Serial № on the Component Change form.
//
// CRITICAL: expo-camera must not even be require()d on binaries that lack the native module.
// A try/catch around require is NOT enough — the library's import can abort NATIVELY (uncatchable)
// on pre-1.0.2 binaries, crashing the app at boot so expo-updates rolls back to the embedded
// bundle (the 26–27 Jul incidents). requireOptionalNativeModule asks the native registry safely
// (returns null when absent) — only then is the JS library loaded.
import { requireOptionalNativeModule } from 'expo';
let Camera: any = null;
if (requireOptionalNativeModule('ExpoCamera')) {
  try { Camera = require('expo-camera'); } catch { Camera = null; }
}
export const cameraAvailable = !!(Camera && Camera.CameraView);

export default function BarcodeScanner(props: {
  visible: boolean;
  onClose: () => void;
  onScanned: (value: string) => void;
}) {
  if (!cameraAvailable) {
    return (
      <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose} transparent>
        <View style={[s.center, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
          <View style={{ backgroundColor: theme.panel, borderRadius: 12, padding: 20, maxWidth: 420 }}>
            <Text style={s.msg}>Barcode scanning arrives with the next app update (1.0.2) — this build doesn’t include the camera module yet. Type the Part № / Serial № manually for now.</Text>
            <TouchableOpacity style={s.btn} onPress={props.onClose}><Text style={s.btnT}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }
  return <Scanner {...props} />;
}

// Separate component so camera hooks only run when the native module exists.
function Scanner({ visible, onClose, onScanned }: { visible: boolean; onClose: () => void; onScanned: (v: string) => void }) {
  const CameraView = Camera.CameraView;
  const [perm, requestPerm] = Camera.useCameraPermissions();
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
              onBarcodeScanned={done ? undefined : (r: any) => { setDone(true); onScanned(r.data); onClose(); }}
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
  const str = (raw || '').replace(/[]/g, ' ').trim();   // strip GS1/ISO group separators
  const pn = str.match(/(?:P\/?N|PNR|PART\s*N[O.]?)[:\s=#]+([A-Za-z0-9][A-Za-z0-9\-\/.]*)/i)?.[1];
  const sn = str.match(/(?:S\/?N|SER(?:IAL)?|SEQ)[:\s=#]+([A-Za-z0-9][A-Za-z0-9\-\/.]*)/i)?.[1];
  if (pn || sn) return { pn, sn };
  return { pn: str };
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  msg: { color: theme.text, fontSize: 15, textAlign: 'center', marginBottom: 16 },
  btn: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  btnT: { color: theme.onAccent, fontWeight: '800' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 260, height: 160, borderWidth: 3, borderColor: theme.accent, borderRadius: 12, backgroundColor: 'transparent' },
  hint: { position: 'absolute', top: 80, alignSelf: 'center', color: '#fff', fontSize: 15, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 },
  close: { position: 'absolute', bottom: 44, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 28 },
  closeT: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
