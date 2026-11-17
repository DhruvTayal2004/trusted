import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useMember, useSession } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { newId } from '@/lib/ids';
import { SCAN_KIND_LABELS, extractPage, listBatches, uploadPage, type ScanKind } from '@/lib/repos/scanner';
import { syncStore } from '@/lib/sync/engine';
import { Button, Card, Chip, ErrorBanner, ListRow, Pill, Row, Screen, SectionTitle, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

/**
 * Notebook scanner: pick the notebook type → photograph pages (batch) → upload → AI extraction → review.
 * Original page images are preserved in storage; every imported record points back to its page row.
 */
export default function ScannerScreen() {
  const { shop } = useSession();
  const member = useMember();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [kind, setKind] = useState<ScanKind>('customer_khata');
  const [shooting, setShooting] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const online = syncStore.use((s) => s.online);
  const batches = useQuery(() => listBatches());

  async function snap() {
    const pic = await camera.current?.takePictureAsync({ quality: 0.7, skipProcessing: false });
    if (pic?.uri) setPages((p) => [...p, pic.uri]);
  }
  async function pickFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError('Photo library permission needed');
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.7, selectionLimit: 10 });
    if (!res.canceled) setPages((p) => [...p, ...res.assets.map((a) => a.uri)]);
  }

  async function process() {
    if (!pages.length) return;
    setError(null);
    const batchId = newId();
    try {
      const scanIds: string[] = [];
      for (let i = 0; i < pages.length; i++) {
        setProgress(`Uploading page ${i + 1} of ${pages.length}…`);
        const s = await uploadPage(shop!.id, member.id, kind, batchId, i + 1, pages[i]);
        scanIds.push(s.id);
      }
      let notConfigured = false;
      for (let i = 0; i < scanIds.length; i++) {
        setProgress(`Reading page ${i + 1} of ${scanIds.length} with AI… (10–40 s per page)`);
        const r = await extractPage(scanIds[i]).catch((e: Error) => ({ ok: false, error: e.message }));
        if ('not_configured' in r && r.not_configured) notConfigured = true;
      }
      setPages([]);
      setProgress(null);
      if (notConfigured) setError('Pages uploaded and saved, but AI is not connected on the server (no API key). Ask your developer to set ANTHROPIC_API_KEY or OPENAI_API_KEY, then retry from the batch list.');
      else router.push({ pathname: '/(app)/scanner/review', params: { batch: batchId } });
    } catch (e) {
      setProgress(null);
      setError((e as Error).message);
    }
  }

  if (shooting) {
    if (!permission?.granted) return <Screen><Card><T>Camera permission is needed.</T><Button title="Allow camera" onPress={() => void requestPermission()} /><Button title="Back" variant="ghost" onPress={() => setShooting(false)} /></Card></Screen>;
    return (
      <Screen scroll={false} padded={false}>
        <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
        <View style={styles.shootBar}>
          <ScrollView horizontal style={{ maxHeight: 64 }} contentContainerStyle={{ gap: 6 }}>{pages.map((p, i) => <Image key={i} source={{ uri: p }} style={{ width: 48, height: 64, borderRadius: 6 }} />)}</ScrollView>
          <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm }}>
            <Button title="Done" variant="secondary" onPress={() => setShooting(false)} />
            <Button title={`📷 Capture page ${pages.length + 1}`} size="lg" onPress={snap} style={{ flex: 1 }} />
          </Row>
          <T variant="caption" color="#fff" center>Flat page, good light, whole page in frame. Shoot every page of the notebook, then Done.</T>
        </View>
      </Screen>
    );
  }

  return (
    <Screen refreshing={batches.loading} onRefresh={batches.refresh}>
      <ErrorBanner message={error} />
      {!online ? <Card tone="warning"><T>Scanning needs internet (upload + AI). You can still photograph pages now and process later.</T></Card> : null}
      <T variant="label">What is this notebook?</T>
      <Row style={{ flexWrap: 'wrap', marginVertical: spacing.sm }}>
        {(Object.keys(SCAN_KIND_LABELS) as ScanKind[]).map((k) => <Chip key={k} label={SCAN_KIND_LABELS[k].label} selected={kind === k} onPress={() => setKind(k)} />)}
      </Row>
      <T variant="caption" color={colors.textMuted}>{SCAN_KIND_LABELS[kind].hint}</T>
      <Card style={{ marginTop: spacing.md }}>
        {pages.length ? <ScrollView horizontal contentContainerStyle={{ gap: 8, marginBottom: spacing.md }}>{pages.map((p, i) => <View key={i}><Image source={{ uri: p }} style={{ width: 72, height: 96, borderRadius: 8 }} /><Button title="✕" size="sm" variant="ghost" onPress={() => setPages(pages.filter((_, j) => j !== i))} /></View>)}</ScrollView> : null}
        <Row>
          <Button title="📷 Photograph pages" size="lg" onPress={() => setShooting(true)} style={{ flex: 1 }} />
          <Button title="🖼️" variant="secondary" size="lg" onPress={pickFromGallery} style={{ width: 64 }} />
        </Row>
        {pages.length ? <Button title={progress ?? `Read ${pages.length} page(s) with AI`} variant="accent" size="lg" onPress={process} loading={Boolean(progress)} disabled={!online} /> : null}
        <T variant="caption" color={colors.textMuted}>Nothing is imported automatically. You review every line, fix names/amounts/dates, and approve.</T>
      </Card>

      <SectionTitle>Scanned batches</SectionTitle>
      {(batches.data ?? []).map((b) => (
        <ListRow key={b.batch_id} title={`${SCAN_KIND_LABELS[b.kind]?.label ?? b.kind} · ${b.pages} page(s)`} subtitle={new Date(b.created_at).toLocaleString()}
          right={<Pill label={b.status === 'imported' ? 'Imported' : b.status === 'failed' ? 'Failed' : b.status === 'processing' ? 'Processing' : `${b.pending} to review`} tone={b.status === 'imported' ? 'success' : b.status === 'failed' ? 'danger' : b.pending ? 'warning' : 'muted'} />}
          onPress={() => router.push({ pathname: '/(app)/scanner/review', params: { batch: b.batch_id } })} />
      ))}
      {batches.data && batches.data.length === 0 ? <T color={colors.textMuted}>No scans yet.</T> : null}
      {batches.error ? <T color={colors.danger}>{batches.error}</T> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ shootBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.55)' } });
