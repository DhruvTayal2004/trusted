import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { SyncBadge } from '@/features/SyncBadge';
import { useQuery } from '@/features/useQuery';
import { listCustomers, totalOutstanding } from '@/lib/repos/customers';
import { Button, Chip, Empty, Field, ListRow, Money, Row, Screen, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

export default function KhataTab() {
  const [search, setSearch] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const q = useQuery(async () => ({ customers: await listCustomers(search, { withBalanceOnly: onlyDue }), outstanding: await totalOutstanding() }), [search, onlyDue]);
  return (
    <>
      <Stack.Screen options={{ title: 'Khata', headerRight: () => <SyncBadge /> }} />
      <Screen refreshing={q.loading} onRefresh={q.refresh}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="label">Total udhaar</T>
          <Money paise={q.data?.outstanding ?? 0} variant="heading" color={colors.credit} />
        </Row>
        <Field value={search} onChangeText={setSearch} placeholder="Search name or phone" style={{ marginTop: spacing.md }} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Chip label="Only with balance" selected={onlyDue} onPress={() => setOnlyDue(!onlyDue)} />
          <Button title="+ New customer" variant="secondary" size="sm" onPress={() => router.push('/(app)/customers/new')} />
        </Row>
        {q.data && q.data.customers.length === 0 ? <Empty title="No customers" hint="Add customers here or import from your handwritten khata using Scan notebook." /> : null}
        {(q.data?.customers ?? []).map((c) => (
          <ListRow
            key={c.id}
            title={c.name}
            subtitle={c.phone}
            right={<Money paise={c.balance_paise} color={c.balance_paise > 0 ? colors.credit : c.balance_paise < 0 ? colors.success : colors.textMuted} />}
            onPress={() => router.push({ pathname: '/(app)/customers/[id]', params: { id: c.id } })}
          />
        ))}
      </Screen>
    </>
  );
}
