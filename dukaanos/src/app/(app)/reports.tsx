import { useState } from 'react';
import { View } from 'react-native';
import { formatPaise } from '@/core/money';
import { useQuery } from '@/features/useQuery';
import { todayLocal } from '@/lib/ids';
import { dailySummary } from '@/lib/repos/reports';
import { supabase } from '@/lib/supabase';
import { Button, Card, Chip, ErrorBanner, Money, Pill, Row, Screen, SectionTitle, Stat, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

function shift(d: string, days: number) { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + days); return x.toISOString().slice(0, 10); }
function startOfWeek(d: string) { const x = new Date(d + 'T00:00:00'); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x.toISOString().slice(0, 10); }

interface RangeReport { from: string; to: string; sales_count: number; sales_total_paise: number; cash_paise: number; upi_paise: number; credit_paise: number; expenses_paise: number; by_day: { date: string; sales_paise: number; count: number }[]; top_products: { product: string; qty: string; paise: number }[] }
interface Anomalies { cash_differences: { date: string; member: string; difference_paise: number }[]; large_discounts: { member: string; discount_paise: number; total_paise: number; at: string }[]; refunds: { member: string; amount_paise: number; reason: string; at: string }[]; stock_adjustments: { product: string; type: string; qty_delta: string; reason: string; member: string | null; at: string }[]; unverified_upi_paise: number }

export default function ReportsScreen() {
  const [tab, setTab] = useState<'day' | 'week' | 'month' | 'unusual'>('day');
  const [date, setDate] = useState(todayLocal());
  const q = useQuery(async () => {
    if (tab === 'day') return { kind: 'day' as const, data: await dailySummary(date) };
    if (tab === 'unusual') { const { data, error } = await supabase.rpc('anomaly_report', { p_days: 7 }); if (error) throw error; return { kind: 'unusual' as const, data: data as Anomalies }; }
    const from = tab === 'week' ? startOfWeek(date) : date.slice(0, 8) + '01';
    const { data, error } = await supabase.rpc('sales_summary_range', { p_from: from, p_to: date });
    if (error) throw error;
    return { kind: 'range' as const, data: data as RangeReport };
  }, [tab, date]);

  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label="Day" selected={tab === 'day'} onPress={() => setTab('day')} />
        <Chip label="Week" selected={tab === 'week'} onPress={() => setTab('week')} />
        <Chip label="Month" selected={tab === 'month'} onPress={() => setTab('month')} />
        <Chip label="Unusual" selected={tab === 'unusual'} onPress={() => setTab('unusual')} color={colors.warning} />
      </Row>
      {tab !== 'unusual' ? (
        <Row style={{ justifyContent: 'space-between', marginVertical: spacing.sm }}>
          <Button title="◂" size="sm" variant="secondary" onPress={() => setDate(shift(date, tab === 'day' ? -1 : tab === 'week' ? -7 : -30))} />
          <T variant="heading">{date}</T>
          <Button title="▸" size="sm" variant="secondary" onPress={() => setDate(shift(date, tab === 'day' ? 1 : tab === 'week' ? 7 : 30))} disabled={date >= todayLocal()} />
        </Row>
      ) : null}
      <ErrorBanner message={q.error ? `${q.error} (week/month/unusual need internet)` : null} onRetry={q.refresh} />

      {q.data?.kind === 'day' ? (() => { const s = q.data.data; return (
        <>
          <Pill label={s.source === 'server' ? 'Verified (server)' : 'Local copy (offline)'} tone={s.source === 'server' ? 'success' : 'warning'} />
          <Row style={{ flexWrap: 'wrap', marginTop: spacing.sm }} gap={spacing.sm} align="stretch">
            <Stat label={`Sales (${s.sales_count})`} paise={s.sales_total_paise} />
            <Stat label="Cash" paise={s.cash_sales_paise} />
            <Stat label="UPI" paise={s.upi_sales_paise} />
            <Stat label="Udhaar given" paise={s.credit_sales_paise} />
            <Stat label="Khata collected" paise={s.khata_collected_paise} />
            <Stat label="Expenses" paise={s.expenses_paise} tone={s.expenses_paise ? 'warning' : 'default'} />
            <Stat label="Refunds" paise={s.refunds_paise} />
            <Stat label="Purchases" paise={s.purchases_paise} />
            <Stat label="Paid to suppliers" paise={s.supplier_paid_paise} />
            <Stat label="UPI unverified" paise={s.upi_pending_paise} tone={s.upi_pending_paise ? 'info' : 'default'} />
          </Row>
          <SectionTitle>Shifts</SectionTitle>
          {s.closed_shifts.map((c) => <Row key={c.shift_id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}><T>{c.member} · expected {formatPaise(c.expected_paise)} counted {formatPaise(c.counted_paise)}</T><Money paise={c.difference_paise} sign color={c.difference_paise === 0 ? colors.success : colors.danger} /></Row>)}
          {s.closed_shifts.length === 0 ? <T color={colors.textMuted}>No closed shifts.</T> : null}
          <SectionTitle>By employee</SectionTitle>
          {s.by_employee.map((e) => <Row key={e.member} style={{ justifyContent: 'space-between', paddingVertical: 6 }}><T>{e.member} · {e.sales_count} bills</T><Money paise={e.sales_paise} /></Row>)}
        </>
      ); })() : null}

      {q.data?.kind === 'range' ? (() => { const r = q.data.data; return (
        <>
          <T variant="caption" color={colors.textMuted}>{r.from} → {r.to}</T>
          <Row style={{ flexWrap: 'wrap', marginTop: spacing.sm }} gap={spacing.sm} align="stretch">
            <Stat label={`Sales (${r.sales_count})`} paise={r.sales_total_paise} />
            <Stat label="Cash" paise={r.cash_paise} />
            <Stat label="UPI" paise={r.upi_paise} />
            <Stat label="Udhaar" paise={r.credit_paise} />
            <Stat label="Expenses" paise={r.expenses_paise} />
          </Row>
          <SectionTitle>Per day</SectionTitle>
          {r.by_day.map((d) => { const max = Math.max(...r.by_day.map((x) => x.sales_paise), 1); return (
            <Row key={d.date} style={{ paddingVertical: 4 }}>
              <T variant="caption" style={{ width: 84 }}>{d.date.slice(5)}</T>
              <View style={{ flex: 1, height: 14, backgroundColor: colors.surfaceAlt, borderRadius: 7 }}><View style={{ width: `${(d.sales_paise / max) * 100}%`, height: 14, backgroundColor: colors.primary, borderRadius: 7 }} /></View>
              <Money paise={d.sales_paise} variant="caption" style={{ width: 80, textAlign: 'right' }} />
            </Row>
          ); })}
          <SectionTitle>Top products</SectionTitle>
          {r.top_products.map((p, i) => <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 4 }}><T>{p.product} × {p.qty}</T><Money paise={p.paise} /></Row>)}
        </>
      ); })() : null}

      {q.data?.kind === 'unusual' ? (() => { const a = q.data.data; return (
        <>
          <Card tone="info"><T variant="caption">Last 7 days. These are observations to check, not conclusions about any employee.</T></Card>
          <SectionTitle>Cash differences</SectionTitle>
          {a.cash_differences.map((c, i) => <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 4 }}><T>{c.date} · {c.member}</T><Money paise={c.difference_paise} sign color={colors.danger} /></Row>)}
          {!a.cash_differences.length ? <T color={colors.textMuted}>None</T> : null}
          <SectionTitle>Large discounts (≥10%)</SectionTitle>
          {a.large_discounts.map((d, i) => <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 4 }}><T>{new Date(d.at).toLocaleDateString()} · {d.member} · bill {formatPaise(d.total_paise)}</T><Money paise={d.discount_paise} color={colors.warning} /></Row>)}
          {!a.large_discounts.length ? <T color={colors.textMuted}>None</T> : null}
          <SectionTitle>Refunds</SectionTitle>
          {a.refunds.map((r, i) => <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 4 }}><T style={{ flex: 1 }} numberOfLines={1}>{r.member} · {r.reason}</T><Money paise={r.amount_paise} /></Row>)}
          {!a.refunds.length ? <T color={colors.textMuted}>None</T> : null}
          <SectionTitle>Stock adjustments</SectionTitle>
          {a.stock_adjustments.map((s, i) => <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 4 }}><T style={{ flex: 1 }} numberOfLines={1}>{s.product} · {s.type} · {s.member ?? ''} · {s.reason}</T><T color={s.qty_delta.startsWith('-') ? colors.danger : colors.success}>{s.qty_delta}</T></Row>)}
          {!a.stock_adjustments.length ? <T color={colors.textMuted}>None</T> : null}
          <SectionTitle>Unverified UPI</SectionTitle>
          <Money paise={a.unverified_upi_paise} variant="heading" color={colors.upi} />
        </>
      ); })() : null}
    </Screen>
  );
}
