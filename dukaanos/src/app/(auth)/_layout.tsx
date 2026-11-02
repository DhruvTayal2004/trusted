import { Stack } from 'expo-router';
import { colors } from '@/ui/theme';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="pin" options={{ title: 'Employee login' }} />
      <Stack.Screen name="create-shop" options={{ title: 'Create your shop' }} />
    </Stack>
  );
}
