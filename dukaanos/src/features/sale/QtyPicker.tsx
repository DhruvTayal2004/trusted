import Decimal from 'decimal.js';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { mulPaiseByQty } from '@/core/money';
import { UNIT_LABELS, convertQty, isLooseUnit, normaliseQty } from '@/core/units';
import type { Product } from '@/lib/repos/types';
import { useScale } from '@/lib/scale';
import { Button, Chip, Field, Money, Row, T } from '@/ui';
import { colors, radius, spacing } from '@/ui/theme';

const LOOSE_PRESETS: Record<string, { label: string; qty: string }[]> = {
  kg: [{ label: '100 g', qty: '0.1' }, { label: '250 g', qty: '0.25' }, { label: '500 g', qty: '0.5' }, { label: '1 kg', qty: '1' }, { label: '2 kg', qty: '2' }, { label: '5 kg', qty: '5' }],
  g: [{ label: '50 g', qty: '50' }, { label: '100 g', qty: '100' }, { label: '250 g', qty: '250' }, { label: '500 g', qty: '500' }],
  l: [{ label: '250 ml', qty: '0.25' }, { label: '500 ml', qty: '0.5' }, { label: '1 L', qty: '1' }, { label: '2 L', qty: '2' }],
  ml: [{ label: '100 ml', qty: '100' }, { label: '200 ml', qty: '200' }, { label: '500 ml', qty: '500' }],
};

/**
 * Quantity / price picker for a product line. Supports:
 *  - loose goods: presets, scale reading, "by amount" (₹50 ka chawal → qty), manual
 *  - packaged goods: count with +/- and manual
 *  - price override (shown to everyone; the server audit log records it)
 */
export function QtyPicker({ product, initialQty, initialPrice, onConfirm, onCancel }: {
  product: Product; initialQty?: string; initialPrice?: number; onConfirm: (qty: string, unitPricePaise: number) => void; onCancel: () => void;
}) {
  const loose = isLooseUnit(product.unit);
  const [qty, setQty] = useState(initialQty ?? (loose ? '1' : '1'));
  const [price, setPrice] = useState(String((initialPrice ?? product.selling_price_paise) / 100));
  const [byAmount, setByAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scale = useScale();
  const pricePaise = Math.round(Number(price || '0') * 100);
  const normQty = normaliseQty(qty, product.unit);
  const lineTotal = normQty && Number.isFinite(pricePaise) ? mulPaiseByQty(pricePaise, normQty) : 0;

  function fromAmount(rupees: string) {
    setByAmount(rupees);
    const amt = Number(rupees);
    if (!amt || !pricePaise) return;
    // qty = amount / unit price, 3 dp, rounded down so we never overcharge
    const q = new Decimal(amt * 100).div(pricePaise).toDecimalPlaces(3, Decimal.ROUND_DOWN);
    if (q.gt(0)) setQty(q.toString());
  }

  async function readScale() {
    const r = await scale.read();
    if (!r) return setError('Scale not connected — enter weight manually');
    const q = convertQty(r.grams, 'g', product.unit === 'g' ? 'g' : 'kg');
    setQty(q.toDecimalPlaces(3).toString());
  }

  function confirm() {
    if (!normQty) return setError(loose ? 'Enter a quantity above 0' : 'Enter a whole number');
    if (!Number.isInteger(pricePaise) || pricePaise < 0) return setError('Invalid price');
    onConfirm(normQty, pricePaise);
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T variant="heading" numberOfLines={1}>{product.name}{product.name_hi ? ` · ${product.name_hi}` : ''}</T>
            <T variant="caption" color={colors.textMuted}>Stock: {product.stock_qty} {UNIT_LABELS[product.unit].short}</T>
          </View>
          <Money paise={lineTotal} variant="title" />
        </Row>
        {error ? <T color={colors.danger}>{error}</T> : null}

        {loose ? (
          <>
            <Row style={{ flexWrap: 'wrap', marginTop: spacing.md }}>
              {(LOOSE_PRESETS[product.unit] ?? []).map((p) => <Chip key={p.qty} label={p.label} selected={normQty === p.qty} onPress={() => setQty(p.qty)} />)}
            </Row>
            <Row style={{ marginTop: spacing.md }} align="flex-start">
              <Field label={`Quantity (${UNIT_LABELS[product.unit].short})`} value={qty} onChangeText={(t) => { setQty(t); setByAmount(''); }} keyboardType="decimal-pad" style={{ flex: 1 }} />
              <Field label="…or by ₹ amount" value={byAmount} onChangeText={fromAmount} keyboardType="decimal-pad" placeholder="50" style={{ flex: 1 }} />
            </Row>
            <Button title={scale.connected ? `Read from ${scale.driver.label}` : 'Read scale (not connected — manual entry)'} variant="secondary" size="sm" onPress={readScale} disabled={!scale.connected} />
          </>
        ) : (
          <Row style={{ marginTop: spacing.md, justifyContent: 'center' }} gap={spacing.lg}>
            <Button title="−" size="lg" variant="secondary" onPress={() => setQty(String(Math.max(1, Number(qty) - 1)))} style={{ width: 72 }} />
            <Field value={qty} onChangeText={setQty} keyboardType="number-pad" style={{ width: 100, marginBottom: 0 }} inputStyle={{ textAlign: 'center', fontSize: 28, fontWeight: '700' }} />
            <Button title="+" size="lg" onPress={() => setQty(String(Number(qty || '0') + 1))} style={{ width: 72 }} />
          </Row>
        )}
        <Field label={`Price per ${UNIT_LABELS[product.unit].short} (₹)`} value={price} onChangeText={(t) => setPrice(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" hint={pricePaise !== product.selling_price_paise ? 'Changed from list price — recorded in audit log' : undefined} style={{ marginTop: spacing.md }} />
        <Row>
          <Button title="Add to bill" size="lg" onPress={confirm} style={{ flex: 1 }} />
          <Button title="Cancel" variant="ghost" onPress={onCancel} />
        </Row>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.bg, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: spacing.xxl },
});
