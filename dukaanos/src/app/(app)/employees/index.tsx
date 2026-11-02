import { router } from 'expo-router';
import { useQuery } from '@/features/useQuery';
import { listMembersServer } from '@/lib/repos/members';
import { Button, Card, Empty, ErrorBanner, ListRow, Pill, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function EmployeesScreen() {
  const q = useQuery(() => listMembersServer());
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <ErrorBanner message={q.error ? `Needs internet: ${q.error}` : null} onRetry={q.refresh} />
      <Button title="+ Add employee" size="lg" onPress={() => router.push({ pathname: '/(app)/employees/edit', params: {} })} />
      <Card tone="info">
        <T variant="caption">Employees log in with the shop code + their PIN. Set a PIN after creating the employee. The shop code is in Settings.</T>
      </Card>
      {q.data && q.data.length === 0 ? <Empty title="No employees yet" /> : null}
      {(q.data ?? []).map((m) => (
        <ListRow
          key={m.id}
          title={m.display_name}
          subtitle={`${m.role}${m.phone ? ' · ' + m.phone : ''}`}
          right={<Pill label={!m.is_active ? 'Inactive' : m.user_id ? 'PIN set' : 'No PIN yet'} tone={!m.is_active ? 'muted' : m.user_id ? 'success' : 'warning'} />}
          onPress={() => router.push({ pathname: '/(app)/employees/edit', params: { id: m.id } })}
        />
      ))}
      <T variant="caption" color={colors.textMuted} style={{ marginTop: 16 }}>Owner accounts sign in with email. Admins and employees sign in with a PIN.</T>
    </Screen>
  );
}
