import { StyleSheet } from 'react-native';

// Shared visual language for the three (auth) screens -- hub-select,
// login, signup -- so they read as one flow instead of three independently
// hand-tuned forms. All three are the same bottom-anchored sheet shape
// (authStyles.panel, paired with each screen's own container: { flex: 1,
// justifyContent: 'flex-end' }) -- every shared surface -- the panel
// material, text inputs, primary button, error text, small uppercase
// labels -- pulls from here so they can't quietly drift out of sync again.

export function authCardBackground(colorScheme: 'light' | 'dark'): string {
  return colorScheme === 'dark' ? 'rgba(21,23,24,0.86)' : 'rgba(255,255,255,0.9)';
}

export const authStyles = StyleSheet.create({
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    // Explicit bottom clearance (unlike a modal sheet layered over other
    // content) -- this is the whole screen, flush with the physical bottom
    // edge/home indicator, so the last interactive element needs real
    // breathing room instead of relying on its own small margin.
    paddingBottom: 32,
  },
  input: {
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  error: {
    color: '#b0392f',
    marginBottom: 12,
  },
  button: {
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
  },
  buttonFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
