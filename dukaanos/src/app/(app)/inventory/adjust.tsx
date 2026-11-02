import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { isManager } from '@/core/permissions';
import { normaliseQty } from '@/core/units';
import { useMember, useSession } from '@/features/session';
import { getProduct, listProducts } from '@/lib/repos/products';
import { ADJUSTMENT_LABELS, recordAdjustment, type AdjustmentType } from '@/lib/repos/stock';
import type { Product } from '@/lib/repos/types';
import { syncNow } from '@/lib/sync/engine';
import { Button, Card, Chip, ErrorBanner, Field, Row, Screen, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

export default function AdjustStockScreen() {
  const { shop } = useSession();
  const member = useMember();
  const params = useLocalSearchParams<{ productId?: string }>();
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [type, setType] = useState<AdjustmentType>(isManager(member) ? 'opening' : 'damage');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void listProducts({ search }).then(setProducts); }, [search]);
  useEffect(() => { if (params.productId) void getProduct(params.productId).then(setProduct); }, [params.productId]);

  const types = (Object.keys(ADJUSTMENT_LABELS) as AdjustmentType[]).filter((t) => t !== 'opening' || isManager(member));
  const isIncrease = type === 'opening' || type === 'manual_adjustment';

  async function submit() {
    if (!product) return setError('Pick a product');
    const q = normaliseQty(qty.replace('-', ''), product.unit);
    if (!q) return setError('Enter a quantity');
    if (type !== 'opening' && !reason.trim()) return setError('A reason is required');
    const delta = type === 'opening' ? q : type === 'manual_adjustment' ? (qty.trim().startsWith('-') ? `-${q}` : q) : `-${q}`;
    setBusy(true);
    try {
      await recordAdjustment({ shopId: shop!.id, memberId: member.id, productId: product.id, type, qtyDelta: delta, reason: reason.trim() || 'Opening stock' });
      void syncNow();
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ErrorBanner message={error} />
      {!product ? (
        <>
          <Field value={search} onChangeText={setSearch} placeholder="Search product" autoFocus />
          <Row style={{ flexWrap: 'wrap' }}>{products.slice(0, 20).map((p) => <Chip key={p.id} label={`${p.name} (${p.stock_qty} ${p.unit})`} onPress={() => setProduct(p)} />)}</Row>
        </>
      ) : (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="heading">{product.name}</T>
            <Button title="Change" size="sm" variant="ghost" onPress={() => setProduct(null)} />
          </Row>
          <T color={colors.textMuted}>Current stock: {product.stock_qty} {product.unit}</T>
          <T variant="label" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>Type</T>
          <Row style={{ flexWrap: 'wrap', marginBottom: spacing.md }}>
            {types.map((t) => <Chip key={t} label={ADJUSTMENT_LABELS[t]} selected={type === t} onPress={() => setType(t)} />)}
          </Row>
          <Field label={`${isIncrease ? 'Quantity' : 'Quantity removed'} (${product.unit})${type === 'manual_adjustment' ? ' — use minus to reduce' : ''}`} value={qty} onChangeText={setQty} keyboardType={type === 'manual_adjustment' ? 'default' : 'decimal-pad'} autoFocus />
          <Field label={type === 'opening' ? 'Note (optional)' : 'Reason (required)'} value={reason} onChangeText={setReason} placeholder={type === 'damage' ? 'e.g. packet torn' : ''} />
          <Button title="Save adjustment" size="lg" onPress={submit} loading={busy} />
          <T variant="caption" color={colors.textMuted}>Every adjustment is a permanent stock movement with your name on it.</T>
        </Card>
      )}
    </Screen>
  );
}
