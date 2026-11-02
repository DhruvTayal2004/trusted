import { Stack, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { bootstrapSession, useSession } from '@/features/session';
import { startSync, stopSync } from '@/lib/sync/engine';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const { status } = useSession();
  const segments = useSegments();

  useEffect(() => {
    void bootstrapSession();
  }, []);

  // Route guard: send the user to the screen that matches their session state.
  useEffect(() => {
    if (status === 'loading') return;
    SplashScreen.hideAsync().catch(() => undefined);
    const segs = segments as unknown as string[];
    const group = segs[0];
    if (status === 'not_configured' && group !== 'setup') router.replace('/setup');
    else if (status === 'signed_out' && group !== '(auth)') router.replace('/(auth)/login');
    else if (status === 'no_shop' && !(group === '(auth)' && segs[1] === 'create-shop')) router.replace('/(auth)/create-shop');
    else if (status === 'ready' && group !== '(app)') router.replace('/(app)/(tabs)/home');
  }, [status, segments]);

  useEffect(() => {
    if (status === 'ready') startSync();
    else stopSync();
  }, [status]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ title: 'Setup required' }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
