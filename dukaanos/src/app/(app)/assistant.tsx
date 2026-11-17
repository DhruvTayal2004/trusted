import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { callFunction } from '@/lib/ai';
import { syncStore } from '@/lib/sync/engine';
import { Button, Card, Chip, Field, Pill, Row, Screen, T } from '@/ui';
import { colors, radius, spacing } from '@/ui/theme';

interface Msg { role: 'user' | 'assistant'; content: string; confidence?: 'verified' | 'estimate' | 'unavailable'; dataUsed?: { fn: string; error?: string }[] }
const SUGGESTIONS = ['Aaj kitni sale hui?', 'Kitna cash hona chahiye?', 'Kitna udhaar baaki hai?', 'Aaj kitne expenses hue?', 'Kaunsa stock kam hai?', 'Is hafte ki sale?', 'Kis shift mein cash difference aaya?', 'Supplier ko kitna dena hai?'];

/** Owner's assistant. The server answers only from deterministic reports; each answer carries a verification tag. */
export default function AssistantScreen() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const online = syncStore.use((s) => s.online);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: question }]);
    setBusy(true);
    try {
      const r = await callFunction<{ answer: string; confidence: Msg['confidence']; data_used: { fn: string; error?: string }[] }>('ai-assistant', { question, history }, { timeoutMs: 60_000 });
      setMessages((m) => [...m, { role: 'assistant', content: r.answer, confidence: r.confidence, dataUsed: r.data_used }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Could not get an answer: ${(e as Error).message}`, confidence: 'unavailable' }]);
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <Screen scroll={false} padded={false}>
      {!online ? <Card tone="warning" style={{ margin: spacing.lg, marginBottom: 0 }}><T>Assistant needs internet. The Dashboard and Reports work offline.</T></Card> : null}
      <ScrollView ref={scroll} contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
        {messages.length === 0 ? (
          <Card tone="info">
            <T variant="heading">Pooch lo — Hindi, Hinglish ya English</T>
            <T variant="caption" color={colors.textMuted}>Every number comes from your recorded transactions. The assistant never estimates money; if something isn't recorded it will say so.</T>
          </Card>
        ) : null}
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? styles.user : styles.bot]}>
            <T color={m.role === 'user' ? colors.textOnPrimary : colors.text}>{m.content}</T>
            {m.role === 'assistant' && m.confidence ? (
              <Row style={{ marginTop: 6, flexWrap: 'wrap' }} gap={4}>
                <Pill label={m.confidence === 'verified' ? 'Verified from records' : m.confidence === 'estimate' ? 'Estimate' : 'Not available'} tone={m.confidence === 'verified' ? 'success' : m.confidence === 'estimate' ? 'warning' : 'danger'} />
                {(m.dataUsed ?? []).map((d, j) => <Pill key={j} label={`${d.fn}${d.error ? ' ✗' : ''}`} tone="muted" />)}
              </Row>
            ) : null}
          </View>
        ))}
        {busy ? <T color={colors.textMuted}>Checking records…</T> : null}
      </ScrollView>
      <View style={styles.composer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: spacing.sm }}>
          {SUGGESTIONS.map((s) => <Chip key={s} label={s} onPress={() => void ask(s)} />)}
        </ScrollView>
        <Row>
          <Field value={input} onChangeText={setInput} placeholder="Ramesh ka kitna udhaar hai?" style={{ flex: 1, marginBottom: 0 }} onSubmitEditing={() => void ask(input)} returnKeyType="send" />
          <Button title="Ask" onPress={() => void ask(input)} loading={busy} disabled={!online} />
        </Row>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '88%', padding: spacing.md, borderRadius: radius.lg },
  user: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  bot: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  composer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
});
