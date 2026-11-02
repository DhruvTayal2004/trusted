import { useLocalSearchParams } from 'expo-router';
import { ProductForm } from '@/features/ProductForm';
import { Screen } from '@/ui';

export default function NewProductScreen() {
  const { barcode } = useLocalSearchParams<{ barcode?: string }>();
  return (
    <Screen>
      <ProductForm initialBarcode={barcode} />
    </Screen>
  );
}
