import { File } from 'expo-file-system';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatPaise, mulPaiseByQty } from '@/core/money';
import { normaliseQty, type Unit } from '@/core/units';
import { parseAndMatch, type MatchResult } from '@/core/voice/parse';
import { QtyPicker } from '@/features/sale/QtyPicker';
import { addProductLine } from '@/features/sale/cartStore';
import { callFunction } from '@/lib/ai';
import { listProducts } from '@/lib/repos/products';
import type { Product } from '@/lib/repos/types';
import { syncStore } from '@/lib/sync/engine';
import { Button, Card, Chip, ErrorBanner, Field, Pill, Row, Screen, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

interface Line { key: string; spoken: string; product: Product | null; candidates: Product[]; qty: string | null; unit: Unit; question: string | null; source: 'ai' | 'local' }

/**
 * Voice order: record → server transcription + product matching (AI) → OR typed Hinglish parsed on-device.
 * The interpreted order is shown with prices from the local catalogue; nothing is added to the bill
 * until the cashier confirms. Ambiguous items ask a question instead of guessing.
 */
export default function VoiceOrderScreen() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [products, setProducts] = useState<Product[]>([]);
  const [text, setText] = useState('');
  const [transcript, setTranscript] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<Line | null>(null);
  const online = syncStore.use((s) => s.online);

  useEffect(() => { void listProducts({}).then(setProducts); }, []);

  function localParse(t: string) {
    const results: MatchResult[] = parseAndMatch(t, products.map((p) => ({ id: p.id, name: p.name, name_hi: p.name_hi, aliases: p.aliases, unit: p.unit, is_loose: p.is_loose })));
    setLines(results.map((r, i) => ({ key: `l${i}`, spoken: r.fragment.raw, product: r.product ? products.find((p) => p.id === r.product!.id) ?? null : null, candidates: r.candidates.map((c) => products.find((p) => p.id === c.id)!).filter(Boolean), qty: r.qty, unit: (r.unit ?? r.product?.unit ?? 'pc') as Unit, question: r.needsClarification, source: 'local' })));
  }

  async function interpret(body: FormData | { text: string }) {
    setBusy(true);
    setError(null);
    try {
      const r = await callFunction<{ transcript: string | null; items: { spoken: string; product_id: string | null; qty: number | null; unit: string | null; alternatives: string[]; needs_clarification: boolean; clarification: string | null }[]; unparsed: string[]; not_configured?: boolean }>('ai-voice', body, { timeoutMs: 60_000 });
      setTranscript(r.transcript);
      if (r.not_configured) { setError('AI voice is not connected on the server — using on-device parsing of the text below.'); if (r.transcript) { setText(r.transcript); localParse(r.transcript); } return; }
      setLines([
        ...r.items.map((it, i) => {
          const p = it.product_id ? products.find((x) => x.id === it.product_id) ?? null : null;
          return { key: `a${i}`, spoken: it.spoken, product: p, candidates: it.alternatives.map((id) => products.find((x) => x.id === id)!).filter(Boolean), qty: it.qty != null ? String(it.qty) : null, unit: (it.unit ?? p?.unit ?? 'pc') as Unit, question: it.needs_clarification ? it.clarification ?? 'Kaunsa?' : p ? null : `"${it.spoken}" catalogue mein nahi mila`, source: 'ai' as const };
        }),
        ...r.unparsed.map((u, i) => ({ key: `u${i}`, spoken: u, product: null, candidates: [], qty: null, unit: 'pc' as Unit, question: `"${u}" samajh nahi aaya`, source: 'ai' as const })),
      ]);
    } catch (e) {
      setError(`${(e as Error).message}. Falling back to on-device parsing.`);
      if (typeof body !== 'object' || body instanceof FormData) return;
      localParse(body.text);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecord() {
    if (recorder.isRecording) {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return setError('No recording captured');
      if (!online) return setError('Recording saved but transcription needs internet. Type the order instead.');
      const form = new FormData();
      const f = new File(uri);
      form.append('audio', { uri, name: 'order.m4a', type: 'audio/m4a' } as unknown as Blob);
      void f;
      await interpret(form);
      return;
    }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return setError('Microphone permission needed');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  function submitText() {
    if (!text.trim()) return;
    if (online) void interpret({ text });
    else localParse(text);
  }

  const ready = lines.filter((l) => l.product && l.qty && normaliseQty(l.qty, l.product.unit));
  const total = ready.reduce((a, l) => a + mulPaiseByQty(l.product!.selling_price_paise, normaliseQty(l.qty!, l.product!.unit)!), 0);

  function confirm() {
    for (const l of ready) addProductLine(l.product!, normaliseQty(l.qty!, l.product!.unit)!, l.product!.selling_price_paise, 'voice');
    router.replace('/(app)/sale/new');
  }

  return (
    <Screen>
      <ErrorBanner message={error} />
      <Card tone={recorder.isRecording ? 'danger' : 'default'} style={{ alignItems: 'center' }}>
        <Button title={recorder.isRecording ? '⏹ Stop & interpret' : '🎤 Bol ke order do'} size="lg" variant={recorder.isRecording ? 'danger' : 'primary'} onPress={toggleRecord} loading={busy} style={{ width: '100%' }} />
        <T variant="caption" color={colors.textMuted} center>"Do kilo chawal, ek kilo chini aur aadha kilo dal"</T>
        {transcript ? <T color={colors.textMuted} center style={{ marginTop: spacing.sm }}>Heard: "{transcript}"</T> : null}
      </Card>
      <Field label="…or type the order (Hinglish ok, works offline)" value={text} onChangeText={setText} placeholder="2 kilo chawal, 1 packet parle" onSubmitEditing={submitText} returnKeyType="go" />
      <Button title="Interpret" variant="secondary" onPress={submitText} disabled={!text.trim()} />

      {lines.length ? (
        <Card style={{ marginTop: spacing.md }}>
          <Row style={{ justifyContent: 'space-between' }}><T variant="heading">Interpreted order</T><Pill label={lines[0].source === 'ai' ? 'AI' : 'On-device'} tone="muted" /></Row>
          {lines.map((l) => (
            <View key={l.key} style={{ paddingVertical: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: '700' }}>{l.product ? l.product.name : l.spoken}</T>
                  <T variant="caption" color={colors.textMuted}>"{l.spoken}" → {l.qty ?? '?'} {l.product?.unit ?? l.unit}{l.product ? ` × ${formatPaise(l.product.selling_price_paise)}` : ''}</T>
                </View>
                {l.product && l.qty ? <T style={{ fontWeight: '700' }}>{formatPaise(mulPaiseByQty(l.product.selling_price_paise, normaliseQty(l.qty, l.product.unit) ?? '0'))}</T> : <Pill label="needs input" tone="warning" />}
              </Row>
              {l.question ? <T variant="caption" color={colors.warning}>{l.question}</T> : null}
              <Row style={{ flexWrap: 'wrap', marginTop: 4 }} gap={4}>
                {l.candidates.map((c) => <Chip key={c.id} label={c.name} selected={l.product?.id === c.id} onPress={() => setLines(lines.map((x) => (x.key === l.key ? { ...x, product: c, unit: c.unit, question: c.is_loose && !x.qty ? `${c.name} kitna?` : null } : x)))} />)}
                {l.product ? <Chip label={l.qty ? 'Change qty' : 'Set qty'} onPress={() => setFixing(l)} /> : null}
                <Chip label="Remove" onPress={() => setLines(lines.filter((x) => x.key !== l.key))} />
              </Row>
            </View>
          ))}
          <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}><T variant="heading">Total ({ready.length} of {lines.length})</T><T variant="heading">{formatPaise(total)}</T></Row>
          <Button title={`Add ${ready.length} item(s) to bill`} size="lg" onPress={confirm} disabled={ready.length === 0} />
          <T variant="caption" color={colors.textMuted}>Prices come from your product list, never from the AI. Items marked "needs input" are left out until fixed.</T>
        </Card>
      ) : null}
      {fixing?.product ? <QtyPicker product={fixing.product} initialQty={fixing.qty ?? undefined} onCancel={() => setFixing(null)} onConfirm={(qty) => { setLines(lines.map((x) => (x.key === fixing.key ? { ...x, qty, question: null } : x))); setFixing(null); }} /> : null}
    </Screen>
  );
}
