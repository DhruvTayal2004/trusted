import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { listCustomers } from '@/lib/repos/customers';
import type { Customer } from '@/lib/repos/types';
import { Button, Field, ListRow, Money, Row, T } from '@/ui';
import { colors, radius, spacing } from '@/ui/theme';

export function CustomerPicker({ onSelect, onCancel }: { onSelect: (c: Customer) => void; onCancel: () => void }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Customer[]>([]);
  useEffect(() => { void listCustomers(search).then(setRows); }, [search]);
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="heading">Customer (khata)</T>
          <Button title="+ New" size="sm" variant="secondary" onPress={() => { onCancel(); router.push({ pathname: '/(app)/customers/new', params: { returnTo: 'sale' } }); }} />
        </Row>
        <Field value={search} onChangeText={setSearch} placeholder="Name or phone" autoFocus />
        <View style={{ maxHeight: 360 }}>
          {rows.slice(0, 30).map((c) => (
            <ListRow key={c.id} title={c.name} subtitle={c.phone} right={<Money paise={c.balance_paise} color={c.balance_paise > 0 ? colors.credit : colors.textMuted} />} onPress={() => onSelect(c)} />
          ))}
          {rows.length === 0 ? <T color={colors.textMuted}>No customers match.</T> : null}
        </View>
        <Button title="Cancel" variant="ghost" onPress={onCancel} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.bg, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: spacing.xxl },
});
