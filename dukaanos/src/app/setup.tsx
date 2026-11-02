import { Card, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function SetupScreen() {
  return (
    <Screen>
      <T variant="title">Supabase is not configured</T>
      <T color={colors.textMuted} style={{ marginTop: 8 }}>
        Copy <T variant="body" style={{ fontWeight: '700' }}>.env.example</T> to <T variant="body" style={{ fontWeight: '700' }}>.env</T> and set
        EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server (`npx expo start -c`).
      </T>
      <Card style={{ marginTop: 16 }}>
        <T variant="label">Steps</T>
        <T>1. supabase link / supabase db push (applies supabase/migrations)</T>
        <T>2. supabase functions deploy pin-login ai-extract ai-assistant ai-voice notify</T>
        <T>3. supabase secrets set --env-file .env (server keys only)</T>
      </Card>
    </Screen>
  );
}
