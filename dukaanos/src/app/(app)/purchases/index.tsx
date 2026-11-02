import { router } from 'expo-router';
import { View } from 'react-native';
import { useQuery } from '@/features/useQuery';
import { listPurchases } from '@/lib/repos/stock';
import { Button, Empty, ListRow, Money, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function PurchasesScreen() {
  const q = useQuery(() => listPurchases(200));
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Button title="Receive stock" icon="🚚" size="lg" onPress={() => router.push('/(app)/purchases/new')} />
      {q.data && q.data.length === 0 ? <Empty title="No purchases yet" /> : null}
      {(q.data ?? []).map((p) => (
        <ListRow key={p.id} title={`${p.supplier_name ?? 'Cash purchase'}${p.invoice_number ? ' · #' + p.invoice_number : ''}`} subtitle={`${p.invoice_date}${p.invoice_image_path ? ' · 📷' : ''}`}
          right={<View style={{ alignItems: 'flex-end' }}><Money paise={p.total_paise} /><T variant="caption" color={p.paid_paise >= p.total_paise ? colors.success : colors.credit}>{p.paid_paise >= p.total_paise ? 'paid' : `due ${((p.total_paise - p.paid_paise) / 100).toFixed(0)}`}</T></View>} />
      ))}
    </Screen>
  );
}
