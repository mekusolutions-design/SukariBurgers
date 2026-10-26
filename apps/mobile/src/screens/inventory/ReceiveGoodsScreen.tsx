// apps/mobile/src/screens/inventory/ReceiveGoodsScreen.tsx
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
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

import { useReceiveStore } from '../../features/receive/receiveStore';
import apiClient from '../../api/apiClient';
import { API_ENDPOINTS } from '../../api/endpoints';
import { useOfflineStore } from '../../features/offline/offlineStore';
import {
  DEFAULT_INGREDIENT_CATEGORY,
  INGREDIENT_CATEGORIES,
  INGREDIENT_CATEGORY_GROUPS,
} from '../../lib/ingredientCategories';
import { colors, spacing, typography } from '../../lib/theme';
import {
  INVENTORY_UNITS,
  DEFAULT_INVENTORY_UNIT,
} from '../../lib/inventoryUnits';

type RootStackParamList = {
  Receive: { scannedItemId?: string } | undefined;
  BarcodeScanner: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Receive'>;

const dateOnlyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

type InventorySuggestion = {
  itemId: string;
  name: string;
  category: string;
  unit: string;
  availableStock: number;
  lastReceivedAt?: string | null;
  avgUnitCost?: number;
};

function normalizeSuggestion(raw: Record<string, unknown>): InventorySuggestion | null {
  const itemId = String(raw.itemId ?? raw.item_id ?? '').trim();
  if (!itemId) return null;
  return {
    itemId,
    name: String(raw.name ?? raw.itemName ?? raw.item_name ?? itemId),
    category: String(raw.category ?? ''),
    unit: String(raw.unit ?? raw.units ?? 'pcs'),
    availableStock: Number(raw.availableStock ?? raw.available_stock ?? 0),
    lastReceivedAt: raw.lastReceivedAt == null && raw.last_received_at == null
      ? null : String(raw.lastReceivedAt ?? raw.last_received_at),
    avgUnitCost: Number(raw.avgUnitCost ?? raw.avg_unit_cost ?? 0),
  };
}

const emptyForm = () => ({
  item_id: '',
  item_name: '',
  units: 'kg',
  category: DEFAULT_INGREDIENT_CATEGORY,
  quantity: '',
  quantity_approved: '',
  quantity_rejected: '0',
  date_received: dateOnlyToday(),
  expiry_date: '',
  unit_cost: '',
  total_cost: '',
  supplier_name: '',
  supplier_number: '',
  supplier_id: '',
  approved_by: '',
  batch_number: '',
});

export default function ReceiveGoodsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute();

  const { submitReceive, isSubmitting } = useReceiveStore();
  const pendingCount = useOfflineStore((s) =>
    s.queue.filter((q) => q.module === 'receive').length,
  );
  const isSyncing = useOfflineStore((s) => s.isSyncing);
  const syncNow = useOfflineStore((s) => s.syncNow);

  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [categoryGroup, setCategoryGroup] = useState(
    INGREDIENT_CATEGORY_GROUPS[0]?.group ?? '',
  );
  const [suggestions, setSuggestions] = useState<InventorySuggestion[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggestionField, setSuggestionField] = useState<'item_id' | 'item_name'>('item_id');
  const [selectedExistingItem, setSelectedExistingItem] = useState<InventorySuggestion | null>(null);

  useEffect(() => {
    const params = route.params as { scannedItemId?: string } | undefined;
    const scannedId = params?.scannedItemId;
    if (scannedId) {
      setSuggestionField('item_id');
      setForm((prev) => ({ ...prev, item_id: scannedId }));
      navigation.setParams({ scannedItemId: undefined } as never);
    }
  }, [route.params, navigation]);

  // Search by whichever field the user is currently editing, matching web.
  useEffect(() => {
    const nameQ = form.item_name.trim();
    const skuQ = form.item_id.trim();
    const query = suggestionField === 'item_name' ? nameQ : skuQ;
    if (
      selectedExistingItem &&
      nameQ.toLowerCase() === selectedExistingItem.name.toLowerCase() &&
      skuQ.toLowerCase() === selectedExistingItem.itemId.toLowerCase()
    ) {
      setSuggestions([]);
      setSuggestionError(null);
      setSuggestionLoading(false);
      return;
    }
    if (query.length < 1) {
      setSuggestions([]);
      setSuggestionError(null);
      setSuggestionLoading(false);
      return;
    }

    // Match the web receiving picker: one bounded, search-filtered request.
    // Abort stale requests when the user types again or leaves this screen.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSuggestionLoading(true);
      setSuggestionError(null);
      try {
        const response = await apiClient.get(API_ENDPOINTS.GET_STOCK, {
          params: { search: query, page: 1, pageSize: 8, limit: 8 },
          signal: controller.signal,
        });
        const root = (response.data ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(root.items)
          ? root.items
          : Array.isArray(root.data)
            ? root.data
            : Array.isArray(response.data)
              ? response.data
              : [];
        const mapped = (rows as Record<string, unknown>[])
          .map(normalizeSuggestion)
          .filter((row): row is InventorySuggestion => row !== null);
        if (!controller.signal.aborted) setSuggestions(mapped);
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setSuggestionError(error instanceof Error ? error.message : 'Could not search existing SKUs');
        }
      } finally {
        if (!controller.signal.aborted) setSuggestionLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.item_name, form.item_id, selectedExistingItem, suggestionField]);

  useEffect(() => {
    const approvedQty =
      form.quantity_approved.trim() !== ''
        ? Number(form.quantity_approved)
        : Number(form.quantity);
    const unitCost = Number(form.unit_cost);

    if (
      !Number.isNaN(approvedQty) &&
      approvedQty > 0 &&
      !Number.isNaN(unitCost) &&
      unitCost >= 0
    ) {
      setForm((prev) => ({
        ...prev,
        total_cost: (approvedQty * unitCost).toFixed(2),
      }));
    }
  }, [form.quantity_approved, form.quantity, form.unit_cost]);

  const leafOptions =
    INGREDIENT_CATEGORY_GROUPS.find((g) => g.group === categoryGroup)?.items ??
    INGREDIENT_CATEGORIES;

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;

    if (!form.item_id.trim()) newErrors.item_id = 'Item ID is required';
    if (!form.item_name.trim()) newErrors.item_name = 'Item name is required';
    if (!form.units.trim()) newErrors.units = 'Units are required';
    if (!form.category.trim()) {
      newErrors.category = 'Category is required';
    } else if (
      !INGREDIENT_CATEGORIES.some(
        (c) => c.toLowerCase() === form.category.trim().toLowerCase(),
      )
    ) {
      newErrors.category = 'Pick a valid ingredient category';
    }

    const qty = Number(form.quantity);
    if (!form.quantity.trim() || Number.isNaN(qty) || qty <= 0) {
      newErrors.quantity = 'Quantity must be a positive number';
    }

    if (!form.date_received.trim()) {
      newErrors.date_received = 'Date received is required';
    } else if (!dateRe.test(form.date_received.trim())) {
      newErrors.date_received = 'Use YYYY-MM-DD';
    }

    if (!form.expiry_date.trim()) {
      newErrors.expiry_date = 'Expiry date is required';
    } else if (!dateRe.test(form.expiry_date.trim())) {
      newErrors.expiry_date = 'Use YYYY-MM-DD';
    }

    const unitCost = Number(form.unit_cost);
    if (!form.unit_cost.trim() || Number.isNaN(unitCost) || unitCost <= 0) {
      newErrors.unit_cost = 'Unit cost (KES) must be greater than 0 — needed for inventory value';
    }

    if (!form.batch_number.trim()) {
      newErrors.batch_number = 'Batch number is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (
    field: keyof ReturnType<typeof emptyForm>,
    value: string,
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const applyInventorySuggestion = (item: InventorySuggestion) => {
    setSelectedExistingItem(item);
    setSuggestions([]);
    setForm((prev) => ({
      ...prev,
      item_id: item.itemId,
      item_name: item.name,
      category: item.category || prev.category,
      units: item.unit || prev.units,
      unit_cost: (item.avgUnitCost ?? 0) > 0 ? String(item.avgUnitCost) : prev.unit_cost,
    }));
    const group = INGREDIENT_CATEGORY_GROUPS.find((g) => g.items.some((c) => c.toLowerCase() === item.category.toLowerCase()));
    if (group) setCategoryGroup(group.group);
  };

  const resetForm = () => {
    setForm(emptyForm());
    setErrors({});
    setCategoryGroup(INGREDIENT_CATEGORY_GROUPS[0]?.group ?? '');
    setSuggestions([]);
    setSuggestionField('item_id');
    setSelectedExistingItem(null);
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      Alert.alert('Validation Error', 'Please fix the highlighted fields');
      return;
    }

    const qty = Number(form.quantity);
    const approvedQty =
      form.quantity_approved.trim() === ''
        ? qty
        : Number(form.quantity_approved);
    const rejectedQty =
      form.quantity_rejected.trim() === ''
        ? 0
        : Number(form.quantity_rejected);
    const unitCost = Number(form.unit_cost);
    const totalCost =
      form.total_cost.trim() === ''
        ? approvedQty * unitCost
        : Number(form.total_cost);

    const result = await submitReceive({
      item_id: form.item_id.trim(),
      item_name: form.item_name.trim(),
      units: form.units.trim(),
      category: form.category.trim(),
      quantity: qty,
      quantity_approved: approvedQty,
      quantity_rejected: rejectedQty,
      date_received: form.date_received.trim(),
      expiry_date: form.expiry_date.trim(),
      unit_cost: unitCost,
      total_cost: totalCost,
      batch_number: form.batch_number.trim(),
      ...(form.supplier_name.trim()
        ? { supplier_name: form.supplier_name.trim() }
        : {}),
      ...(form.supplier_number.trim()
        ? { supplier_number: form.supplier_number.trim() }
        : {}),
      ...(form.supplier_id.trim()
        ? { supplier_id: form.supplier_id.trim() }
        : {}),
      ...(form.approved_by.trim()
        ? { approved_by: form.approved_by.trim() }
        : {}),
    });

    if (result.success) {
      Alert.alert(
        result.offline ? 'Saved Offline' : 'Success',
        result.message,
      );
      resetForm();
    } else {
      Alert.alert('Error', result.message);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {pendingCount > 0 && (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingCount}>
              {pendingCount} pending receive{pendingCount !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity onPress={() => syncNow()} disabled={isSyncing}>
              <Text style={styles.retryText}>
                {isSyncing ? 'Syncing...' : 'Sync now'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={typography.title}>Receive Goods (GRN)</Text>

        <View style={styles.form}>
          <View style={styles.formGroup}>
            <Text style={typography.label}>Item ID *</Text>
            <View style={styles.row}>
              <TextInput
                style={[
                  styles.input,
                  errors.item_id && styles.inputError,
                  { flex: 1 },
                ]}
                placeholder="e.g. ST300"
                value={form.item_id}
                onChangeText={(v) => {
                  setSuggestionField('item_id');
                  if (selectedExistingItem && v.toLowerCase() !== selectedExistingItem.itemId.toLowerCase()) {
                    setSelectedExistingItem(null);
                    setForm((prev) => ({ ...prev, item_id: v }));
                  } else {
                    handleChange('item_id', v);
                  }
                }}
                editable={!selectedExistingItem}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={[styles.scanButton, selectedExistingItem && styles.chipDisabled]}
                disabled={!!selectedExistingItem}
                onPress={() => navigation.navigate('BarcodeScanner')}
              >
                <Text style={styles.scanButtonText}>Scan</Text>
              </TouchableOpacity>
            </View>
            {errors.item_id ? (
              <Text style={styles.errorText}>{errors.item_id}</Text>
            ) : null}
            {!selectedExistingItem && form.item_id.trim().length >= 1 && suggestions.length > 0 ? (
              <View style={styles.suggestionPanel}>
                {suggestions.map((item) => (
                  <TouchableOpacity key={`sku-${item.itemId}`} style={styles.suggestionRow} onPress={() => applyInventorySuggestion(item)}>
                    <Text style={styles.suggestionName}>{item.itemId}</Text>
                    <Text style={styles.suggestionMeta}>{item.name} · {item.category || 'Uncategorised'} · {item.unit}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <Text style={styles.suggestionMeta}>Type SKU or name — both fields search previously received inventory.</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Item Name *</Text>
            <TextInput
              style={[styles.input, errors.item_name && styles.inputError]}
              placeholder="Type name or search previously received SKUs…"
              value={form.item_name}
              onChangeText={(v) => {
                setSuggestionField('item_name');
                if (selectedExistingItem && v.toLowerCase() !== selectedExistingItem.name.toLowerCase()) {
                  setSelectedExistingItem(null);
                  setForm((prev) => ({ ...prev, item_id: '', item_name: v }));
                } else {
                  handleChange('item_name', v);
                }
              }}
              autoCapitalize="words"
            />
            {suggestionLoading ? <Text style={styles.suggestionMeta}>Searching existing inventory…</Text> : null}
            {suggestionError ? <Text style={styles.errorText}>{suggestionError}</Text> : null}
            {suggestions.length > 0 ? (
              <View style={styles.suggestionPanel}>
                {suggestions.map((item) => (
                  <TouchableOpacity key={item.itemId} style={styles.suggestionRow} onPress={() => applyInventorySuggestion(item)}>
                    <Text style={styles.suggestionName}>{item.name}</Text>
                    <Text style={styles.suggestionMeta}>{item.itemId} · {item.category || 'Uncategorised'} · {item.unit}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {(form.item_name.trim().length > 1 || form.item_id.trim().length > 1) && !suggestionLoading && suggestions.length === 0 && !selectedExistingItem ? (
              <Text style={styles.suggestionMeta}>No existing match. Confirm the item ID, category, and unit before receiving a new SKU.</Text>
            ) : null}
            {selectedExistingItem ? (
              <Text style={styles.suggestionMeta}>Existing inventory item selected. This receipt will reuse SKU {selectedExistingItem.itemId}; unit is locked to preserve stock history.</Text>
            ) : null}
            {errors.item_name ? (
              <Text style={styles.errorText}>{errors.item_name}</Text>
            ) : null}
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Category group</Text>
            <View style={styles.chipRow}>
              {INGREDIENT_CATEGORY_GROUPS.map((g) => {
                const selected = categoryGroup === g.group;
                return (
                  <TouchableOpacity
                    key={g.group}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => {
                      setCategoryGroup(g.group);
                      const first = g.items[0];
                      if (first) handleChange('category', first);
                    }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {g.group}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Category *</Text>
            <View style={styles.chipRow}>
              {leafOptions.map((c) => {
                const selected = form.category === c;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => handleChange('category', c)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {c}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {errors.category ? (
              <Text style={styles.errorText}>{errors.category}</Text>
            ) : null}
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Units *</Text>
            <View style={styles.chipRow}>
              {INVENTORY_UNITS.map((u) => {
                const selected = form.units === u;
                return (
                  <TouchableOpacity
                    key={u}
                    style={[styles.chip, selected && styles.chipSelected, selectedExistingItem && styles.chipDisabled]}
                    disabled={!!selectedExistingItem}
                    onPress={() => handleChange('units', u)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {u}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {errors.units ? (
              <Text style={styles.errorText}>{errors.units}</Text>
            ) : null}
          </View>

          <View style={styles.rowGroup}>
            <View style={styles.half}>
              <Text style={[typography.small, { marginBottom: spacing.sm }]}>
              Reorder point defaults to ~20% of approved qty when not set.
            </Text>
            <Text style={typography.label}>Quantity Received *</Text>
              <TextInput
                style={[styles.input, errors.quantity && styles.inputError]}
                placeholder="50"
                value={form.quantity}
                onChangeText={(v) => handleChange('quantity', v)}
                keyboardType="decimal-pad"
              />
              {errors.quantity ? (
                <Text style={styles.errorText}>{errors.quantity}</Text>
              ) : null}
            </View>
            <View style={styles.half}>
              <Text style={typography.label}>Quantity Approved</Text>
              <TextInput
                style={styles.input}
                placeholder="Defaults to received"
                value={form.quantity_approved}
                onChangeText={(v) => handleChange('quantity_approved', v)}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Quantity Rejected</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              value={form.quantity_rejected}
              onChangeText={(v) => handleChange('quantity_rejected', v)}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.rowGroup}>
            <View style={styles.half}>
              <Text style={typography.label}>Date Received *</Text>
              <TextInput
                style={[
                  styles.input,
                  errors.date_received && styles.inputError,
                ]}
                placeholder="YYYY-MM-DD"
                value={form.date_received}
                onChangeText={(v) => handleChange('date_received', v)}
              />
              {errors.date_received ? (
                <Text style={styles.errorText}>{errors.date_received}</Text>
              ) : null}
            </View>
            <View style={styles.half}>
              <Text style={typography.label}>Expiry Date *</Text>
              <TextInput
                style={[styles.input, errors.expiry_date && styles.inputError]}
                placeholder="YYYY-MM-DD"
                value={form.expiry_date}
                onChangeText={(v) => handleChange('expiry_date', v)}
              />
              {errors.expiry_date ? (
                <Text style={styles.errorText}>{errors.expiry_date}</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.rowGroup}>
            <View style={styles.half}>
              <Text style={typography.label}>Unit Cost (KES) *</Text>
              <TextInput
                style={[styles.input, errors.unit_cost && styles.inputError]}
                placeholder="6.8"
                value={form.unit_cost}
                onChangeText={(v) => handleChange('unit_cost', v)}
                keyboardType="decimal-pad"
              />
              {errors.unit_cost ? (
                <Text style={styles.errorText}>{errors.unit_cost}</Text>
              ) : null}
            </View>
            <View style={styles.half}>
              <Text style={typography.label}>Total Cost (KES)</Text>
              <TextInput
                style={styles.input}
                placeholder="Auto-calculated"
                value={form.total_cost}
                editable={false}
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Supplier</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Supplier Name"
                value={form.supplier_name}
                onChangeText={(v) => handleChange('supplier_name', v)}
              />
              <TextInput
                style={[styles.input, { flex: 1, marginLeft: spacing.sm }]}
                placeholder="Number"
                value={form.supplier_number}
                onChangeText={(v) => handleChange('supplier_number', v)}
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Approved By</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. DONDO"
              value={form.approved_by}
              onChangeText={(v) => handleChange('approved_by', v)}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Batch Number *</Text>
            <TextInput
              style={[styles.input, errors.batch_number && styles.inputError]}
              placeholder="BATCH-2026-001"
              value={form.batch_number}
              onChangeText={(v) => handleChange('batch_number', v)}
              autoCapitalize="characters"
            />
            {errors.batch_number ? (
              <Text style={styles.errorText}>{errors.batch_number}</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.button, isSubmitting && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Submit Receive</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  suggestionPanel: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, marginTop: spacing.xs, overflow: 'hidden' },
  suggestionRow: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  suggestionName: { color: colors.textPrimary, fontWeight: '700' },
  suggestionMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  chipDisabled: { opacity: 0.55 },
  form: { marginTop: spacing.md },
  formGroup: { marginBottom: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowGroup: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  half: { flex: 1 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  inputError: { borderColor: colors.danger, borderWidth: 2 },
  scanButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    justifyContent: 'center',
  },
  scanButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  errorText: { color: colors.danger, fontSize: 14, marginTop: spacing.xs },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  pendingBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    padding: spacing.sm,
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
  },
  pendingCount: { color: colors.textSecondary, fontSize: 14 },
  retryText: { color: colors.primary, fontWeight: 'bold' },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#fff',
  },
});

