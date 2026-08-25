import { Alert, Platform } from 'react-native';

// React Native Web's Alert.alert silently no-ops for multi-button alerts,
// so confirmation dialogs (design rule: dialogs are for confirmation only)
// need a web fallback to actually show anything.
export function confirmDestructive(title: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(title)) onConfirm();
    return;
  }
  Alert.alert(title, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
