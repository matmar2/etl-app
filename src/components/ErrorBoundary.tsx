import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { reportDeviceError } from '../api/client';
import { theme } from '../theme';

// Catches render/runtime crashes anywhere in the tree, reports them to the back office (so QA and
// CAMO see the cause + corrective action), and shows a calm fallback instead of a white screen.
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: { componentStack?: string }) {
    reportDeviceError({
      kind: 'crash',
      message: err?.message || 'render crash',
      detail: `${err?.stack || ''}\n${info?.componentStack || ''}`.slice(0, 4000),
    }).catch(() => {});
  }
  render() {
    if (!this.state.err) return this.props.children as any;
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: theme.text, fontSize: 19, fontWeight: '800', marginBottom: 10 }}>Something went wrong</Text>
        <Text style={{ color: theme.sub, textAlign: 'center', lineHeight: 20, marginBottom: 18 }}>
          The app hit an error and reported it to the team automatically. Your saved work is kept. Please fully close the app (swipe up) and reopen it; if it keeps happening, note the steps in Feedback.
        </Text>
        <TouchableOpacity onPress={() => this.setState({ err: null })} style={{ backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 22 }}>
          <Text style={{ color: '#1a1300', fontWeight: '800' }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}
