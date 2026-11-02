import { Tabs } from 'expo-router/js-tabs';
import { Text } from 'react-native';
import { isManager } from '@/core/permissions';
import { useMember } from '@/features/session';
import { colors } from '@/ui/theme';

function icon(glyph: string) {
  return ({ focused }: { focused: boolean }) => <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const member = useMember();
  const manager = isManager(member);
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="home" options={{ title: manager ? 'Dashboard' : 'Home', tabBarIcon: icon(manager ? '📊' : '🏪') }} />
      <Tabs.Screen name="sales" options={{ title: 'Sales', tabBarIcon: icon('🧾') }} />
      <Tabs.Screen name="khata" options={{ title: 'Khata', tabBarIcon: icon('📒') }} />
      <Tabs.Screen name="inventory" options={{ title: 'Stock', tabBarIcon: icon('📦') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('☰') }} />
    </Tabs>
  );
}
