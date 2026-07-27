import { Alert, Platform } from 'react-native';

/** Cross-platform OK-only notice. Used where an inline message could be scrolled out of view
 *  (e.g. the missing-fields list when signing — the screen auto-scrolls to the first gap). */
export function notifyAction(message: string, title = 'Notice'): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/** Cross-platform yes/no confirm. window.confirm on web, Alert on native. */
export function confirmAction(message: string, title = 'Confirm'): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : true);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Confirm', onPress: () => resolve(true) },
    ]);
  });
}
