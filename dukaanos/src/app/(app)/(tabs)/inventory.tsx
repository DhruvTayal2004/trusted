import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { isManager, visibleActions } from '@/core/permissions';
import { formatQty } from '@/core/units';
import { SyncBadge } from '@/features/SyncBadge';
import { useMember } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { listProducts } from '@/lib/repos/products';
import { Button, Chip, Empty, Field, ListRow, Row, Screen, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

export default function InventoryTab() {
  const member = useMember();
  const actions = visibleActions(member);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'quick'>('all');
  const q = useQuery(async () => {
    const all = await listProducts({ search, quickOnly: filter === 'quick', includeInactive: isManager(member) });
    return filter === 'low' ? all.filter((p) => Number(p.min_stock_qty) > 0 && Number(p.stock_qty) <= Number(p.min_stock_qty)) : all;
  }, [search, filter]);
  return (
    <>
      <Stack.Screen options={{ title: 'Stock', headerRight: () => <SyncBadge /> }} />
      <Screen refreshing={q.loading} onRefresh={q.refresh}>
        <Field value={search} onChangeText={setSearch} placeholder="Search product / chawal / barcode" />
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label="Low stock" selected={filter === 'low'} onPress={() => setFilter('low')} color={colors.warning} />
          <Chip label="Quick" selected={filter === 'quick'} onPress={() => setFilter('quick')} />
        </Row>
        <Row style={{ marginVertical: spacing.md, flexWrap: 'wrap' }}>
          {actions.products ? <Button title="+ Product" size="sm" onPress={() => router.push('/(app)/products/new')} /> : null}
          {actions.receiveStock ? <Button title="Receive stock" size="sm" variant="secondary" onPress={() => router.push('/(app)/purchases/new')} /> : null}
          {actions.stockAdjust ? <Button title="Adjust" size="sm" variant="secondary" onPress={() => router.push('/(app)/inventory/adjust')} /> : null}
          {actions.stockAdjust ? <Button title="Count" size="sm" variant="secondary" onPress={() => router.push('/(app)/inventory/count')} /> : null}
        </Row>
        {q.data && q.data.length === 0 ? <Empty title="No products" hint={actions.products ? 'Add your first product to start billing.' : 'Ask the owner to add products.'} /> : null}
        {(q.data ?? []).map((p) => {
          const low = Number(p.min_stock_qty) > 0 && Number(p.stock_qty) <= Number(p.min_stock_qty);
          return (
            <ListRow
              key={p.id}
              title={`${p.name}${p.name_hi ? ' · ' + p.name_hi : ''}${p.is_active ? '' : ' (inactive)'}`}
              subtitle={`${formatPaiseShort(p.selling_price_paise)}/${p.unit}${actions.purchasePrice && p.purchase_price_paise != null ? ` · buy ${formatPaiseShort(p.purchase_price_paise)}` : ''}`}
              right={<View style={{ alignItems: 'flex-end' }}><T color={Number(p.stock_qty) < 0 ? colors.danger : low ? colors.warning : colors.text} style={{ fontWeight: '700' }}>{formatQty(p.stock_qty, p.unit)}</T>{low ? <T variant="caption" color={colors.warning}>below min {p.min_stock_qty}</T> : null}</View>}
              onPress={() => router.push({ pathname: '/(app)/products/[id]', params: { id: p.id } })}
            />
          );
        })}
      </Screen>
    </>
  );
}

function formatPaiseShort(p: number) {
  return `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
