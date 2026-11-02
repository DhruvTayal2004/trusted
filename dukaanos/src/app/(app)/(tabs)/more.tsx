import { Stack, router } from 'expo-router';
import { Alert } from 'react-native';
import { visibleActions } from '@/core/permissions';
import { SyncBadge } from '@/features/SyncBadge';
import { signOut, useMember, useSession } from '@/features/session';
import { syncStore } from '@/lib/sync/engine';
import { Button, Card, ListRow, Pill, Screen, SectionTitle, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function MoreTab() {
  const member = useMember();
  const { shop } = useSession();
  const a = visibleActions(member);
  const sync = syncStore.use();
  const go = (path: string) => () => router.push(path as never);
  return (
    <>
      <Stack.Screen options={{ title: 'More', headerRight: () => <SyncBadge /> }} />
      <Screen>
        <Card>
          <T variant="heading">{member.display_name}</T>
          <T color={colors.textMuted}>{shop?.name} · {member.role}</T>
        </Card>

        <SectionTitle>Daily work</SectionTitle>
        <ListRow title="Shifts & cash closing" subtitle="Open / close shift, past closings" onPress={go('/(app)/shift')} />
        {a.expenses ? <ListRow title="Expenses" onPress={go('/(app)/expenses')} /> : null}
        <ListRow title="UPI verification" subtitle="Mark pending UPI payments as received" onPress={go('/(app)/upi')} />
        {a.suppliers ? <ListRow title="Suppliers & purchases" onPress={go('/(app)/suppliers')} /> : null}

        {a.dashboard ? (
          <>
            <SectionTitle>Owner</SectionTitle>
            <ListRow title="AI assistant" subtitle="Aaj kitni sale hui? Ramesh ka udhaar?" onPress={go('/(app)/assistant')} />
            <ListRow title="Scan notebook" subtitle="Import handwritten khata, bills, expenses" onPress={go('/(app)/scanner')} />
            <ListRow title="Reports" subtitle="Daily, weekly, monthly, unusual activity" onPress={go('/(app)/reports')} />
            <ListRow title="Approvals" subtitle="Expenses waiting for approval" onPress={go('/(app)/approvals')} />
            <ListRow title="Employees" subtitle="Accounts, PINs, permissions" onPress={go('/(app)/employees')} />
            <ListRow title="Alerts & WhatsApp" subtitle="Daily report, low stock, reminders" onPress={go('/(app)/alerts')} />
            <ListRow title="Audit log" subtitle="Who changed what" onPress={go('/(app)/audit')} />
            <ListRow title="Settings" subtitle="Shop code, thresholds" onPress={go('/(app)/settings')} />
          </>
        ) : null}

        <SectionTitle>Device</SectionTitle>
        <ListRow title="Sync status" subtitle={sync.online ? 'Online' : 'Offline — changes are saved on this phone'} right={<Pill label={`${sync.pending} pending`} tone={sync.pending ? 'info' : 'muted'} />} onPress={go('/(app)/sync')} />
        <Button
          title="Sign out of this device"
          variant="danger"
          onPress={() => {
            if (sync.pending > 0) {
              Alert.alert('Unsynced records', `${sync.pending} record(s) have not reached the server yet. Signing out will delete them from this phone. Connect to the internet first.`, [{ text: 'Cancel' }]);
              return;
            }
            Alert.alert('Sign out?', 'Local data on this phone will be cleared.', [{ text: 'Cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }]);
          }}
          style={{ marginTop: 24 }}
        />
      </Screen>
    </>
  );
}
