import { router } from 'expo-router';
import { useState } from 'react';
import { useQuery } from '@/features/useQuery';
import { listSuppliers, totalPayable } from '@/lib/repos/suppliers';
import { Button, Empty, Field, ListRow, Money, Row, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function SuppliersScreen() {
  const [search, setSearch] = useState('');
  const q = useQuery(async () => ({ suppliers: await listSuppliers(search), payable: await totalPayable() }), [search]);
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label">Total payable</T>
        <Money paise={q.data?.payable ?? 0} variant="heading" color={colors.credit} />
      </Row>
      <Field value={search} onChangeText={setSearch} placeholder="Search supplier" />
      <Row>
        <Button title="+ Supplier" size="sm" onPress={() => router.push('/(app)/suppliers/new')} />
        <Button title="Receive stock" size="sm" variant="secondary" onPress={() => router.push('/(app)/purchases/new')} />
        <Button title="Purchases" size="sm" variant="ghost" onPress={() => router.push('/(app)/purchases')} />
      </Row>
      {q.data && q.data.suppliers.length === 0 ? <Empty title="No suppliers yet" /> : null}
      {(q.data?.suppliers ?? []).map((s) => (
        <ListRow key={s.id} title={s.name} subtitle={s.phone} right={<Money paise={s.balance_paise} color={s.balance_paise > 0 ? colors.credit : colors.textMuted} />} onPress={() => router.push({ pathname: '/(app)/suppliers/[id]', params: { id: s.id } })} />
      ))}
    </Screen>
  );
}
