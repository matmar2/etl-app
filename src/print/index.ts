import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { TLData, cabinDefectHtml, hilHtml, techLogHtml, techLogText } from './techlog';

// On web, expo-print renders into a single fixed iframe (clips to one page, races
// images). Opening a real browser window gives full pagination + the logo, and the
// user prints / Save-as-PDF natively. On the iPad, expo-print works directly.
function openInBrowser(html: string) {
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 400);   // let the logo image load first
  }
}

let _printing = false;   // iOS UIPrintInteractionController allows only one at a time

// Print a SERVER-rendered PDF (exact pagination: repeating header + Page N of X on every
// device — iPad print preview cannot paginate HTML like desktop browsers). Returns false
// when offline / the endpoint failed, so callers fall back to the HTML path.
export async function printServerPdf(path: string): Promise<boolean> {
  try {
    const { fetchPdfLocal } = require('../api/client');
    const uri = await fetchPdfLocal(path);
    if (!uri) return false;
    if (Platform.OS === 'web') { window.open(uri, '_blank'); return true; }
    if (_printing) return true;
    _printing = true;
    try { await Print.printAsync({ uri }); }
    catch (e: any) { if (!/cancel|dismiss/i.test(String(e?.message))) throw e; }
    finally { _printing = false; }
    return true;
  } catch { return false; }
}
export async function printHtml(html: string) {
  if (Platform.OS === 'web') { openInBrowser(html); return; }
  if (_printing) return;                                    // ignore a double-tap while a sheet is open
  _printing = true;
  try {
    await Print.printAsync({ html });
  } catch (e: any) {
    // The user cancelled/closed the print preview, or iOS still thinks one is in progress.
    // Swallow it (do NOT let it bubble to a data-fallback path) and, if it was a busy race,
    // release and retry once so the NEXT view/print is never blocked.
    if (/in progress/i.test(String(e?.message))) {
      _printing = false;
      await new Promise((r) => setTimeout(r, 500));
      try { _printing = true; await Print.printAsync({ html }); } catch { /* give up quietly */ }
    }
  } finally {
    _printing = false;                                      // always release the lock, even on cancel
  }
}
export async function shareHtml(html: string) {
  if (Platform.OS === 'web') { openInBrowser(html); return; }   // browser → Save as PDF
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }
  return uri;
}

// Each document prints/transfers separately (TL page, cabin defects, HIL).
type Doc = 'tl' | 'cabin' | 'hil';
const RENDER: Record<Doc, (d: TLData) => string> = { tl: techLogHtml, cabin: cabinDefectHtml, hil: hilHtml };

// AirPrint (incl. AirPrint-capable Bluetooth/Wi-Fi printers) — native iOS print dialog.
export const airPrint = (data: TLData, doc: Doc = 'tl') => printHtml(RENDER[doc](data));
// Render to a PDF and hand to the iOS share sheet (AirDrop/Files/Mail) — "transfer to another device".
export const sharePdf = (data: TLData, doc: Doc = 'tl') => shareHtml(RENDER[doc](data));

// --- Bluetooth thermal (ESC/POS) -------------------------------------------
// Direct BLE printing needs a native module (react-native-ble-plx / a thermal
// SDK) and therefore an EAS dev build — it does NOT run in Expo Go. The ESC/POS
// payload is ready; wire the transport once the onboard printer model is known.
export function escposPayload(data: TLData): string {
  // ESC @ (init) + text + feed/cut
  return '\x1b\x40' + techLogText(data) + '\n\n\n';
}

let _btTransport: ((bytes: string) => Promise<void>) | null = null;
export function registerBluetoothTransport(fn: (bytes: string) => Promise<void>) {
  _btTransport = fn;
}
export function bluetoothAvailable() {
  return _btTransport !== null;
}
export async function bluetoothPrint(data: TLData) {
  if (!_btTransport) throw new Error('Bluetooth printer not configured (needs dev build + printer model)');
  await _btTransport(escposPayload(data));
}
