// apps/mobile/src/components/production/RecipeSearchPicker.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import apiClient from '../../api/apiClient';
import { API_ENDPOINTS } from '../../api/endpoints';
import { colors, spacing, typography } from '../../lib/theme';

export type RecipePick = {
  recipeId: string;
  itemId: string;
  name: string;
  unit: string;
  standardYield: number;
  maxPortions?: number | null;
  isAvailable?: boolean;
};

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function normalizeRecipe(row: Record<string, unknown>): RecipePick | null {
  const recipeId = asString(
    row.recipeId ?? row.recipe_id ?? row.id ?? row.recipe_code,
  );
  const itemId = asString(row.itemId ?? row.item_id ?? row.menuItemId);
  const name = asString(
    (row.name ?? row.item_name ?? row.itemName ?? itemId) || recipeId,
  );
  if (!recipeId) return null;
  return {
    recipeId,
    itemId: itemId || recipeId,
    name: name || recipeId,
    unit: asString(row.unit ?? row.yield_unit ?? row.yieldUnit, 'pcs'),
    standardYield: asNumber(
      row.standardYield ?? row.standard_yield ?? row.yield_quantity,
      1,
    ),
    maxPortions:
      row.maxPortionsFromStock != null || row.max_portions != null
        ? asNumber(row.maxPortionsFromStock ?? row.max_portions)
        : null,
    isAvailable:
      row.isAvailable != null || row.is_available != null
        ? Boolean(row.isAvailable ?? row.is_available)
        : undefined,
  };
}

type Props = {
  value: RecipePick | null;
  onChange: (recipe: RecipePick | null) => void;
  shopId?: string;
};

/**
 * Searchable recipe list for Start Production (parity with web SearchableSelect).
 * Loads GET /recipe and filters client-side by name / SKU / recipe id.
 */
export function RecipeSearchPicker({ value, onChange, shopId = '1' }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<RecipePick[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await apiClient.get(API_ENDPOINTS.RECIPE_LIST, {
          params: { shopId },
        });
        const root = (data ?? {}) as Record<string, unknown>;
        const raw = Array.isArray(data)
          ? data
          : Array.isArray(root.items)
            ? root.items
            : Array.isArray(root.data)
              ? root.data
              : [];
        const mapped = (raw as Record<string, unknown>[])
          .map(normalizeRecipe)
          .filter((x): x is RecipePick => x != null);
        if (!cancelled) setItems(mapped);
      } catch (e: unknown) {
        if (!cancelled) {
          setItems([]);
          setError(e instanceof Error ? e.message : 'Failed to load recipes');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.itemId.toLowerCase().includes(q) ||
        r.recipeId.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.8}
      >
        <Text
          style={[styles.triggerText, !value && styles.placeholder]}
          numberOfLines={1}
        >
          {value
            ? `${value.name} (${value.itemId})`
            : 'Select a recipe…'}
        </Text>
        <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {open ? (
        <View style={styles.panel}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, SKU, or recipe id…"
            placeholderTextColor={colors.textSecondary}
            autoFocus
          />
          {loading ? (
            <ActivityIndicator style={{ margin: spacing.md }} color={colors.primary} />
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.recipeId}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={
                <Text style={styles.empty}>No recipes match</Text>
              }
              renderItem={({ item }) => {
                const selected = value?.recipeId === item.recipeId;
                return (
                  <TouchableOpacity
                    style={[styles.row, selected && styles.rowOn]}
                    onPress={() => {
                      onChange(item);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {item.itemId}
                        {item.maxPortions != null
                          ? ` · max ${item.maxPortions} ${item.unit}`
                          : ` · ${item.unit}`}
                        {item.isAvailable === false ? ' · low stock' : ''}
                      </Text>
                    </View>
                    {selected ? (
                      <Text style={styles.check}>✓</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />
          )}
          {value ? (
            <TouchableOpacity
              style={styles.clear}
              onPress={() => {
                onChange(null);
                setQuery('');
              }}
            >
              <Text style={styles.clearText}>Clear selection</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 20 },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  triggerText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  placeholder: { color: colors.textSecondary },
  chevron: { color: colors.textSecondary, marginLeft: spacing.sm },
  panel: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    maxHeight: 320,
  },
  search: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.textPrimary,
  },
  list: { maxHeight: 240 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowOn: { backgroundColor: '#E8F1FC' },
  rowTitle: { fontWeight: '600', color: colors.textPrimary, fontSize: 15 },
  rowMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  check: { color: colors.primary, fontWeight: '700', marginLeft: spacing.sm },
  empty: {
    padding: spacing.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  error: { padding: spacing.md, color: colors.danger },
  clear: { padding: spacing.sm, alignItems: 'center' },
  clearText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
