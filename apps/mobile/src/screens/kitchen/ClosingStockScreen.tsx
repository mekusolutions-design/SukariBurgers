// apps/mobile/src/screens/kitchen/ClosingStockScreen.tsx
/**
 * Mobile parity with web Closing Stock:
 * - Expected qty = backend system_qty (usable batch on-hand)
 * - counted 0 is valid; blank = not counted
 * - KITCHEN | MANAGER | ADMIN may submit
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchClosingStock,
  submitClosingStock,
  type ClosingStockLine,
} from '../../api/closingStockApi';
import { colors, spacing, typography } from '../../lib/theme';
import { useRole } from '../../hooks/useRole';

const DEFAULT_SHOP_ID = '1';

export default function ClosingStockScreen() {
  const { canSubmitClosingStock } = useRole();
  const canSubmit = canSubmitClosingStock;
  const [lines, setLines] = useState<ClosingStockLine[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchClosingStock(DEFAULT_SHOP_ID);
      setLines(data);
      const next: Record<string, string> = {};
      for (const row of data) {
        // Do not prefill counted — blank means uncounted
        next[row.itemId] = '';
      }
      setCounts(next);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to load closing stock';
      setError(message);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Blank = not counted; "0" = counted zero (valid). */
  const completedCount = lines.filter((l) =>
    (counts[l.itemId] ?? '').trim() !== '',
  ).length;

  async function handleSubmit() {
    if (!canSubmit) {
      Alert.alert(
        'Not allowed',
        'Kitchen staff, managers, and administrators can submit closing stock.',
      );
      return;
    }
    const payload = lines
      .map((l) => {
        const raw = (counts[l.itemId] ?? '').trim();
        if (raw === '') return null;
        const countedQty = Number(raw);
        if (!Number.isFinite(countedQty) || countedQty < 0) return null;
        return { itemId: l.itemId, countedQty };
      })
      .filter((x): x is { itemId: string; countedQty: number } => x !== null);

    if (payload.length === 0) {
      Alert.alert(
        'Nothing to submit',
        'Enter at least one counted quantity. Use 0 when the item is empty.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitClosingStock(DEFAULT_SHOP_ID, payload);
      const msg =
        result?.message ||
        (result?.repaired
          ? 'Closing stock saved — inventory batches re-synced.'
          : result?.alreadySubmitted
            ? 'Closing stock already submitted for this shift.'
            : 'Closing stock count saved.');
      Alert.alert('Submitted', String(msg));
      await load();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Submit failed';
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && lines.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Loading stock count…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Closing stock</Text>
        <Text style={styles.sub}>
          Expected matches Inventory (usable stock). 0 is a valid count.
        </Text>
        {!canSubmit ? (
          <Text style={styles.warn}>
            You can review quantities; only kitchen, managers, and admins can
            submit.
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <FlatList
        data={lines}
        keyExtractor={(item) => item.itemId}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} />
        }
        contentContainerStyle={{ paddingBottom: spacing.xl * 2 }}
        ListEmptyComponent={
          <Text style={styles.muted}>No inventory items to count.</Text>
        }
        renderItem={({ item }) => {
          const raw = counts[item.itemId] ?? '';
          const counted =
            raw.trim() === '' ? null : Number(raw);
          const variance =
            counted != null && Number.isFinite(counted)
              ? counted - item.systemQty
              : null;
          return (
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.unit}>{item.unit}</Text>
              </View>
              <Text style={styles.expected}>
                Expected {item.systemQty}
                {item.daysSinceLastCount != null &&
                item.daysSinceLastCount > 0
                  ? ` · last count ${item.daysSinceLastCount}d ago`
                  : ''}
              </Text>
              <View style={styles.countRow}>
                <Text style={styles.label}>Counted</Text>
                <TextInput
                  style={[styles.input, !canSubmit && styles.inputDisabled]}
                  keyboardType="decimal-pad"
                  editable={canSubmit && !submitting}
                  value={raw}
                  placeholder="—"
                  placeholderTextColor={colors.textSecondary}
                  onChangeText={(t) =>
                    setCounts((prev) => ({ ...prev, [item.itemId]: t }))
                  }
                />
              </View>
              {variance != null ? (
                <Text
                  style={[
                    styles.variance,
                    variance === 0
                      ? styles.varOk
                      : Math.abs(variance) > Math.max(item.systemQty, 1) * 0.1
                        ? styles.varBad
                        : styles.varWarn,
                  ]}
                >
                  {variance === 0
                    ? 'Matches'
                    : `${variance > 0 ? '+' : ''}${variance.toFixed(2)} ${item.unit}`}
                </Text>
              ) : (
                <Text style={styles.mutedSmall}>Enter count (0 allowed)</Text>
              )}
            </View>
          );
        }}
      />

      <View style={styles.footer}>
        <Text style={styles.footerMeta}>
          {completedCount} of {lines.length} counted
        </Text>
        <TouchableOpacity
          style={[
            styles.submit,
            (!canSubmit || submitting || completedCount === 0) &&
              styles.submitDisabled,
          ]}
          disabled={!canSubmit || submitting || completedCount === 0}
          onPress={() => void handleSubmit()}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Submit closing stock</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 4,
  },
  title: { ...typography.title, color: colors.textPrimary },
  sub: { ...typography.small, color: colors.textSecondary },
  warn: { ...typography.small, color: colors.warning },
  error: { ...typography.small, color: colors.danger },
  row: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: { ...typography.label, color: colors.textPrimary, flex: 1 },
  unit: { ...typography.small, color: colors.textSecondary },
  expected: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 4,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  label: { ...typography.small, color: colors.textPrimary, width: 64 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    textAlign: 'right',
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  inputDisabled: { opacity: 0.6 },
  variance: { marginTop: 6, ...typography.small },
  varOk: { color: colors.success },
  varWarn: { color: colors.warning },
  varBad: { color: colors.danger },
  muted: { ...typography.small, color: colors.textSecondary, textAlign: 'center' },
  mutedSmall: { ...typography.small, color: colors.textSecondary, marginTop: 4 },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  footerMeta: { ...typography.small, color: colors.textSecondary },
  submit: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: '#fff', fontWeight: '600' },
});
