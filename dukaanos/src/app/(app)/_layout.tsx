import { Stack } from 'expo-router';
import { useSession } from '@/features/session';
import { Loading } from '@/ui';
import { colors } from '@/ui/theme';

export default function AppLayout() {
  const { status } = useSession();
  if (status !== 'ready') return <Loading />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="sale/new" options={{ title: 'New sale' }} />
      <Stack.Screen name="sale/voice" options={{ title: 'Voice order' }} />
      <Stack.Screen name="sale/scan" options={{ title: 'Scan barcode' }} />
      <Stack.Screen name="sale/[id]" options={{ title: 'Sale' }} />
      <Stack.Screen name="customers/new" options={{ title: 'New customer' }} />
      <Stack.Screen name="customers/[id]" options={{ title: 'Khata' }} />
      <Stack.Screen name="products/new" options={{ title: 'New product' }} />
      <Stack.Screen name="products/[id]" options={{ title: 'Product' }} />
      <Stack.Screen name="suppliers/index" options={{ title: 'Suppliers' }} />
      <Stack.Screen name="suppliers/new" options={{ title: 'New supplier' }} />
      <Stack.Screen name="suppliers/[id]" options={{ title: 'Supplier' }} />
      <Stack.Screen name="purchases/new" options={{ title: 'Receive stock' }} />
      <Stack.Screen name="purchases/index" options={{ title: 'Purchases' }} />
      <Stack.Screen name="expenses/new" options={{ title: 'Record expense' }} />
      <Stack.Screen name="expenses/index" options={{ title: 'Expenses' }} />
      <Stack.Screen name="shift/open" options={{ title: 'Open shift' }} />
      <Stack.Screen name="shift/close" options={{ title: 'Close shift' }} />
      <Stack.Screen name="shift/index" options={{ title: 'Shifts' }} />
      <Stack.Screen name="inventory/adjust" options={{ title: 'Stock adjustment' }} />
      <Stack.Screen name="inventory/count" options={{ title: 'Physical count' }} />
      <Stack.Screen name="scanner/index" options={{ title: 'Scan notebook' }} />
      <Stack.Screen name="scanner/review" options={{ title: 'Review entries' }} />
      <Stack.Screen name="assistant" options={{ title: 'AI assistant' }} />
      <Stack.Screen name="employees/index" options={{ title: 'Employees' }} />
      <Stack.Screen name="employees/edit" options={{ title: 'Employee' }} />
      <Stack.Screen name="reports" options={{ title: 'Reports' }} />
      <Stack.Screen name="alerts" options={{ title: 'Alerts & notifications' }} />
      <Stack.Screen name="sync" options={{ title: 'Sync status' }} />
      <Stack.Screen name="approvals" options={{ title: 'Approvals' }} />
      <Stack.Screen name="audit" options={{ title: 'Audit log' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="upi" options={{ title: 'UPI verification' }} />
    </Stack>
  );
}
