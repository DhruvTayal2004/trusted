import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch } from 'react-native';
import { parseRupees } from '@/core/money';
import { UNITS, UNIT_LABELS, isLooseUnit, type Unit } from '@/core/units';
import { useMember, useSession } from '@/features/session';
import { listCategories, saveProduct } from '@/lib/repos/products';
import type { Category, Product } from '@/lib/repos/types';
import { Button, Card, Chip, ErrorBanner, Field, MoneyField, Row, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

export function ProductForm({ existing, initialBarcode }: { existing?: Product | null; initialBarcode?: string }) {
  const { shop } = useSession();
  const member = useMember();
  const [cats, setCats] = useState<Category[]>([]);
  const [name, setName] = useState(existing?.name ?? '');
  const [nameHi, setNameHi] = useState(existing?.name_hi ?? '');
  const [aliases, setAliases] = useState(existing?.aliases.join(', ') ?? '');
  const [unit, setUnit] = useState<Unit>(existing?.unit ?? 'pc');
  const [categoryId, setCategoryId] = useState<string | null>(existing?.category_id ?? null);
  const [sell, setSell] = useState(existing ? String(existing.selling_price_paise / 100) : '');
  const [buy, setBuy] = useState(existing?.purchase_price_paise != null ? String(existing.purchase_price_paise / 100) : '');
  const [barcode, setBarcode] = useState(existing?.barcode ?? initialBarcode ?? '');
  const [minStock, setMinStock] = useState(existing?.min_stock_qty ?? '0');
  const [quick, setQuick] = useState(existing?.is_quick ?? false);
  const [active, setActive] = useState(existing?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void listCategories().then(setCats); }, []);

  async function submit() {
    const sellPaise = parseRupees(sell);
    const buyPaise = buy.trim() ? parseRupees(buy) : null;
    if (name.trim().length < 1) return setError('Product name is required');
    if (sellPaise === null || sellPaise < 0) return setError('Enter a valid selling price');
    if (buy.trim() && buyPaise === null) return setError('Enter a valid purchase price');
    if (!/^\d+(\.\d{1,3})?$/.test(minStock.trim() || '0')) return setError('Minimum stock must be a number');
    setBusy(true);
    setError(null);
    try {
      await saveProduct(shop!.id, {
        id: existing?.id, category_id: categoryId, name: name.trim(), name_hi: nameHi.trim() || null,
        aliases: aliases.split(/[,\n]/).map((a) => a.trim().toLowerCase()).filter(Boolean),
        unit, is_loose: isLooseUnit(unit), selling_price_paise: sellPaise, purchase_price_paise: buyPaise, barcode: barcode.trim() || null,
        min_stock_qty: minStock.trim() || '0', is_quick: quick, quick_sort: existing?.quick_sort ?? 0, is_active: active,
      });
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <ErrorBanner message={error} />
      <Field label="Name" value={name} onChangeText={setName} placeholder="Basmati Rice" autoFocus={!existing} />
      <Field label="Hindi / Hinglish name (optional)" value={nameHi} onChangeText={setNameHi} placeholder="चावल / chawal" />
      <Field label="Voice & search aliases (comma separated)" value={aliases} onChangeText={setAliases} placeholder="chawal, rice, chaval" hint="Used by voice orders and search" />
      <T variant="label" style={{ marginBottom: spacing.xs }}>Unit</T>
      <Row style={{ flexWrap: 'wrap', marginBottom: spacing.md }}>
        {UNITS.map((u) => <Chip key={u} label={`${UNIT_LABELS[u].short} · ${UNIT_LABELS[u].hi}`} selected={unit === u} onPress={() => setUnit(u)} />)}
      </Row>
      <MoneyField label={`Selling price per ${unit}`} valueRupees={sell} onChangeRupees={setSell} />
      {member.permissions.can_view_purchase_price ? <MoneyField label={`Purchase price per ${unit} (optional)`} valueRupees={buy} onChangeRupees={setBuy} /> : null}
      <Field label="Barcode (optional)" value={barcode} onChangeText={setBarcode} placeholder="Scan or type" autoCapitalize="none" />
      <Field label={`Minimum stock (${unit}) — alert below this`} value={minStock} onChangeText={setMinStock} keyboardType="decimal-pad" />
      {cats.length ? (
        <>
          <T variant="label" style={{ marginBottom: spacing.xs }}>Category</T>
          <Row style={{ flexWrap: 'wrap', marginBottom: spacing.md }}>
            {cats.map((c) => <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? null : c.id)} />)}
          </Row>
        </>
      ) : null}
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
        <T>Show on quick buttons</T>
        <Switch value={quick} onValueChange={setQuick} trackColor={{ true: colors.primary }} />
      </Row>
      {existing ? (
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
          <T>Active (sellable)</T>
          <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.primary }} />
        </Row>
      ) : null}
      <Button title={existing ? 'Save changes' : 'Add product'} onPress={submit} loading={busy} size="lg" />
    </Card>
  );
}
