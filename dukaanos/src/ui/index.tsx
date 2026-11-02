import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatPaise } from '@/core/money';
import { colors, font, radius, spacing, touch } from './theme';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function Screen({ children, scroll = true, padded = true, refreshing, onRefresh, keyboard = true, style }: {
  children: React.ReactNode; scroll?: boolean; padded?: boolean; refreshing?: boolean; onRefresh?: () => void; keyboard?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const inner = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && styles.padded, { paddingBottom: spacing.xxl * 2 }, style]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.padded, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      {keyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress, tone = 'default' }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'default' | 'danger' | 'success' | 'warning' | 'info' }) {
  const toneStyle = tone === 'danger' ? { backgroundColor: colors.dangerBg, borderColor: colors.danger } : tone === 'success' ? { backgroundColor: colors.successBg, borderColor: colors.success } : tone === 'warning' ? { backgroundColor: colors.warningBg, borderColor: colors.warning } : tone === 'info' ? { backgroundColor: colors.infoBg, borderColor: colors.info } : null;
  const content = <View style={[styles.card, toneStyle, style]}>{children}</View>;
  if (onPress) return <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>{content}</Pressable>;
  return content;
}

export function Row({ children, style, gap = spacing.sm, align = 'center' }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number; align?: ViewStyle['alignItems'] }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap }, style]}>{children}</View>;
}

export function Spacer({ h = spacing.md }: { h?: number }) {
  return <View style={{ height: h }} />;
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------
export function T({ children, variant = 'body', color, style, numberOfLines, center }: {
  children: React.ReactNode; variant?: 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption'; color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number; center?: boolean;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[styles.text, styles[variant], color ? { color } : null, center && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  );
}

export function Money({ paise, variant = 'body', color, sign, style }: { paise: number; variant?: 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption'; color?: string; sign?: boolean; style?: StyleProp<TextStyle> }) {
  return <T variant={variant} color={color} style={[{ fontVariant: ['tabular-nums'] }, style]}>{formatPaise(paise, { sign })}</T>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm }}>
      <T variant="label" color={colors.textMuted}>{children}</T>
      {right}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
export function Button({ title, onPress, variant = 'primary', size = 'md', loading, disabled, icon, style }: {
  title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent'; size?: 'sm' | 'md' | 'lg'; loading?: boolean; disabled?: boolean; icon?: string; style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : variant === 'accent' ? colors.accent : variant === 'secondary' ? colors.surface : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' || variant === 'accent' ? colors.textOnPrimary : variant === 'secondary' ? colors.text : colors.primary;
  const height = size === 'lg' ? touch.big : size === 'sm' ? 40 : touch.min;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, height, borderColor: variant === 'secondary' ? colors.border : bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <Row gap={spacing.sm}>
          {icon ? <Text style={{ fontSize: size === 'lg' ? 22 : 18 }}>{icon}</Text> : null}
          <Text style={[styles.buttonText, { color: fg, fontSize: size === 'lg' ? font.size.lg : size === 'sm' ? font.size.sm : font.size.md }]}>{title}</Text>
        </Row>
      )}
    </Pressable>
  );
}

/** Large square action tile for the employee home screen. */
export function ActionTile({ title, subtitle, icon, onPress, color = colors.primary, badge }: { title: string; subtitle?: string; icon: string; onPress: () => void; color?: string; badge?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, { borderColor: color }, pressed && styles.pressed]}>
      {badge ? <View style={[styles.badge, { backgroundColor: colors.danger }]}><Text style={styles.badgeText}>{badge}</Text></View> : null}
      <Text style={{ fontSize: 40 }}>{icon}</Text>
      <Text style={[styles.tileTitle, { color }]}>{title}</Text>
      {subtitle ? <Text style={styles.tileSub}>{subtitle}</Text> : null}
    </Pressable>
  );
}

export function Field({ label, error, hint, style, inputStyle, ...props }: TextInputProps & { label?: string; error?: string | null; hint?: string; style?: StyleProp<ViewStyle>; inputStyle?: StyleProp<TextStyle> }) {
  return (
    <View style={[{ marginBottom: spacing.md }, style]}>
      {label ? <T variant="label" style={{ marginBottom: spacing.xs }}>{label}</T> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        {...props}
        style={[styles.input, error ? { borderColor: colors.danger } : null, props.multiline && { height: 96, textAlignVertical: 'top' }, inputStyle]}
      />
      {error ? <T variant="caption" color={colors.danger}>{error}</T> : hint ? <T variant="caption" color={colors.textMuted}>{hint}</T> : null}
    </View>
  );
}

export function MoneyField({ label, valueRupees, onChangeRupees, error, autoFocus, big }: { label?: string; valueRupees: string; onChangeRupees: (s: string) => void; error?: string | null; autoFocus?: boolean; big?: boolean }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <T variant="label" style={{ marginBottom: spacing.xs }}>{label}</T> : null}
      <Row style={[styles.input, { paddingVertical: 0 }, error ? { borderColor: colors.danger } : null, big && { height: touch.big }]}>
        <T variant={big ? 'title' : 'body'} color={colors.textMuted}>₹</T>
        <TextInput
          value={valueRupees}
          onChangeText={(t) => onChangeRupees(t.replace(/[^\d.]/g, ''))}
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          style={[styles.moneyInput, big && { fontSize: font.size.xxl }]}
        />
      </Row>
      {error ? <T variant="caption" color={colors.danger}>{error}</T> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, color = colors.primary }: { label: string; selected?: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && { backgroundColor: color, borderColor: color }]}>
      <Text style={[styles.chipText, selected && { color: colors.textOnPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ label, tone = 'info' }: { label: string; tone?: 'info' | 'success' | 'danger' | 'warning' | 'muted' }) {
  const bg = tone === 'success' ? colors.successBg : tone === 'danger' ? colors.dangerBg : tone === 'warning' ? colors.warningBg : tone === 'muted' ? colors.surfaceAlt : colors.infoBg;
  const fg = tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'muted' ? colors.textMuted : colors.info;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress, left }: { title: string; subtitle?: string | null; right?: React.ReactNode; onPress?: () => void; left?: React.ReactNode }) {
  const content = (
    <Row style={styles.listRow} gap={spacing.md}>
      {left}
      <View style={{ flex: 1 }}>
        <T variant="body" numberOfLines={1}>{title}</T>
        {subtitle ? <T variant="caption" color={colors.textMuted} numberOfLines={1}>{subtitle}</T> : null}
      </View>
      {right}
    </Row>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>{content}</Pressable> : content;
}

export function Stat({ label, paise, value, tone, onPress }: { label: string; paise?: number; value?: string; tone?: 'default' | 'danger' | 'success' | 'warning' | 'info'; onPress?: () => void }) {
  return (
    <Card tone={tone} style={{ flex: 1, minWidth: 140 }} onPress={onPress}>
      <T variant="caption" color={colors.textMuted}>{label}</T>
      {paise !== undefined ? <Money paise={paise} variant="title" /> : <T variant="title">{value}</T>}
    </Card>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <T variant="heading" center>{title}</T>
      {hint ? <T variant="body" color={colors.textMuted} center style={{ marginTop: spacing.sm }}>{hint}</T> : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <T variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>{label}</T> : null}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string | null | undefined; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <Card tone="danger" style={{ marginBottom: spacing.md }}>
      <T variant="body" color={colors.danger}>{message}</T>
      {onRetry ? <Button title="Retry" variant="ghost" size="sm" onPress={onRetry} /> : null}
    </Card>
  );
}

export function PressableRow(props: PressableProps & { children: React.ReactNode }) {
  return <Pressable {...props} style={({ pressed }) => [pressed && styles.pressed, props.style as StyleProp<ViewStyle>]}>{props.children}</Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  padded: { padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  pressed: { opacity: 0.7 },
  text: { color: colors.text, fontSize: font.size.md },
  display: { fontSize: font.size.display, fontWeight: '800', fontVariant: ['tabular-nums'] },
  title: { fontSize: font.size.xxl, fontWeight: '700' },
  heading: { fontSize: font.size.xl, fontWeight: '700' },
  body: { fontSize: font.size.md },
  label: { fontSize: font.size.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textMuted },
  caption: { fontSize: font.size.sm },
  button: { borderRadius: radius.md, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginVertical: spacing.xs },
  buttonText: { fontWeight: '700' },
  tile: { width: '47%', aspectRatio: 1.05, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, alignItems: 'center', justifyContent: 'center', padding: spacing.md, gap: spacing.xs },
  tileTitle: { fontSize: font.size.lg, fontWeight: '800', textAlign: 'center' },
  tileSub: { fontSize: font.size.sm, color: colors.textMuted, textAlign: 'center' },
  badge: { position: 'absolute', top: 8, right: 8, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: touch.min, fontSize: font.size.lg, color: colors.text },
  moneyInput: { flex: 1, fontSize: font.size.xl, color: colors.text, fontWeight: '700', paddingVertical: 0, height: '100%' },
  chip: { paddingHorizontal: spacing.md, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: font.size.sm, fontWeight: '600', color: colors.text },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: font.size.xs, fontWeight: '700' },
  listRow: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, minHeight: touch.min },
  empty: { padding: spacing.xxl, alignItems: 'center', justifyContent: 'center' },
});
