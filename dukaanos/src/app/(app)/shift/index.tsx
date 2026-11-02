import { router } from 'expo-router';
import { View } from 'react-native';
import { isManager } from '@/core/permissions';
import { useMember } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { currentShift, listShifts } from '@/lib/repos/shifts';
import { Button, Card, Empty, ListRow, Money, Pill, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function ShiftsScreen() {
  const member = useMember();
  const q = useQuery(async () => ({ open: await currentShift(member.id), shifts: await listShifts({ memberId: isManager(member) ? undefined : member.id }) }), [member.id]);
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      {q.data?.open ? (
        <Card tone="success"><T variant="heading">Your shift is open</T><Button title="Close shift & count cash" onPress={() => router.push('/(app)/shift/close')} /></Card>
      ) : (
        <Button title="Open shift" size="lg" onPress={() => router.push('/(app)/shift/open')} />
      )}
      {q.data && q.data.shifts.length === 0 ? <Empty title="No shifts yet" /> : null}
      {(q.data?.shifts ?? []).map((s) => (
        <ListRow key={s.id}
          title={`${s.member_name ?? 'Employee'} · ${new Date(s.opened_at).toLocaleDateString([], { day: '2-digit', month: 'short' })}`}
          subtitle={`${new Date(s.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${s.closed_at ? new Date(s.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'open'}${s.closing_notes ? ' · ' + s.closing_notes : ''}`}
          right={s.status === 'open' ? <Pill label="Open" tone="success" /> : (
            <View style={{ alignItems: 'flex-end' }}>
              <T variant="caption" color={colors.textMuted}>expected <Money paise={s.expected_cash_paise ?? 0} variant="caption" /></T>
              <Money paise={s.cash_difference_paise ?? 0} sign color={(s.cash_difference_paise ?? 0) === 0 ? colors.success : colors.danger} />
            </View>
          )} />
      ))}
      <T variant="caption" color={colors.textMuted} style={{ marginTop: 12 }}>Difference = counted − expected. Expected cash is computed by the server from recorded transactions when the shift is closed.</T>
    </Screen>
  );
}
