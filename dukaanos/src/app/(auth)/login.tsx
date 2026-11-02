import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { signInOwner, signUpOwner } from '@/features/session';
import { Button, Card, ErrorBanner, Field, Screen, Spacer, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!email.includes('@') || password.length < 6) {
      setError('Enter a valid email and a password of at least 6 characters');
      return;
    }
    setBusy(true);
    const err = mode === 'login' ? await signInOwner(email.trim(), password) : await signUpOwner(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Screen>
      <Spacer h={48} />
      <T variant="display" center>DukaanOS</T>
      <T center color={colors.textMuted}>Aapki dukaan, aapke phone mein</T>
      <Spacer h={32} />

      <Card>
        <T variant="heading">{mode === 'login' ? 'Owner login' : 'Create owner account'}</T>
        <Spacer />
        <ErrorBanner message={error} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="owner@example.com" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" />
        <Button title={mode === 'login' ? 'Login' : 'Create account'} onPress={submit} loading={busy} size="lg" />
        <Button title={mode === 'login' ? 'New shop? Create owner account' : 'Already have an account? Login'} variant="ghost" onPress={() => setMode(mode === 'login' ? 'signup' : 'login')} />
      </Card>

      <View style={{ alignItems: 'center', marginVertical: 8 }}>
        <T color={colors.textMuted}>— or —</T>
      </View>
      <Button title="Employee login with PIN" icon="🔢" variant="secondary" size="lg" onPress={() => router.push('/(auth)/pin')} />
    </Screen>
  );
}
