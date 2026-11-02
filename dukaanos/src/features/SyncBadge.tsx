import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { syncStore } from '@/lib/sync/engine';
import { colors, radius } from '@/ui/theme';

/** Always-visible sync state: offline / pending / rejected / synced. Tap for details. */
export function SyncBadge() {
  const s = syncStore.use();
  const label = !s.online ? `Offline · ${s.pending} saved` : s.rejected > 0 ? `${s.rejected} rejected` : s.syncing ? 'Syncing…' : s.pending > 0 ? `${s.pending} pending` : 'Synced';
  const bg = !s.online ? colors.warningBg : s.rejected > 0 ? colors.dangerBg : s.pending > 0 ? colors.infoBg : colors.successBg;
  const fg = !s.online ? colors.warning : s.rejected > 0 ? colors.danger : s.pending > 0 ? colors.info : colors.success;
  return (
    <Pressable onPress={() => router.push('/(app)/sync')} hitSlop={8}>
      <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginRight: 8 }}>
        <Text style={{ color: fg, fontWeight: '700', fontSize: 12 }}>{label}</Text>
      </View>
    </Pressable>
  );
}
