import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { addProductLine } from '@/features/sale/cartStore';
import { getProductByBarcode } from '@/lib/repos/products';
import { Button, Card, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

/** Barcode → add to bill. Unknown barcode → offer to create the product with it pre-filled. */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [last, setLast] = useState<{ code: string; name: string | null } | null>(null);
  const busy = useRef(false);

  async function onScanned(code: string) {
    if (busy.current) return;
    busy.current = true;
    const p = await getProductByBarcode(code);
    if (p) {
      addProductLine(p, '1', p.selling_price_paise, 'barcode');
      setLast({ code, name: p.name });
    } else {
      setLast({ code, name: null });
    }
    setTimeout(() => { busy.current = false; }, 1500);
  }

  if (!permission) return <Screen><T>Checking camera permission…</T></Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <Card><T>Camera access is needed to scan barcodes.</T><Button title="Allow camera" onPress={() => void requestPermission()} /></Card>
      </Screen>
    );
  }
  return (
    <Screen scroll={false} padded={false}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }} onBarcodeScanned={(r) => void onScanned(r.data)} />
      <View style={styles.overlay}>
        {last ? (
          last.name ? (
            <Card tone="success"><T variant="heading">Added: {last.name}</T><T variant="caption" color={colors.textMuted}>Scan the next item or go back to the bill</T></Card>
          ) : (
            <Card tone="warning">
              <T variant="heading">Unknown barcode {last.code}</T>
              <Button title="Create product with this barcode" onPress={() => router.replace({ pathname: '/(app)/products/new', params: { barcode: last.code } })} />
            </Card>
          )
        ) : <Card><T center>Point at a barcode</T></Card>}
        <Button title="Back to bill" size="lg" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ overlay: { position: 'absolute', left: 16, right: 16, bottom: 24 } });
