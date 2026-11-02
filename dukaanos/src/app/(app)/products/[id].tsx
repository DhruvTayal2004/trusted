import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { isManager, visibleActions } from '@/core/permissions';
import { formatQty } from '@/core/units';
import { ProductForm } from '@/features/ProductForm';
import { useMember } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { getProduct } from '@/lib/repos/products';
import { ADJUSTMENT_LABELS, movementsForProduct, purchasePriceHistory, type AdjustmentType } from '@/lib/repos/stock';
import { Button, Card, Loading, Money, Pill, Row, Screen, SectionTitle, T } from '@/ui';
import { colors } from '@/ui/theme';

const MOVE_LABEL: Record<string, string> = { ...ADJUSTMENT_LABELS, sale: 'Sold', sale_reversal: 'Refund restock', purchase: 'Purchased', count_adjustment: 'Count correction', notebook_import: 'Notebook import' };

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const member = useMember();
  const actions = visibleActions(member);
  const [editing, setEditing] = useState(false);
  const q = useQuery(async () => ({ product: await getProduct(id), moves: await movementsForProduct(id, 50), prices: actions.purchasePrice ? await purchasePriceHistory(id) : [] }), [id]);
  const p = q.data?.product;
  if (!p) return <Loading />;
  if (editing) return <Screen><Stack.Screen options={{ title: 'Edit product' }} /><ProductForm existing={p} /></Screen>;
  const low = Number(p.min_stock_qty) > 0 && Number(p.stock_qty) <= Number(p.min_stock_qty);
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Stack.Screen options={{ title: p.name, headerRight: () => (isManager(member) ? <Button title="Edit" variant="ghost" size="sm" onPress={() => setEditing(true)} /> : null) }} />
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <T variant="caption" color={colors.textMuted}>In stock</T>
            <T variant="display" color={Number(p.stock_qty) < 0 ? colors.danger : low ? colors.warning : colors.text}>{formatQty(p.stock_qty, p.unit)}</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T variant="caption" color={colors.textMuted}>Sells at</T>
            <Money paise={p.selling_price_paise} variant="heading" />
            <T variant="caption" color={colors.textMuted}>per {p.unit}</T>
          </View>
        </Row>
        <Row style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {low ? <Pill label={`Below minimum ${p.min_stock_qty}`} tone="warning" /> : null}
          {Number(p.stock_qty) < 0 ? <Pill label="Negative stock — opening stock not set?" tone="danger" /> : null}
          {p.is_quick ? <Pill label="Quick button" tone="info" /> : null}
          {!p.is_active ? <Pill label="Inactive" tone="muted" /> : null}
          {p.barcode ? <Pill label={`Barcode ${p.barcode}`} tone="muted" /> : null}
        </Row>
        {actions.purchasePrice && p.purchase_price_paise != null ? <T color={colors.textMuted} style={{ marginTop: 8 }}>Last purchase price: <Money paise={p.purchase_price_paise} /> per {p.unit} · margin <Money paise={p.selling_price_paise - p.purchase_price_paise} /></T> : null}
      </Card>
      <Row style={{ flexWrap: 'wrap' }}>
        <Button title="Sell" icon="🧾" size="sm" onPress={() => router.push({ pathname: '/(app)/sale/new', params: { productId: p.id } })} />
        {actions.stockAdjust ? <Button title="Adjust stock" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/(app)/inventory/adjust', params: { productId: p.id } })} /> : null}
        {actions.receiveStock ? <Button title="Receive" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/(app)/purchases/new', params: { productId: p.id } })} /> : null}
      </Row>

      {actions.purchasePrice && (q.data?.prices.length ?? 0) > 0 ? (
        <>
          <SectionTitle>Purchase price history</SectionTitle>
          {q.data!.prices.map((h, i) => (
            <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
              <T>{h.invoice_date} · {h.supplier_name ?? 'No supplier'}</T>
              <T><Money paise={h.unit_cost_paise} /> × {h.qty}</T>
            </Row>
          ))}
        </>
      ) : null}

      <SectionTitle>Stock movements</SectionTitle>
      {(q.data?.moves ?? []).map((m) => (
        <Row key={m.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
          <View style={{ flex: 1 }}>
            <T>{MOVE_LABEL[m.movement_type] ?? m.movement_type}</T>
            <T variant="caption" color={colors.textMuted} numberOfLines={1}>{new Date(m.client_created_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{m.reason ? ' · ' + m.reason : ''}</T>
          </View>
          <T color={m.qty_delta.startsWith('-') ? colors.danger : colors.success} style={{ fontWeight: '700' }}>{m.qty_delta.startsWith('-') ? '' : '+'}{m.qty_delta} {p.unit}</T>
        </Row>
      ))}
      {q.data && q.data.moves.length === 0 ? <T color={colors.textMuted}>No movements yet. {isManager(member) ? 'Set opening stock with Adjust stock → Opening.' : ''}</T> : null}
      <T variant="caption" color={colors.textMuted} style={{ marginTop: 16 }}>Every change to stock is recorded as a movement. A difference between counted and system stock is a prompt to investigate causes (spillage, unrecorded sales, counting error) — it is not evidence of theft.</T>
    </Screen>
  );
}

export type { AdjustmentType };
