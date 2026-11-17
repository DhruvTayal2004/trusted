import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { formatPaise, parseRupees } from '@/core/money';
import { isPossibleDuplicate, suggestParties } from '@/core/notebook/dedupe';
import { useSession } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { listCustomers, saveCustomer } from '@/lib/repos/customers';
import { batchDetail, existingLedgerFor, extractPage, importEntries, updateEntry, type Scan, type ScanEntry } from '@/lib/repos/scanner';
import { listSuppliers, saveSupplier } from '@/lib/repos/suppliers';
import { signedImageUrl } from '@/lib/storage';
import { Button, Card, Chip, ErrorBanner, Field, Loading, Pill, Row, Screen, T } from '@/ui';
import { colors, radius, spacing } from '@/ui/theme';

const FLAG_LABEL: Record<string, string> = { unreadable_amount: 'amount unreadable', unreadable_name: 'name unreadable', date_missing: 'no date', date_uncertain: 'date uncertain', direction_uncertain: 'udhaar/jama unclear', struck_through: 'struck through', possible_total_row: 'looks like a total row', possible_duplicate: 'possible duplicate' };

type Party = { id: string; name: string };

/**
 * Human verification of extracted notebook rows. Low-confidence rows must be edited or explicitly
 * confirmed; party must be matched to a real customer/supplier; totals rows can't be approved.
 */
export default function ReviewScreen() {
  const { batch } = useLocalSearchParams<{ batch: string }>();
  const { shop } = useSession();
  const q = useQuery(() => batchDetail(batch), [batch]);
  const [parties, setParties] = useState<Party[]>([]);
  const [editing, setEditing] = useState<ScanEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ party_id: string; amount_paise: number; entry_date: string }[]>([]);
  const kind = q.data?.scans[0]?.kind;
  const partyKind = kind === 'customer_khata' ? 'customer' : kind === 'supplier_khata' || kind === 'purchases' ? 'supplier' : null;

  useEffect(() => {
    if (!partyKind) return;
    void (partyKind === 'customer' ? listCustomers() : listSuppliers()).then((rows) => setParties(rows.map((r) => ({ id: r.id, name: r.name }))));
  }, [partyKind]);
  useEffect(() => {
    if (!q.data || !kind || !partyKind) return;
    const ids = [...new Set(q.data.entries.map((e) => e.party_id_final).filter(Boolean))] as string[];
    void existingLedgerFor(kind, ids).then(setExisting);
  }, [q.data, kind, partyKind]);

  const entries = q.data?.entries ?? [];
  const pending = entries.filter((e) => e.status === 'pending');
  const approved = entries.filter((e) => e.status === 'approved');

  async function approve(e: ScanEntry) {
    const amount = e.amount_paise_final ?? e.amount_paise;
    const date = e.entry_date_final ?? e.entry_date;
    const dir = e.direction_final ?? (e.direction === 'unknown' ? null : e.direction);
    const problems: string[] = [];
    if (!amount) problems.push('amount');
    if (!date) problems.push('date');
    if (partyKind && !e.party_id_final) problems.push(partyKind);
    if (partyKind && !dir) problems.push('udhaar/jama');
    if (e.flags.includes('possible_total_row') && !e.description_final) problems.push('confirm this is not a total row (edit description)');
    if (problems.length) { setEditing(e); setError(`Fix before approving: ${problems.join(', ')}`); return; }
    if (e.confidence < 0.6 && e.amount_paise_final == null && e.party_name_final == null) { setEditing(e); setError('Low confidence — open the row, check against the page image, then save.'); return; }
    await updateEntry(e.id, { status: 'approved', amount_paise_final: amount, entry_date_final: date, direction_final: dir, party_id_final: e.party_id_final });
    await q.refresh();
  }

  async function importApproved() {
    if (!approved.length) return;
    Alert.alert('Import to ledger?', `${approved.length} approved row(s) will be added as notebook-import entries. Each one links back to its page.`, [
      { text: 'Cancel' },
      { text: 'Import', onPress: async () => {
        setBusy(true);
        try {
          const res = await importEntries(approved.map((a) => a.id));
          const failed = res.filter((r) => r.error);
          await q.refresh();
          Alert.alert('Done', `${res.length - failed.length} imported${failed.length ? `, ${failed.length} failed: ${failed.map((f) => f.error).join('; ')}` : ''}`);
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      } },
    ]);
  }

  async function openPage(scan: Scan) {
    const url = await signedImageUrl('notebook-pages', scan.image_path);
    setPageUrl(url);
  }

  if (!q.data) return <Loading label="Loading batch…" />;
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Stack.Screen options={{ title: `Review · ${q.data.scans.length} page(s)` }} />
      <ErrorBanner message={error ?? q.error} />
      <Row style={{ flexWrap: 'wrap' }}>
        {q.data.scans.map((s) => (
          <Chip key={s.id} label={`Page ${s.page_number} · ${s.status}${s.status === 'failed' ? ' ⚠' : ''}`} onPress={() => (s.status === 'failed' || s.status === 'uploaded' ? Alert.alert('Page ' + s.page_number, s.error ?? 'Not processed yet', [{ text: 'Close' }, { text: 'Retry AI', onPress: () => void extractPage(s.id).then(q.refresh) }]) : void openPage(s))} color={s.status === 'failed' ? colors.danger : colors.primary} />
        ))}
      </Row>
      {q.data.scans.some((s) => s.page_notes) ? <Card tone="info"><T variant="caption">{q.data.scans.map((s) => s.page_notes).filter(Boolean).join(' · ')}</T></Card> : null}
      <Row style={{ justifyContent: 'space-between', marginVertical: spacing.sm }}>
        <T variant="label">{pending.length} to review · {approved.length} approved</T>
        <Button title={`Import ${approved.length}`} size="sm" variant="accent" onPress={importApproved} disabled={!approved.length} loading={busy} />
      </Row>

      {entries.map((e) => {
        const amount = e.amount_paise_final ?? e.amount_paise;
        const name = e.party_name_final ?? e.party_name;
        const date = e.entry_date_final ?? e.entry_date;
        const dir = e.direction_final ?? e.direction;
        const dup = isPossibleDuplicate({ party_id: e.party_id_final, amount_paise: amount, entry_date: date }, existing);
        const low = e.confidence < 0.6;
        return (
          <Pressable key={e.id} onPress={() => e.status !== 'imported' && setEditing(e)} style={[styles.row, e.status === 'approved' && { borderColor: colors.success }, e.status === 'rejected' && { opacity: 0.45 }, low && e.status === 'pending' && { borderColor: colors.warning }]}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <T numberOfLines={1} style={{ fontWeight: '700' }}>{name ?? <T color={colors.danger}>name?</T>}{e.party_id_final ? ' ✓' : partyKind ? <T variant="caption" color={colors.warning}> (not matched)</T> : null}</T>
                <T variant="caption" color={colors.textMuted} numberOfLines={1}>{date ?? 'no date'} · {e.description_final ?? e.description ?? ''}</T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T style={{ fontWeight: '700' }} color={amount == null ? colors.danger : dir === 'credit' ? colors.success : colors.credit}>{amount == null ? '?' : formatPaise(amount)}</T>
                <T variant="caption" color={colors.textMuted}>{dir === 'credit' ? 'jama' : dir === 'debit' ? 'udhaar' : '?'} · {Math.round(e.confidence * 100)}%</T>
              </View>
            </Row>
            <Row style={{ flexWrap: 'wrap', marginTop: 4 }} gap={4}>
              {e.status !== 'pending' ? <Pill label={e.status} tone={e.status === 'approved' || e.status === 'imported' ? 'success' : 'muted'} /> : null}
              {low ? <Pill label="low confidence" tone="warning" /> : null}
              {dup ? <Pill label="possible duplicate in ledger" tone="danger" /> : null}
              {e.flags.map((f) => <Pill key={f} label={FLAG_LABEL[f] ?? f} tone={f === 'possible_total_row' || f === 'struck_through' ? 'danger' : 'warning'} />)}
            </Row>
            {e.status === 'pending' ? (
              <Row style={{ marginTop: 6 }}>
                <Button title="Approve" size="sm" onPress={() => void approve(e)} style={{ flex: 1 }} />
                <Button title="Edit" size="sm" variant="secondary" onPress={() => setEditing(e)} />
                <Button title="Skip" size="sm" variant="ghost" onPress={() => void updateEntry(e.id, { status: 'rejected' }).then(q.refresh)} />
              </Row>
            ) : e.status === 'approved' ? <Button title="Un-approve" size="sm" variant="ghost" onPress={() => void updateEntry(e.id, { status: 'pending' }).then(q.refresh)} /> : null}
          </Pressable>
        );
      })}
      {entries.length === 0 ? <T color={colors.textMuted}>No rows extracted. If the page failed, tap it above to retry.</T> : null}
      <T variant="caption" color={colors.textMuted} style={{ marginTop: spacing.lg }}>Opening balances are set separately on each customer, so historical rows and the starting total never get mixed.</T>

      {editing ? <EntryEditor entry={editing} parties={parties} partyKind={partyKind} shopId={shop!.id} onClose={() => { setEditing(null); setError(null); }} onSaved={async () => { setEditing(null); setError(null); await q.refresh(); }} onAddParty={(p) => setParties((ps) => [...ps, p])} /> : null}
      {pageUrl ? (
        <Modal onRequestClose={() => setPageUrl(null)}>
          <ScrollView maximumZoomScale={5} contentContainerStyle={{ flexGrow: 1 }}><Image source={{ uri: pageUrl }} style={{ width: '100%', aspectRatio: 0.75 }} resizeMode="contain" /></ScrollView>
          <Button title="Close" onPress={() => setPageUrl(null)} />
        </Modal>
      ) : null}
    </Screen>
  );
}

function EntryEditor({ entry, parties, partyKind, shopId, onClose, onSaved, onAddParty }: { entry: ScanEntry; parties: Party[]; partyKind: 'customer' | 'supplier' | null; shopId: string; onClose: () => void; onSaved: () => Promise<void>; onAddParty: (p: Party) => void }) {
  const [name, setName] = useState(entry.party_name_final ?? entry.party_name ?? '');
  const [partyId, setPartyId] = useState<string | null>(entry.party_id_final);
  const [date, setDate] = useState(entry.entry_date_final ?? entry.entry_date ?? '');
  const [amount, setAmount] = useState(entry.amount_paise_final != null ? String(entry.amount_paise_final / 100) : entry.amount_paise != null ? String(entry.amount_paise / 100) : '');
  const [dir, setDir] = useState<'debit' | 'credit' | null>(entry.direction_final ?? (entry.direction === 'unknown' ? null : entry.direction));
  const [desc, setDesc] = useState(entry.description_final ?? entry.description ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const suggestions = useMemo(() => suggestParties(name, parties), [name, parties]);

  async function save(approve: boolean) {
    const paise = parseRupees(amount);
    if (approve) {
      if (!paise || paise <= 0) return setErr('Amount required');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr('Date must be YYYY-MM-DD (from the page; do not guess)');
      if (partyKind && !partyId) return setErr(`Match or create the ${partyKind}`);
      if (partyKind && !dir) return setErr('Choose udhaar (owes more) or jama (paid)');
    }
    setBusy(true);
    try {
      await updateEntry(entry.id, { party_name_final: name || null, party_id_final: partyId, entry_date_final: date || null, amount_paise_final: paise ?? null, direction_final: dir, description_final: desc || null, status: approve ? 'approved' : 'pending' });
      await onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function createParty() {
    if (name.trim().length < 2) return setErr('Enter a name first');
    setBusy(true);
    try {
      const p = partyKind === 'customer' ? await saveCustomer(shopId, { name }) : await saveSupplier(shopId, { name });
      onAddParty({ id: p.id, name: p.name });
      setPartyId(p.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <ScrollView style={styles.sheet} keyboardShouldPersistTaps="handled">
        <T variant="heading">Row {entry.row_index + 1} · AI read: {entry.party_name ?? '—'} {entry.amount_paise != null ? formatPaise(entry.amount_paise) : '?'} {entry.entry_date ?? ''}</T>
        {err ? <T color={colors.danger}>{err}</T> : null}
        {partyKind ? (
          <>
            <Field label={`${partyKind} name as written`} value={name} onChangeText={(t) => { setName(t); setPartyId(null); }} />
            <Row style={{ flexWrap: 'wrap', marginBottom: spacing.md }}>
              {suggestions.map((s) => <Chip key={s.party.id} label={`${s.party.name} (${Math.round(s.score * 100)}%)`} selected={partyId === s.party.id} onPress={() => setPartyId(s.party.id)} />)}
              {partyId && !suggestions.some((s) => s.party.id === partyId) ? <Chip label={parties.find((p) => p.id === partyId)?.name ?? 'matched'} selected /> : null}
              <Chip label={`+ Create ${partyKind} "${name.trim()}"`} onPress={createParty} />
            </Row>
          </>
        ) : null}
        <Row align="flex-start">
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-10-01" style={{ flex: 1 }} />
          <Field label="Amount ₹" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" style={{ flex: 1 }} />
        </Row>
        {partyKind ? (
          <Row style={{ marginBottom: spacing.md }}>
            <Chip label={partyKind === 'customer' ? 'Udhaar (owes more)' : 'Bill (we owe more)'} selected={dir === 'debit'} onPress={() => setDir('debit')} color={colors.credit} />
            <Chip label="Jama / paid" selected={dir === 'credit'} onPress={() => setDir('credit')} color={colors.success} />
          </Row>
        ) : null}
        <Field label="Description / items" value={desc} onChangeText={setDesc} />
        <Row>
          <Button title="Save & approve" onPress={() => void save(true)} loading={busy} style={{ flex: 1 }} />
          <Button title="Save" variant="secondary" onPress={() => void save(false)} loading={busy} />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </Row>
        <View style={{ height: 40 }} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.bg, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '85%' },
});
