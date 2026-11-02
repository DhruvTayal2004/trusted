import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { formatPaise, mulPaiseByQty, parseRupees } from '@/core/money';
import { formatQty, normaliseQty } from '@/core/units';
import { useMember, useSession } from '@/features/session';
import { newId, todayLocal } from '@/lib/ids';
import { getProduct, listProducts } from '@/lib/repos/products';
import { currentShift } from '@/lib/repos/shifts';
import { receivePurchase, type PurchaseLineInput } from '@/lib/repos/stock';
import { getSupplier, listSuppliers } from '@/lib/repos/suppliers';
import type { Product, Supplier } from '@/lib/repos/types';
import { uploadImage } from '@/lib/storage';
import { syncNow } from '@/lib/sync/engine';
import { Button, Card, Chip, ErrorBanner, Field, Money, MoneyField, Row, Screen, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

type Line = PurchaseLineInput & { id: string; stockBefore: string };

export default function ReceiveStockScreen() {
  const { shop } = useSession();
  const member = useMember();
  const params = useLocalSearchParams<{ supplierId?: string; productId?: string }>();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [editing, setEditing] = useState<{ product: Product; qty: string; cost: string } | null>(null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayLocal());
  const [paid, setPaid] = useState('');
  const [paidMethod, setPaidMethod] = useState<'cash' | 'upi'>('cash');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void listSuppliers().then(setSuppliers); }, []);
  useEffect(() => { void listProducts({ search }).then(setProducts); }, [search]);
  useEffect(() => {
    if (params.supplierId) void getSupplier(params.supplierId).then(setSupplier);
    if (params.productId) void getProduct(params.productId).then((p) => p && startLine(p));
  }, [params.supplierId, params.productId]);

  function startLine(p: Product) {
    setEditing({ product: p, qty: '', cost: p.purchase_price_paise != null ? String(p.purchase_price_paise / 100) : '' });
  }

  function commitLine() {
    if (!editing) return;
    const qty = normaliseQty(editing.qty, editing.product.unit);
    const cost = parseRupees(editing.cost);
    if (!qty) return setError('Enter quantity received');
    if (cost === null || cost < 0) return setError('Enter cost per unit');
    setLines((ls) => [...ls, { id: newId(), productId: editing.product.id, description: editing.product.name, unit: editing.product.unit, qty, unitCostPaise: cost, stockBefore: editing.product.stock_qty, updatePurchasePrice: true }]);
    setEditing(null);
    setError(null);
    setSearch('');
  }

  const total = useMemo(() => lines.reduce((a, l) => a + mulPaiseByQty(l.unitCostPaise, l.qty), 0), [lines]);

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0].uri);
  }

  async function submit() {
    if (lines.length === 0) return setError('Add the items received');
    const paidPaise = parseRupees(paid || '0') ?? 0;
    if (paidPaise > total) return setError('Paid cannot exceed invoice total');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return setError('Date must be YYYY-MM-DD');
    setBusy(true);
    try {
      const imagePath = photo ? await uploadImage('invoices', `${shop!.id}/${Date.now()}.jpg`, photo).catch(() => null) : null;
      const shift = await currentShift(member.id);
      await receivePurchase({ shopId: shop!.id, memberId: member.id, supplierId: supplier?.id ?? null, invoiceNumber: invoiceNo || undefined, invoiceDate, invoiceImagePath: imagePath, lines, paidPaise, paidMethod: paidPaise > 0 ? paidMethod : null, shiftId: shift?.id ?? null });
      void syncNow();
      Alert.alert('Stock received', `${lines.length} item(s) added to stock.${supplier ? ` ${formatPaise(total - paidPaise)} added to ${supplier.name}'s balance.` : ''}`);
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
      <T variant="label">Supplier</T>
      <Row style={{ flexWrap: 'wrap', marginBottom: spacing.md }}>
        <Chip label="No supplier / cash purchase" selected={!supplier} onPress={() => setSupplier(null)} />
        {suppliers.map((s) => <Chip key={s.id} label={s.name} selected={supplier?.id === s.id} onPress={() => setSupplier(s)} />)}
        <Chip label="+ New" onPress={() => router.push('/(app)/suppliers/new')} />
      </Row>

      <T variant="label">Items received</T>
      {lines.map((l) => (
        <Row key={l.id} style={{ paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
          <View style={{ flex: 1 }}><T>{l.description}</T><T variant="caption" color={colors.textMuted}>{formatQty(l.qty, l.unit as never)} @ {formatPaise(l.unitCostPaise)} · stock {l.stockBefore} → {Number(l.stockBefore) + Number(l.qty)}</T></View>
          <Money paise={mulPaiseByQty(l.unitCostPaise, l.qty)} />
          <Button title="✕" size="sm" variant="ghost" onPress={() => setLines(lines.filter((x) => x.id !== l.id))} style={{ width: 36 }} />
        </Row>
      ))}
      {editing ? (
        <Card tone="info">
          <T variant="heading">{editing.product.name}</T>
          <Row align="flex-start">
            <Field label={`Qty (${editing.product.unit})`} value={editing.qty} onChangeText={(t) => setEditing({ ...editing, qty: t })} keyboardType="decimal-pad" autoFocus style={{ flex: 1 }} />
            <Field label={`Cost per ${editing.product.unit} ₹`} value={editing.cost} onChangeText={(t) => setEditing({ ...editing, cost: t.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" style={{ flex: 1 }} />
          </Row>
          {editing.product.purchase_price_paise != null && parseRupees(editing.cost) !== null && parseRupees(editing.cost)! !== editing.product.purchase_price_paise ? (
            <T variant="caption" color={parseRupees(editing.cost)! > editing.product.purchase_price_paise ? colors.danger : colors.success}>
              Last price {formatPaise(editing.product.purchase_price_paise)} → {parseRupees(editing.cost)! > editing.product.purchase_price_paise ? 'costlier' : 'cheaper'} now
            </T>
          ) : null}
          <Row><Button title="Add" onPress={commitLine} style={{ flex: 1 }} /><Button title="Cancel" variant="ghost" onPress={() => setEditing(null)} /></Row>
        </Card>
      ) : (
        <>
          <Field value={search} onChangeText={setSearch} placeholder="Search product to add" style={{ marginTop: spacing.sm }} />
          <Row style={{ flexWrap: 'wrap' }}>
            {products.slice(0, 10).map((p) => <Chip key={p.id} label={`${p.name} (${p.stock_qty} ${p.unit})`} onPress={() => startLine(p)} />)}
          </Row>
        </>
      )}

      <Card style={{ marginTop: spacing.lg }}>
        <Row style={{ justifyContent: 'space-between' }}><T variant="heading">Invoice total</T><Money paise={total} variant="heading" /></Row>
        <Row align="flex-start" style={{ marginTop: spacing.sm }}>
          <Field label="Invoice no." value={invoiceNo} onChangeText={setInvoiceNo} style={{ flex: 1 }} />
          <Field label="Date" value={invoiceDate} onChangeText={setInvoiceDate} placeholder="YYYY-MM-DD" style={{ flex: 1 }} />
        </Row>
        <MoneyField label="Paid now (rest goes to supplier balance)" valueRupees={paid} onChangeRupees={setPaid} />
        {parseRupees(paid || '0') ? (
          <Row style={{ marginBottom: spacing.md }}>
            <Chip label="From cash drawer" selected={paidMethod === 'cash'} onPress={() => setPaidMethod('cash')} />
            <Chip label="UPI / bank" selected={paidMethod === 'upi'} onPress={() => setPaidMethod('upi')} />
          </Row>
        ) : null}
        {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 140, borderRadius: 12, marginBottom: spacing.sm }} /> : null}
        <Button title={photo ? 'Retake invoice photo' : '📷 Invoice photo (optional)'} variant="secondary" onPress={takePhoto} />
        <Button title="Receive stock" size="lg" onPress={submit} loading={busy} disabled={lines.length === 0} />
      </Card>
    </Screen>
  );
}
