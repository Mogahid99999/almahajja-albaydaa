/**
 * Cross-platform one-button alert. `Alert.alert` is a silent no-op on
 * react-native-web, so every admin screen that relied on it gave ZERO feedback
 * in the browser (the web dashboard is the admin's main surface) — successes
 * looked like nothing happened and failures were completely invisible.
 * Native keeps the familiar Alert dialog.
 */
import { Alert, Platform } from 'react-native';

export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
