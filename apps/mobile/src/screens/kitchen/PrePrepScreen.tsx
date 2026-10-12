// apps/mobile/src/screens/kitchen/PrePrepScreen.tsx
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { submitPrePrep } from '../../api/prePrepApi';
import { colors, spacing, typography } from '../../lib/theme';

const DEFAULT_SHOP_ID = '1';

const LOSS_REASONS: { value: string; label: string }[] = [
  { value: 'thaw_drip', label: 'Thaw drip' },
  { value: 'peel', label: 'Peel' },
  { value: 'trim', label: 'Trim' },
  { value: 'bone_skin', label: 'Bone / skin' },
  { value: 'spoiled_on_prep', label: 'Spoiled on prep' },
  { value: 'other', label: 'Other' },
];

/**
 * Mobile pre-prep: raw SKU → prepped FG lot.
 * Calls Nest POST /kitchen/pre-prep (same as web PrePrepModal).
 */
export default function PrePrepScreen() {
  const [rawItemId, setRawItemId] = useState('');
  const [preppedItemId, setPreppedItemId] = useState('');
  const [preppedItemName, setPreppedItemName] = useState('');
  const [originalQty, setOriginalQty] = useState('');
  const [yieldedQty, setYieldedQty] = useState('');
  const [lossReason, setLossReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [unit, setUnit] = useState('kg');
  const [submitting, setSubmitting] = useState(false);

  const original = Number(originalQty) || 0;
  const yielded = Number(yieldedQty) || 0;
  const lost = useMemo(() => {
    if (!(original > 0) || !(yielded > 0) || yielded > original) return null;
    return Math.round((original - yielded) * 1000) / 1000;
  }, [original, yielded]);
  const lossPct = useMemo(() => {
    if (lost == null || !(original > 0)) return null;
    return Math.round((lost / original) * 1000) / 10;
  }, [lost, original]);

  async function handleSubmit() {
    if (!rawItemId.trim() || !preppedItemId.trim()) {
      Alert.alert('Missing SKUs', 'Enter both raw item ID and prepped item ID.');
      return;
    }
    if (!(original > 0) || !(yielded > 0)) {
      Alert.alert('Invalid quantities', 'Original and yielded must be positive.');
      return;
    }
    if (yielded > original) {
      Alert.alert('Invalid yield', 'Yielded cannot exceed original quantity.');
      return;
    }
    if (lost != null && lost > 0 && !lossReason) {
      Alert.alert('Loss reason', 'Select a loss reason when weight is lost.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitPrePrep(DEFAULT_SHOP_ID, {
        raw_item_id: rawItemId.trim(),
        prepped_item_id: preppedItemId.trim(),
        prepped_item_name: preppedItemName.trim() || undefined,
        original_qty: original,
        yielded_qty: yielded,
        loss_reason: lossReason || undefined,
        note: note.trim() || undefined,
        unit: unit.trim() || 'kg',
      });
      Alert.alert(
        'Pre-prep completed',
        `Lost ${res.lost_qty}${unit ? ` ${unit}` : ''} (${res.loss_pct}%).` +
          (res.prepped_unit_cost != null
            ? ` Prepped unit cost: ${res.prepped_unit_cost}`
            : ''),
      );
      setRawItemId('');
      setPreppedItemId('');
      setPreppedItemName('');
      setOriginalQty('');
      setYieldedQty('');
      setLossReason('');
      setNote('');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Pre-prep failed';
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Pre-prep</Text>
        <Text style={styles.subtitle}>
          Deducts raw original weight, records loss as pre-prep waste, and
          creates a prepped finished-good lot. Lost weight is calculated by the
          system.
        </Text>

        <Text style={styles.label}>Raw item ID (SKU)</Text>
        <TextInput
          style={styles.input}
          value={rawItemId}
          onChangeText={setRawItemId}
          autoCapitalize="characters"
          placeholder="e.g. CHICKEN-THAW"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={styles.label}>Prepped item ID (SKU)</Text>
        <TextInput
          style={styles.input}
          value={preppedItemId}
          onChangeText={setPreppedItemId}
          autoCapitalize="characters"
          placeholder="e.g. CHICKEN-PREP"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={styles.label}>Prepped name (optional)</Text>
        <TextInput
          style={styles.input}
          value={preppedItemName}
          onChangeText={setPreppedItemName}
          placeholder="Display name"
          placeholderTextColor={colors.textSecondary}
        />

        <View style={styles.row}>
          <View style={styles.half}>
            <Text style={styles.label}>Original qty</Text>
            <TextInput
              style={styles.input}
              value={originalQty}
              onChangeText={setOriginalQty}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <View style={styles.half}>
            <Text style={styles.label}>Yielded qty</Text>
            <TextInput
              style={styles.input}
              value={yieldedQty}
              onChangeText={setYieldedQty}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>

        <Text style={styles.label}>Unit</Text>
        <TextInput
          style={styles.input}
          value={unit}
          onChangeText={setUnit}
          placeholder="kg"
          placeholderTextColor={colors.textSecondary}
        />

        {lost != null ? (
          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              Lost: {lost} {unit} {lossPct != null ? `(${lossPct}%)` : ''}
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>Loss reason {lost && lost > 0 ? '(required)' : ''}</Text>
        <View style={styles.chips}>
          {LOSS_REASONS.map((r) => {
            const on = lossReason === r.value;
            return (
              <TouchableOpacity
                key={r.value}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => setLossReason(on ? '' : r.value)}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>Note (optional)</Text>
        <TextInput
          style={[styles.input, styles.note]}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="Optional note"
          placeholderTextColor={colors.textSecondary}
        />

        <TouchableOpacity
          style={[styles.submit, submitting && styles.submitDisabled]}
          onPress={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Complete pre-prep</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { ...typography.title, fontSize: 22, marginBottom: spacing.xs },
  subtitle: {
    ...typography.small,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  label: { ...typography.label, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: 16,
  },
  note: { minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  summary: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 10,
    backgroundColor: '#FFF8E6',
    borderWidth: 1,
    borderColor: colors.warning,
  },
  summaryText: { color: colors.textPrimary, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textPrimary },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  submit: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.7 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
