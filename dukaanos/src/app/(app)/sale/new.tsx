import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { computeTotals, validatePaymentSplit, type CartPaymentPart } from '@/core/cart';
import { formatPaise, parseRupees } from '@/core/money';
import { canApplyDiscount } from '@/core/permissions';
import { formatQty } from '@/core/units';
import { CustomerPicker } from '@/features/sale/CustomerPicker';
import { QtyPicker } from '@/features/sale/QtyPicker';
import { addProductLine, cartStore, clearCart, holdCart, removeLine, resumeHeld, updateLine } from '@/features/sale/cartStore';
import { useMember, useSession } from '@/features/session';
import { newId } from '@/lib/ids';
import { getCustomer } from '@/lib/repos/customers';
import { getProduct, listProducts } from '@/lib/repos/products';
import { createSale } from '@/lib/repos/sales';
import { currentShift } from '@/lib/repos/shifts';
import { syncNow } from '@/lib/sync/engine';
import type { Product } from '@/lib/repos/types';
import { Button, Card, Chip, Field, Money, Pill, Row, Screen, T } from '@/ui';
import { colors, radius, spacing, touch } from '@/ui/theme';

export default function NewSaleScreen() {
  const { shop } = useSession();
  const member = useMember();
  const params = useLocalSearchParams<{ productId?: string; customerId?: string; quick?: string }>();
  const cart = cartStore.use();
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [stage, setStage] = useState<'items' | 'pay'>('items');
  const [payMode, setPayMode] = useState<'cash' | 'upi' | 'credit' | 'split'>('cash');
  const [splitCash, setSplitCash] = useState('');
  const [splitUpi, setSplitUpi] = useState('');
  const [upiRef, setUpiRef] = useState('');
  const [discount, setDiscount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ total: number; id: string } | null>(null);

  useEffect(() => { void listProducts({ search, quickOnly: !search && params.quick === '1' }).then(setProducts); }, [search, params.quick]);
  useEffect(() => {
    if (params.productId) void getProduct(params.productId).then((p) => p && setPicking(p));
    if (params.customerId) void getCustomer(params.customerId).then((c) => c && cartStore.set({ customer: c }));
  }, [params.productId, params.customerId]);

  const totals = useMemo(() => {
    try { return computeTotals(cart.lines, cart.discountPaise); } catch { return computeTotals(cart.lines, 0); }
  }, [cart.lines, cart.discountPaise]);

  const payments: CartPaymentPart[] = useMemo(() => {
    const t = totals.totalPaise;
    if (payMode === 'split') {
      const c = parseRupees(splitCash) ?? 0;
      const u = parseRupees(splitUpi) ?? 0;
      const rest = t - c - u;
      const parts: CartPaymentPart[] = [];
      if (c > 0) parts.push({ id: 'cash', method: 'cash', amountPaise: c });
      if (u > 0) parts.push({ id: 'upi', method: 'upi', amountPaise: u, upiReference: upiRef || undefined });
      if (rest > 0) parts.push({ id: 'credit', method: 'credit', amountPaise: rest });
      return parts;
    }
    return t > 0 ? [{ id: payMode, method: payMode, amountPaise: t, upiReference: payMode === 'upi' ? upiRef || undefined : undefined }] : [];
  }, [payMode, splitCash, splitUpi, upiRef, totals.totalPaise]);

  const split = validatePaymentSplit(totals.totalPaise, payments, cart.customer?.id ?? null);
  const discountCheck = canApplyDiscount(member, totals.subtotalPaise, cart.discountPaise);

  function applyDiscount(text: string) {
    setDiscount(text);
    const p = parseRupees(text) ?? 0;
    cartStore.set({ discountPaise: Math.max(0, Math.min(p, totals.subtotalPaise)) });
  }

  async function confirm() {
    if (cart.lines.length === 0) return setError('Add at least one item');
    if (!split.ok) return setError(split.error ?? 'Check payment');
    if (!discountCheck.ok) return setError(discountCheck.reason ?? 'Discount not allowed');
    setBusy(true);
    setError(null);
    try {
      const shift = await currentShift(member.id);
      const sale = await createSale({
        shopId: shop!.id, memberId: member.id, shiftId: shift?.id ?? null, lines: cart.lines, discountPaise: cart.discountPaise, discountReason: cart.discountReason || undefined,
        payments: payments.map((p) => ({ ...p, id: newId() })), customerId: cart.customer?.id ?? null, note: cart.note || undefined, source: cart.source,
      });
      setDone({ total: sale.total_paise, id: sale.id });
      clearCart();
      setStage('items'); setPayMode('cash'); setSplitCash(''); setSplitUpi(''); setUpiRef(''); setDiscount('');
      void syncNow();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Sale recorded' }} />
        <Card tone="success" style={{ alignItems: 'center', paddingVertical: 40 }}>
          <T style={{ fontSize: 56 }}>✅</T>
          <Money paise={done.total} variant="display" color={colors.success} />
          <T color={colors.textMuted}>Saved on this phone · syncing to server</T>
        </Card>
        <Button title="Next sale" size="lg" icon="🧾" onPress={() => setDone(null)} />
        <Button title="View bill" variant="secondary" onPress={() => router.replace({ pathname: '/(app)/sale/[id]', params: { id: done.id } })} />
        <Button title="Home" variant="ghost" onPress={() => router.replace('/(app)/(tabs)/home')} />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: stage === 'items' ? 'New sale' : 'Payment', headerRight: () => (
        cart.held.length ? <Button title={`Held (${cart.held.length})`} variant="ghost" size="sm" onPress={() => Alert.alert('Resume ticket', undefined, cart.held.map((h) => ({ text: h.label, onPress: () => resumeHeld(h.id) })).concat([{ text: 'Cancel', onPress: () => undefined }]))} /> : null
      ) }} />
      <Screen scroll={false} padded={false}>
        {/* Sticky total bar */}
        <Pressable onPress={() => cart.lines.length && setStage(stage === 'items' ? 'pay' : 'items')} style={styles.totalBar}>
          <View>
            <T variant="caption" color="rgba(255,255,255,0.8)">{cart.lines.length} item(s){cart.customer ? ` · ${cart.customer.name}` : ''}</T>
            <Money paise={totals.totalPaise} variant="display" color={colors.textOnPrimary} />
          </View>
          <T variant="heading" color={colors.textOnPrimary}>{stage === 'items' ? (cart.lines.length ? 'Pay ▸' : '') : '◂ Items'}</T>
        </Pressable>

        {stage === 'items' ? (
          <Screen padded>
            <Row>
              <Field value={search} onChangeText={setSearch} placeholder="Search / chawal / barcode" style={{ flex: 1, marginBottom: 0 }} autoCapitalize="none" />
              <Button title="📷" variant="secondary" onPress={() => router.push('/(app)/sale/scan')} style={{ width: 56 }} />
              <Button title="🎤" variant="secondary" onPress={() => router.push('/(app)/sale/voice')} style={{ width: 56 }} />
            </Row>
            <Row style={{ flexWrap: 'wrap', marginTop: spacing.md }} gap={spacing.sm}>
              {products.slice(0, search ? 20 : 12).map((p) => (
                <Pressable key={p.id} onPress={() => (p.is_loose ? setPicking(p) : addProductLine(p, '1', p.selling_price_paise, 'quick'))} onLongPress={() => setPicking(p)} style={({ pressed }) => [styles.quick, pressed && { opacity: 0.7 }, Number(p.stock_qty) <= 0 && { borderColor: colors.warning }]}>
                  <T style={{ fontWeight: '700' }} numberOfLines={2} center>{p.name_hi ?? p.name}</T>
                  <T variant="caption" color={colors.textMuted}>{formatPaise(p.selling_price_paise)}/{p.unit}</T>
                </Pressable>
              ))}
              {products.length === 0 ? <T color={colors.textMuted}>{search ? 'No match. Long-press nothing — add it as a product from Stock tab.' : 'Mark products as "quick" to show them here.'}</T> : null}
            </Row>
            <T variant="caption" color={colors.textMuted} style={{ marginTop: 4 }}>Tap adds 1 · long-press to set weight/qty/price</T>

            <T variant="label" style={{ marginTop: spacing.lg }}>Bill</T>
            {cart.lines.map((l) => (
              <Row key={l.id} style={styles.line}>
                <Pressable style={{ flex: 1 }} onPress={() => setEditingLine(l.id)}>
                  <T numberOfLines={1}>{l.description}</T>
                  <T variant="caption" color={colors.textMuted}>{formatQty(l.qty, l.unit)} × {formatPaise(l.unitPricePaise)}</T>
                </Pressable>
                {!['kg', 'g', 'l', 'ml'].includes(l.unit) ? (
                  <Row gap={4}>
                    <Button title="−" size="sm" variant="secondary" onPress={() => (Number(l.qty) <= 1 ? removeLine(l.id) : updateLine(l.id, { qty: String(Number(l.qty) - 1) }))} style={{ width: 40 }} />
                    <Button title="+" size="sm" variant="secondary" onPress={() => updateLine(l.id, { qty: String(Number(l.qty) + 1) })} style={{ width: 40 }} />
                  </Row>
                ) : null}
                <Money paise={totals.lines.find((x) => x.id === l.id)?.lineTotalPaise ?? 0} style={{ minWidth: 72, textAlign: 'right' }} />
                <Button title="✕" size="sm" variant="ghost" onPress={() => removeLine(l.id)} style={{ width: 36 }} />
              </Row>
            ))}
            {cart.lines.length === 0 ? <T color={colors.textMuted}>Nothing added yet.</T> : null}
            {cart.lines.length ? (
              <Row style={{ marginTop: spacing.md }}>
                <Button title="Pay ▸" size="lg" onPress={() => setStage('pay')} style={{ flex: 1 }} />
                <Button title="Hold" variant="secondary" onPress={() => holdCart(`Ticket ${cart.held.length + 1} · ${formatPaise(totals.totalPaise)}`)} />
                <Button title="Clear" variant="ghost" onPress={() => Alert.alert('Clear bill?', undefined, [{ text: 'Cancel' }, { text: 'Clear', style: 'destructive', onPress: clearCart }])} />
              </Row>
            ) : null}
          </Screen>
        ) : (
          <Screen padded>
            {error ? <Card tone="danger"><T color={colors.danger}>{error}</T></Card> : null}
            <Row style={{ justifyContent: 'space-between' }}><T>Subtotal</T><Money paise={totals.subtotalPaise} /></Row>
            {member.permissions.can_discount || member.role !== 'employee' ? (
              <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm }} align="flex-start">
                <T style={{ paddingTop: 12 }}>Discount</T>
                <Row style={{ flex: 1, justifyContent: 'flex-end' }} align="flex-start">
                  <Field value={discount} onChangeText={applyDiscount} keyboardType="decimal-pad" placeholder="₹0" style={{ width: 100, marginBottom: 0 }} error={!discountCheck.ok ? discountCheck.reason : null} />
                  {cart.discountPaise > 0 ? <Field value={cart.discountReason} onChangeText={(t) => cartStore.set({ discountReason: t })} placeholder="reason" style={{ width: 120, marginBottom: 0 }} /> : null}
                </Row>
              </Row>
            ) : null}
            <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm }}><T variant="heading">Total</T><Money paise={totals.totalPaise} variant="heading" /></Row>

            <T variant="label" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>Payment</T>
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip label="💵 Cash" selected={payMode === 'cash'} onPress={() => setPayMode('cash')} color={colors.cash} />
              <Chip label="📱 UPI" selected={payMode === 'upi'} onPress={() => setPayMode('upi')} color={colors.upi} />
              <Chip label="📒 Udhaar" selected={payMode === 'credit'} onPress={() => { setPayMode('credit'); if (!cart.customer) setShowCustomer(true); }} color={colors.credit} />
              <Chip label="Split" selected={payMode === 'split'} onPress={() => setPayMode('split')} />
            </Row>
            {payMode === 'upi' || payMode === 'split' ? <Field label="UPI reference / last 4 digits (optional)" value={upiRef} onChangeText={setUpiRef} style={{ marginTop: spacing.md }} hint="UPI is recorded as 'pending verification' until confirmed in your UPI app" /> : null}
            {payMode === 'split' ? (
              <Row style={{ marginTop: spacing.md }} align="flex-start">
                <Field label="Cash ₹" value={splitCash} onChangeText={setSplitCash} keyboardType="decimal-pad" style={{ flex: 1 }} />
                <Field label="UPI ₹" value={splitUpi} onChangeText={setSplitUpi} keyboardType="decimal-pad" style={{ flex: 1 }} />
                <View style={{ flex: 1, paddingTop: 22 }}><T variant="caption" color={colors.textMuted}>Udhaar</T><Money paise={Math.max(0, totals.totalPaise - (parseRupees(splitCash) ?? 0) - (parseRupees(splitUpi) ?? 0))} color={colors.credit} /></View>
              </Row>
            ) : null}

            <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
              <T>Customer</T>
              <Row>
                {cart.customer ? <Pill label={`${cart.customer.name} · owes ${formatPaise(cart.customer.balance_paise)}`} tone="warning" /> : <T color={colors.textMuted}>Walk-in</T>}
                <Button title={cart.customer ? 'Change' : 'Select'} size="sm" variant="ghost" onPress={() => setShowCustomer(true)} />
                {cart.customer ? <Button title="✕" size="sm" variant="ghost" onPress={() => cartStore.set({ customer: null })} /> : null}
              </Row>
            </Row>
            {payments.some((p) => p.method === 'credit') && !cart.customer ? <T color={colors.danger}>Udhaar needs a customer.</T> : null}
            {!split.ok && payMode === 'split' ? <T color={colors.danger}>{split.error}</T> : null}

            <Button title={`Confirm ${formatPaise(totals.totalPaise)}`} size="lg" onPress={confirm} loading={busy} disabled={!split.ok || !discountCheck.ok} style={{ marginTop: spacing.lg }} />
            <Button title="◂ Back to items" variant="ghost" onPress={() => setStage('items')} />
          </Screen>
        )}
      </Screen>

      {picking ? <QtyPicker product={picking} onCancel={() => setPicking(null)} onConfirm={(qty, price) => { addProductLine(picking, qty, price, 'manual'); setPicking(null); }} /> : null}
      {editingLine ? <LineEditor lineId={editingLine} onClose={() => setEditingLine(null)} /> : null}
      {showCustomer ? <CustomerPicker onCancel={() => setShowCustomer(false)} onSelect={(c) => { cartStore.set({ customer: c }); setShowCustomer(false); }} /> : null}
    </>
  );
}

function LineEditor({ lineId, onClose }: { lineId: string; onClose: () => void }) {
  const line = cartStore.use((s) => s.lines.find((l) => l.id === lineId));
  const [product, setProduct] = useState<Product | null>(null);
  useEffect(() => { if (line?.productId) void getProduct(line.productId).then(setProduct); }, [line?.productId]);
  if (!line) return null;
  const fake: Product = product ?? { id: '', shop_id: '', category_id: null, name: line.description, name_hi: null, aliases: [], unit: line.unit, is_loose: ['kg', 'g', 'l', 'ml'].includes(line.unit), selling_price_paise: line.unitPricePaise, purchase_price_paise: null, barcode: null, min_stock_qty: '0', stock_qty: '—', is_quick: false, quick_sort: 0, is_active: true, updated_at: '' };
  return <QtyPicker product={fake} initialQty={line.qty} initialPrice={line.unitPricePaise} onCancel={onClose} onConfirm={(qty, price) => { updateLine(lineId, { qty, unitPricePaise: price }); onClose(); }} />;
}

const styles = StyleSheet.create({
  totalBar: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quick: { width: '31%', minHeight: touch.big + 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', padding: spacing.sm },
  line: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
