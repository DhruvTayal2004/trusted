import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { normaliseQty } from '@/core/units';
import { useMember, useSession } from '@/features/session';
import { listProducts } from '@/lib/repos/products';
import { finaliseCount } from '@/lib/repos/stock';
import type { Product } from '@/lib/repos/types';
import { syncNow } from '@/lib/sync/engine';
import { Button, Card, ErrorBanner, Field, Row, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

/**
 * Physical stock count. Enter counted quantities; untouched products are not adjusted.
 * Differences become `count_adjustment` movements (never silently overwrite the ledger).
 */
export default function StockCountScreen() {
  const { shop } = useSession();
  const member = useMember();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void listProducts({}).then(setProducts); }, []);
  const visible = useMemo(() => products.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.name_hi ?? '').includes(search)), [products, search]);
  const diffs = useMemo(() => Object.entries(counts).map(([id, v]) => {
    const p = products.find((x) => x.id === id);
    if (!p || v.trim() === '') return null;
    const q = normaliseQty(v, p.unit) ?? (v.trim() === '0' ? '0' : null);
    if (q === null) return null;
    return { p, counted: q, diff: Number(q) - Number(p.stock_qty) };
  }).filter(Boolean) as { p: Product; counted: string; diff: number }[], [counts, products]);

  async function submit() {
    if (diffs.length === 0) return setError('Enter at least one counted quantity');
    const changed = diffs.filter((d) => d.diff !== 0);
    Alert.alert('Finalise count?', `${diffs.length} product(s) counted, ${changed.length} differ from system. Differences will be recorded as count adjustments.`, [
      { text: 'Cancel' },
      { text: 'Finalise', onPress: async () => {
        setBusy(true);
        try {
          await finaliseCount({ shopId: shop!.id, memberId: member.id, items: diffs.map((d) => ({ productId: d.p.id, countedQty: d.counted })) });
          void syncNow();
          router.back();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      } },
    ]);
  }

  return (
    <Screen>
      <ErrorBanner message={error} />
      <Card tone="info"><T variant="caption">Count what is physically on the shelf and enter it. Leave blank to skip a product. A difference is a prompt to look for causes — unrecorded sales, spillage, wrong unit — not proof of anything.</T></Card>
      <Field value={search} onChangeText={setSearch} placeholder="Filter products" />
      {visible.map((p) => {
        const d = diffs.find((x) => x.p.id === p.id);
        return (
          <Row key={p.id} style={{ paddingVertical: 4 }}>
            <View style={{ flex: 1 }}><T numberOfLines={1}>{p.name}</T><T variant="caption" color={colors.textMuted}>system {p.stock_qty} {p.unit}</T></View>
            <Field value={counts[p.id] ?? ''} onChangeText={(t) => setCounts({ ...counts, [p.id]: t })} keyboardType="decimal-pad" placeholder="counted" style={{ width: 110, marginBottom: 0 }} />
            <T style={{ width: 70, textAlign: 'right', fontWeight: '700' }} color={!d ? colors.textMuted : d.diff === 0 ? colors.success : colors.danger}>{d ? (d.diff > 0 ? '+' : '') + d.diff.toFixed(3).replace(/\.?0+$/, '') : ''}</T>
          </Row>
        );
      })}
      <Button title={`Finalise count (${diffs.length})`} size="lg" onPress={submit} loading={busy} disabled={diffs.length === 0} style={{ marginTop: 16 }} />
    </Screen>
  );
}
