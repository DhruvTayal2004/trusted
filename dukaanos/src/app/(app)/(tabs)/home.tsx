import { Stack, router } from 'expo-router';
import { View } from 'react-native';
import { isManager, visibleActions } from '@/core/permissions';
import { SyncBadge } from '@/features/SyncBadge';
import { useMember, useSession } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { todayLocal } from '@/lib/ids';
import { lowStockProducts } from '@/lib/repos/products';
import { dailySummary } from '@/lib/repos/reports';
import { listSales, pendingUpiPayments } from '@/lib/repos/sales';
import { currentShift, localShiftSummary } from '@/lib/repos/shifts';
import { listOutbox } from '@/lib/sync/outbox';
import { ActionTile, Button, Card, Loading, Money, Pill, Row, Screen, SectionTitle, Stat, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

export default function HomeTab() {
  const member = useMember();
  return isManager(member) ? <OwnerDashboard /> : <EmployeeHome />;
}

// ---------------------------------------------------------------------------
function OwnerDashboard() {
  const { shop } = useSession();
  const q = useQuery(async () => {
    const [summary, rejected, low] = await Promise.all([dailySummary(todayLocal()), listOutbox('rejected', 5), lowStockProducts()]);
    return { summary, rejected, low };
  });
  const s = q.data?.summary;
  return (
    <>
      <Stack.Screen options={{ title: shop?.name ?? 'Dashboard', headerRight: () => <SyncBadge /> }} />
      <Screen refreshing={q.loading} onRefresh={q.refresh}>
        {!s ? <Loading /> : (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="label">Today · {s.date}</T>
              <Pill label={s.source === 'server' ? 'Verified' : 'Local (offline)'} tone={s.source === 'server' ? 'success' : 'warning'} />
            </Row>
            <Card style={{ marginTop: spacing.sm }}>
              <T variant="caption" color={colors.textMuted}>Recorded sales ({s.sales_count} bills)</T>
              <Money paise={s.sales_total_paise} variant="display" />
              <Row style={{ marginTop: spacing.sm }} gap={spacing.lg}>
                <View><T variant="caption" color={colors.cash}>Cash</T><Money paise={s.cash_sales_paise} variant="heading" color={colors.cash} /></View>
                <View><T variant="caption" color={colors.upi}>UPI</T><Money paise={s.upi_sales_paise} variant="heading" color={colors.upi} /></View>
                <View><T variant="caption" color={colors.credit}>Udhaar</T><Money paise={s.credit_sales_paise} variant="heading" color={colors.credit} /></View>
              </Row>
            </Card>

            <Row style={{ flexWrap: 'wrap' }} gap={spacing.sm} align="stretch">
              <Stat label="Khata collected" paise={s.khata_collected_paise} />
              <Stat label="Expenses" paise={s.expenses_paise} onPress={() => router.push('/(app)/expenses')} />
              <Stat label="Customers owe" paise={s.outstanding_customer_paise} onPress={() => router.push('/(app)/(tabs)/khata')} />
              <Stat label="We owe suppliers" paise={s.outstanding_supplier_paise} onPress={() => router.push('/(app)/suppliers')} />
            </Row>

            {s.upi_pending_paise > 0 ? (
              <Card tone="info" onPress={() => router.push('/(app)/upi')}>
                <T>UPI awaiting verification: <Money paise={s.upi_pending_paise} /></T>
                <T variant="caption" color={colors.textMuted}>Tap to mark as received after checking your UPI app</T>
              </Card>
            ) : null}

            {s.closed_shifts.some((c) => c.difference_paise !== 0) ? (
              <Card tone="danger" onPress={() => router.push('/(app)/shift')}>
                <T variant="heading" color={colors.danger}>Cash difference today</T>
                {s.closed_shifts.filter((c) => c.difference_paise !== 0).map((c) => (
                  <Row key={c.shift_id} style={{ justifyContent: 'space-between' }}>
                    <T>{c.member}</T>
                    <Money paise={c.difference_paise} sign color={c.difference_paise < 0 ? colors.danger : colors.success} />
                  </Row>
                ))}
                <T variant="caption" color={colors.textMuted}>A difference is a prompt to check, not a conclusion.</T>
              </Card>
            ) : null}

            {(q.data?.rejected.length ?? 0) > 0 ? (
              <Card tone="danger" onPress={() => router.push('/(app)/sync')}>
                <T color={colors.danger}>{q.data!.rejected.length} record(s) were rejected by the server. Tap to review.</T>
              </Card>
            ) : null}

            {(s.expenses_pending_count > 0) ? (
              <Card tone="warning" onPress={() => router.push('/(app)/approvals')}>
                <T>{s.expenses_pending_count} expense(s) waiting for your approval</T>
              </Card>
            ) : null}

            <SectionTitle right={<Button title="See stock" variant="ghost" size="sm" onPress={() => router.push('/(app)/(tabs)/inventory')} />}>Inventory warnings</SectionTitle>
            {q.data!.low.length === 0 ? <T color={colors.textMuted}>No products below minimum stock.</T> : q.data!.low.slice(0, 5).map((p) => (
              <Row key={p.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
                <T>{p.name}</T>
                <T color={Number(p.stock_qty) < 0 ? colors.danger : colors.warning}>{p.stock_qty} {p.unit} (min {p.min_stock_qty})</T>
              </Row>
            ))}

            <SectionTitle>Employee activity</SectionTitle>
            {s.open_shifts.map((o) => <Row key={o.shift_id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}><T>{o.member}</T><Pill label="On shift" tone="success" /></Row>)}
            {s.by_employee.map((e) => (
              <Row key={e.member} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
                <T>{e.member} · {e.sales_count} bills</T>
                <Money paise={e.sales_paise} />
              </Row>
            ))}
            {s.open_shifts.length === 0 && s.by_employee.length === 0 ? <T color={colors.textMuted}>No activity yet today.</T> : null}

            <SectionTitle>Quick actions</SectionTitle>
            <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between' }} gap={spacing.md}>
              <ActionTile title="New sale" icon="🧾" onPress={() => router.push('/(app)/sale/new')} />
              <ActionTile title="Ask AI" subtitle="Aaj kitni sale hui?" icon="🤖" onPress={() => router.push('/(app)/assistant')} color={colors.info} />
              <ActionTile title="Scan notebook" subtitle="Khata / bills" icon="📷" onPress={() => router.push('/(app)/scanner')} color={colors.accent} />
              <ActionTile title="Reports" icon="📈" onPress={() => router.push('/(app)/reports')} />
            </Row>
          </>
        )}
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------
function EmployeeHome() {
  const member = useMember();
  const { shop } = useSession();
  const actions = visibleActions(member);
  const q = useQuery(async () => {
    const shift = await currentShift(member.id);
    const summary = shift ? await localShiftSummary(shift) : null;
    const upi = await pendingUpiPayments(50);
    const mySales = await listSales({ memberId: member.id, date: todayLocal(), limit: 5 });
    return { shift, summary, upiCount: upi.length, mySales };
  }, [member.id]);
  const shift = q.data?.shift;
  return (
    <>
      <Stack.Screen options={{ title: `${shop?.name ?? ''} · ${member.display_name}`, headerRight: () => <SyncBadge /> }} />
      <Screen refreshing={q.loading} onRefresh={q.refresh}>
        {q.data && !shift ? (
          <Card tone="warning" onPress={() => router.push('/(app)/shift/open')}>
            <T variant="heading">Shift not open</T>
            <T color={colors.textMuted}>Count the cash in the drawer and open your shift first. Sales still work, but cash reconciliation needs an open shift.</T>
            <Button title="Open shift" onPress={() => router.push('/(app)/shift/open')} />
          </Card>
        ) : shift && q.data?.summary ? (
          <Card tone="success" onPress={() => router.push('/(app)/shift/close')}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="label">Your shift · since {new Date(shift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</T>
              <Pill label={`${q.data.summary.salesCount} bills`} tone="success" />
            </Row>
            <Row style={{ marginTop: spacing.sm }} gap={spacing.lg}>
              <View><T variant="caption" color={colors.textMuted}>Sales</T><Money paise={q.data.summary.salesTotal} variant="heading" /></View>
              <View><T variant="caption" color={colors.textMuted}>Cash should be</T><Money paise={q.data.summary.expected} variant="heading" color={colors.cash} /></View>
            </Row>
          </Card>
        ) : null}

        <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between' }} gap={spacing.md}>
          <ActionTile title="New sale" subtitle="Nayi bikri" icon="🧾" onPress={() => router.push('/(app)/sale/new')} />
          <ActionTile title="Voice order" subtitle="Bol ke bill banao" icon="🎤" onPress={() => router.push('/(app)/sale/voice')} color={colors.info} />
          <ActionTile title="Quick products" subtitle="Ek tap mein" icon="⚡" onPress={() => router.push({ pathname: '/(app)/sale/new', params: { quick: '1' } })} color={colors.accent} />
          <ActionTile title="Khata" subtitle="Udhaar / payment" icon="📒" onPress={() => router.push('/(app)/(tabs)/khata')} color={colors.credit} />
          {actions.receiveStock ? <ActionTile title="Receive stock" subtitle="Maal aaya" icon="🚚" onPress={() => router.push('/(app)/purchases/new')} /> : null}
          {actions.expenses ? <ActionTile title="Expense" subtitle="Kharcha" icon="💸" onPress={() => router.push('/(app)/expenses/new')} color={colors.danger} /> : null}
          <ActionTile title={shift ? 'Close shift' : 'Open shift'} subtitle={shift ? 'Cash milao' : 'Shuru karo'} icon="🔒" onPress={() => router.push(shift ? '/(app)/shift/close' : '/(app)/shift/open')} color={colors.textMuted} badge={q.data?.upiCount ? `${q.data.upiCount} UPI` : undefined} />
          <ActionTile title="Scan barcode" icon="📷" onPress={() => router.push('/(app)/sale/scan')} color={colors.textMuted} />
        </Row>

        <SectionTitle>Your last bills</SectionTitle>
        {(q.data?.mySales ?? []).map((s) => (
          <Row key={s.id} style={{ justifyContent: 'space-between', paddingVertical: 8 }}>
            <View style={{ flex: 1 }}><T numberOfLines={1}>{s.items_summary ?? '—'}</T><T variant="caption" color={colors.textMuted}>{s.methods} · {new Date(s.client_created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</T></View>
            <Money paise={s.total_paise} />
          </Row>
        ))}
        {q.data && q.data.mySales.length === 0 ? <T color={colors.textMuted}>No bills yet today.</T> : null}
      </Screen>
    </>
  );
}
