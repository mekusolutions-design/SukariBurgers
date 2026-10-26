// apps/mobile/src/screens/menu/MenuListScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useRole } from '../../hooks/useRole';
import { colors, spacing, typography } from '../../lib/theme';
import { useMenuStore, type MenuItem } from '../../features/menu/menuStore';
import { getSocket } from '../../lib/socket';
import { useAuthStore } from '../../features/auth/authStore';
import apiClient from '../../api/apiClient';
import { API_ENDPOINTS } from '../../api/endpoints';
import type { RootNavigationProp } from '../../types/navigation';

type EditableLine = {
  key: string;
  componentType: 'FIXED' | 'INVENTORY' | 'CHOICE' | 'MULTI_CHOICE';
  itemId: string;
  itemName: string;
  quantity: string;
  unit: string;
  unitCost: number;
};

type SkuSuggestion = { itemId: string; name: string; category: string; unit: string; avgUnitCost: number };

type AvailabilityUpdate = {
  menu_id: string;
  available_quantity: number;
};

export default function MenuListScreen() {
  const navigation = useNavigation<RootNavigationProp>();
  const { isAdmin } = useRole();
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const {
    pendingMenus,
    menuItems,
    syncStatus,
    syncError,
    syncPending,
    retryFailedSync,
    getPendingCount,
    fetchMenus,
  } = useMenuStore();

  const [refreshing, setRefreshing] = useState(false);
  const [liveAvailability, setLiveAvailability] = useState<
    Record<string, number>
  >({});
  const [connected, setConnected] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editMenuCode, setEditMenuCode] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editTaxRate, setEditTaxRate] = useState('16');
  const [editActive, setEditActive] = useState(true);
  const [editLines, setEditLines] = useState<EditableLine[]>([]);
  const [lineSearches, setLineSearches] = useState<Record<string, string>>({});
  const [lineSuggestions, setLineSuggestions] = useState<Record<string, SkuSuggestion[]>>({});
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    fetchMenus();
  }, [fetchMenus]);

  useEffect(() => {
    if (!isAuthenticated || !token) return;

    const socket = getSocket('/menu');

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onAvailability = (data: AvailabilityUpdate) => {
      if (!data?.menu_id) return;
      setLiveAvailability((prev) => ({
        ...prev,
        [data.menu_id]: data.available_quantity,
      }));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('menu_availability_updated', onAvailability);

    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('menu_availability_updated', onAvailability);
    };
  }, [token, isAuthenticated]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([syncPending(), fetchMenus()]);
    setRefreshing(false);
  }, [syncPending, fetchMenus]);

  // Show server list + any pending (not yet synced) items
  const listData = useMemo(() => {
    const pendingCodes = new Set(pendingMenus.map((p) => p.menu_code));
    const server = menuItems.filter((m) => !pendingCodes.has(m.menu_code));
    return [...pendingMenus, ...server];
  }, [pendingMenus, menuItems]);

  function openAdjust(item: MenuItem) {
    const rawLines = Array.isArray(item.lines) ? item.lines : [];
    const lines: EditableLine[] = rawLines.map((raw, index) => {
      const line = raw as Record<string, unknown>;
      const componentTypeRaw = String(line.componentType ?? line.component_type ?? 'FIXED').toUpperCase();
      const componentType = (['FIXED', 'INVENTORY', 'CHOICE', 'MULTI_CHOICE'].includes(componentTypeRaw) ? componentTypeRaw : 'FIXED') as EditableLine['componentType'];
      const options = Array.isArray(line.options) ? line.options as Record<string, unknown>[] : [];
      return {
        key: String(line.componentKey ?? line.component_key ?? `component-${index + 1}`),
        componentType,
        itemId: String(line.finishedGoodId ?? line.finished_good_id ?? options.map((o) => String(o.finishedGoodId ?? o.finished_good_id ?? o.itemId ?? '')).filter(Boolean).join(',') ?? ''),
        itemName: String(line.finishedGoodName ?? line.finished_good_name ?? options.map((o) => String(o.finishedGoodName ?? o.finished_good_name ?? o.name ?? '')).filter(Boolean).join(', ') ?? ''),
        quantity: String(line.quantityRequired ?? line.quantity_required ?? 1),
        unit: String(line.unit ?? 'pcs'),
        unitCost: Number(line.unitCost ?? line.unit_cost ?? 0),
      };
    });
    if (lines.length === 0) {
      lines.push({
        key: 'component-1', componentType: 'FIXED',
        itemId: String(item.finished_good_id ?? ''),
        itemName: String(item.finished_good_name ?? ''),
        quantity: String(item.quantity_required ?? 1),
        unit: String(item.unit ?? 'pcs'), unitCost: 0,
      });
    }
    setEditItem(item);
    setEditName(item.name);
    setEditMenuCode(String(item.menu_code ?? ''));
    setEditCategory(String(item.category ?? ''));
    setEditPrice(String(item.selling_price ?? 0));
    setEditTaxRate(String(item.tax_rate ?? 16));
    setEditActive(item.is_visible !== false && item.is_available !== false);
    setEditLines(lines);
    setLineSearches({});
    setLineSuggestions({});
    setEditError(null);
  }

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const controllers: AbortController[] = [];
    for (const [lineKey, query] of Object.entries(lineSearches)) {
      const q = String(query).trim();
      if (q.length < 1) {
        setLineSuggestions((previous) => ({ ...previous, [lineKey]: [] }));
        continue;
      }
      const controller = new AbortController();
      controllers.push(controller);
      timers.push(setTimeout(async () => {
        try {
          const response = await apiClient.get(API_ENDPOINTS.INVENTORY_SUGGEST, {
            params: { q, limit: 8 },
            signal: controller.signal,
          });
          const root = (response.data ?? {}) as Record<string, unknown>;
          const rows = Array.isArray(root.items) ? root.items as Record<string, unknown>[] : [];
          const mapped = rows.map((row) => ({
            itemId: String(row.itemId ?? row.item_id ?? ''),
            name: String(row.name ?? row.itemName ?? row.item_id ?? ''),
            category: String(row.category ?? ''),
            unit: String(row.unit ?? row.units ?? 'pcs'),
            avgUnitCost: Number(row.avgUnitCost ?? row.avg_unit_cost ?? 0),
          })).filter((row) => row.itemId);
          if (!cancelled && !controller.signal.aborted) setLineSuggestions((previous) => ({ ...previous, [lineKey]: mapped }));
        } catch {
          if (!cancelled && !controller.signal.aborted) setLineSuggestions((previous) => ({ ...previous, [lineKey]: [] }));
        }
      }, 200));
    }
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      controllers.forEach((controller) => controller.abort());
    };
  }, [lineSearches]);

  function updateEditLine(key: string, patch: Partial<EditableLine>) {
    setEditLines((previous) => previous.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  async function saveAdjust(allowDuplicate = false) {
    if (!editItem?.menu_id) { setEditError('This pending/offline item cannot be adjusted until it has synced.'); return; }
    const price = Number(editPrice);
    if (!editName.trim()) { setEditError('Name is required.'); return; }
    if (!Number.isFinite(price) || price < 0) { setEditError('Selling price must be zero or more.'); return; }
    const tax = Number(editTaxRate);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) { setEditError('Tax rate must be between 0 and 100.'); return; }
    if (editLines.length === 0 || editLines.some((line) => !line.itemId.trim() || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || !line.unit.trim())) {
      setEditError('Every component needs an item, a positive quantity, and a unit.'); return;
    }
    const duplicate = listData.some((row) => row.menu_id !== editItem.menu_id && row.is_visible !== false && row.name.trim().toLowerCase() === editName.trim().toLowerCase());
    if (duplicate && !allowDuplicate) {
      Alert.alert('Duplicate menu name', `Another menu item is named ${editName.trim()}. You can still save it.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save anyway', onPress: () => void saveAdjust(true) },
      ]);
      return;
    }
    setEditBusy(true); setEditError(null);
    try {
      await apiClient.patch(`/menu/${encodeURIComponent(editItem.menu_id)}/adjust`, {
        name: editName.trim(),
        menu_code: editMenuCode.trim() || null,
        category: editCategory.trim() || null,
        selling_price: price,
        tax_rate: Number(editTaxRate),
        is_available: editActive,
        is_visible: editActive,
        expected_updated_at: editItem.updated_at ?? editItem.updatedAt ?? editItem.created_at ?? editItem.createdAt ?? null,
        lines: editLines.map((line, index) => line.componentType === 'CHOICE' || line.componentType === 'MULTI_CHOICE'
          ? { component_key: line.key || `component-${index + 1}`, component_type: line.componentType, option_item_ids: line.itemId.split(',').map((value) => value.trim()).filter(Boolean), quantity_required: Number(line.quantity), unit: line.unit }
          : { component_key: line.key || `component-${index + 1}`, component_type: line.componentType, finished_good_id: line.itemId.trim(), finished_good_name: line.itemName.trim() || undefined, quantity_required: Number(line.quantity), unit: line.unit }),
      });
      await fetchMenus();
      setEditItem(null);
      Alert.alert('Menu item adjusted', 'Changes apply to new orders and future consumption only. Existing order prices and historical production are unchanged.');
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { message?: string | string[] } }; message?: string };
      if (err.response?.status === 409) setEditError('This item changed after you opened it. Close and reopen Adjust to review the latest version.');
      else { const raw = err.response?.data?.message; setEditError(Array.isArray(raw) ? raw.join(', ') : raw || err.message || 'Could not save menu changes.'); }
    } finally { setEditBusy(false); }
  }

  const editCost = editLines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0) * Math.max(0, line.unitCost || 0), 0);
  const editSellingPrice = Number(editPrice) || 0;
  const editMargin = editSellingPrice - editCost;
  const editMarginPct = editSellingPrice > 0 ? (editMargin / editSellingPrice) * 100 : null;

  const renderItem = ({ item }: { item: MenuItem }) => {
    const key = item.menu_id || item.menu_code;
    const available =
      liveAvailability[key] ??
      liveAvailability[item.menu_code] ??
      item.available_quantity ??
      (item.is_available ? 1 : 0);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.menuName}>{item.name}</Text>
          <Text style={styles.price}>
            KES {Number(item.selling_price).toLocaleString('en-KE')}
          </Text>
        </View>
        <Text style={styles.category}>{item.category || 'Uncategorized'}</Text>

        <Text
          style={[
            styles.status,
            { color: available > 0 ? colors.success : colors.danger },
          ]}
        >
          Available: {available}
          {available === 0 ? ' (Out of Stock)' : ''}
          {!item.menu_id ? ' · Pending sync' : ''}
        </Text>

        {item.preparation_time_minutes ? (
          <Text style={styles.info}>
            Prep: {item.preparation_time_minutes} min
          </Text>
        ) : null}
        {isAdmin && item.menu_id ? (
          <TouchableOpacity style={styles.adjustButton} onPress={() => openAdjust(item)} accessibilityRole="button">
            <Text style={styles.adjustButtonText}>Adjust</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={typography.title}>Menu Items (Live)</Text>
        <Text
          style={[
            styles.connection,
            { color: connected ? colors.success : colors.danger },
          ]}
        >
          {connected ? '● LIVE' : '○ Offline'}
        </Text>
      </View>

      {syncStatus !== 'idle' && (
        <View
          style={[
            styles.syncBanner,
            syncStatus === 'syncing' && styles.syncBannerSyncing,
            syncStatus === 'success' && styles.syncBannerSuccess,
            syncStatus === 'error' && styles.syncBannerError,
          ]}
        >
          <Text style={styles.syncText}>
            {syncStatus === 'syncing'
              ? `Syncing ${getPendingCount()} menu item(s)...`
              : syncStatus === 'success'
                ? '✅ Synced successfully!'
                : `❌ ${syncError || 'Sync failed'}`}
          </Text>
          {syncStatus === 'error' && (
            <TouchableOpacity onPress={retryFailedSync}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        data={listData}
        keyExtractor={(item, index) =>
          item.menu_id || item.menu_code || String(index)
        }
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={
          listData.length === 0 ? styles.emptyList : undefined
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No menu items yet</Text>
            <Text style={styles.emptySubText}>Create your first menu item</Text>
          </View>
        }
      />

      {isAdmin && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('CreateMenu')}
        >
          <Text style={styles.fabText}>+ New Menu Item</Text>
        </TouchableOpacity>
      )}

      <Modal visible={!!editItem} animationType="slide" onRequestClose={() => !editBusy && setEditItem(null)}>
        <View style={styles.editModal}>
          <Text style={typography.title}>Adjust menu item</Text>
          <Text style={styles.info}>Name, price and recipe components. New prices and component quantities apply to future orders/consumption only.</Text>
          {editError ? <Text style={styles.editError}>{editError}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.xl }}>
            <Text style={styles.editLabel}>Name *</Text>
            <TextInput style={styles.editInput} value={editName} onChangeText={setEditName} placeholder="Menu item name" />
            <Text style={styles.editLabel}>Menu code</Text>
            <TextInput style={styles.editInput} value={editMenuCode} onChangeText={setEditMenuCode} placeholder="Optional code" autoCapitalize="characters" />
            <Text style={styles.editLabel}>POS category</Text>
            <TextInput style={styles.editInput} value={editCategory} onChangeText={setEditCategory} placeholder="Mains, Combos…" />
            <Text style={styles.editLabel}>Selling price (KES) *</Text>
            <TextInput style={styles.editInput} value={editPrice} onChangeText={setEditPrice} keyboardType="decimal-pad" placeholder="0.00" />
            <Text style={styles.editLabel}>Tax rate (%)</Text>
            <TextInput style={styles.editInput} value={editTaxRate} onChangeText={setEditTaxRate} keyboardType="decimal-pad" placeholder="16" />
            <TouchableOpacity style={styles.activeToggle} onPress={() => setEditActive((value) => !value)}>
              <Text style={styles.activeToggleText}>{editActive ? '● Active / visible' : '○ Inactive / hidden'} (tap to toggle)</Text>
            </TouchableOpacity>
            <Text style={styles.editSectionTitle}>Recipe components</Text>
            {editLines.map((line, index) => (
              <View key={line.key} style={styles.editLine}>
                <Text style={styles.editLabel}>Component {index + 1}</Text>
                <TextInput style={styles.editInput} value={line.itemName} placeholder="Search inventory item / SKU" onChangeText={(value) => { updateEditLine(line.key, { itemName: value, itemId: '', componentType: 'INVENTORY' }); setLineSearches((previous) => ({ ...previous, [line.key]: value })); }} />
                {(lineSearches[line.key] ?? '').length > 0 && (lineSuggestions[line.key] ?? []).length > 0 ? (
                  <View style={styles.skuSuggestionPanel}>
                    {(lineSuggestions[line.key] ?? []).map((suggestion) => (
                      <TouchableOpacity key={suggestion.itemId} style={styles.skuSuggestion} onPress={() => { updateEditLine(line.key, { itemId: suggestion.itemId, itemName: suggestion.name, unit: suggestion.unit || 'pcs', unitCost: suggestion.avgUnitCost, componentType: 'INVENTORY' }); setLineSearches((previous) => ({ ...previous, [line.key]: '' })); setLineSuggestions((previous) => ({ ...previous, [line.key]: [] })); }}>
                        <Text style={styles.skuSuggestionName}>{suggestion.name}</Text>
                        <Text style={styles.info}>{suggestion.itemId} · {suggestion.unit} · KES {suggestion.avgUnitCost.toFixed(2)}/{suggestion.unit}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
                <View style={styles.editLineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.editLabel}>Quantity *</Text>
                    <TextInput style={styles.editInput} value={line.quantity} onChangeText={(value) => updateEditLine(line.key, { quantity: value })} keyboardType="decimal-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.editLabel}>Unit</Text>
                    <TextInput style={styles.editInput} value={line.unit} editable={line.componentType !== 'INVENTORY'} onChangeText={(value) => updateEditLine(line.key, { unit: value })} />
                  </View>
                  <TouchableOpacity style={styles.removeLineButton} onPress={() => { if (editLines.length <= 1) { setEditError('At least one recipe component must remain.'); return; } setEditLines((previous) => previous.filter((row) => row.key !== line.key)); }}>
                    <Text style={styles.removeLineText}>×</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.addLineButton} onPress={() => setEditLines((previous) => [...previous, { key: `component-${Date.now()}`, componentType: 'INVENTORY', itemId: '', itemName: '', quantity: '1', unit: 'pcs', unitCost: 0 }])}>
              <Text style={styles.addLineText}>+ Add component</Text>
            </TouchableOpacity>
            <View style={styles.costCard}>
              <Text style={styles.costLine}>Estimated component cost: KES {editCost.toFixed(2)}</Text>
              <Text style={styles.costLine}>Estimated margin: KES {editMargin.toFixed(2)}{editMarginPct == null ? '' : ` (${editMarginPct.toFixed(1)}%)`}</Text>
              <Text style={styles.info}>Cost is an estimate from selected inventory unit costs; confirm server-calculated costing after saving.</Text>
            </View>
          </ScrollView>
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.cancelEditButton} disabled={editBusy} onPress={() => setEditItem(null)}><Text style={styles.cancelEditText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={styles.saveEditButton} disabled={editBusy} onPress={() => void saveAdjust()}>{editBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveEditText}>Save changes</Text>}</TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  connection: { fontWeight: 'bold', fontSize: 14 },
  adjustButton: { alignSelf: 'flex-start', marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 8, backgroundColor: colors.primary },
  adjustButtonText: { color: '#fff', fontWeight: '700' },
  editModal: { flex: 1, backgroundColor: colors.background, padding: spacing.md, paddingTop: spacing.xl },
  editLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.sm },
  editInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: spacing.md, color: colors.textPrimary },
  editError: { color: colors.danger, marginVertical: spacing.sm },
  activeToggle: { paddingVertical: spacing.md },
  activeToggleText: { color: colors.primary, fontWeight: '700' },
  editSectionTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  editLine: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.sm, marginBottom: spacing.md },
  editLineRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  skuSuggestionPanel: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: spacing.xs, overflow: 'hidden' },
  skuSuggestion: { padding: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  skuSuggestionName: { color: colors.textPrimary, fontWeight: '700' },
  removeLineButton: { padding: spacing.sm, backgroundColor: colors.danger, borderRadius: 8, marginBottom: spacing.xs },
  removeLineText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  addLineButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 9, padding: spacing.md, alignItems: 'center', marginVertical: spacing.sm },
  addLineText: { color: colors.primary, fontWeight: '700' },
  costCard: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.border },
  costLine: { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.xs },
  editActions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  cancelEditButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: spacing.md, alignItems: 'center' },
  cancelEditText: { color: colors.textPrimary, fontWeight: '700' },
  saveEditButton: { flex: 2, backgroundColor: colors.primary, borderRadius: 9, padding: spacing.md, alignItems: 'center' },
  saveEditText: { color: '#fff', fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuName: { ...typography.body, fontWeight: '600' },
  price: { ...typography.body, color: colors.primary, fontWeight: '600' },
  category: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  status: { ...typography.small, marginTop: spacing.sm, fontWeight: '600' },
  info: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  emptyList: { flexGrow: 1 },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: { ...typography.body, color: colors.textSecondary },
  emptySubText: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  fab: {
    position: 'absolute',
    bottom: spacing.xl * 1.5,
    right: spacing.lg,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  syncBanner: {
    padding: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  syncBannerSyncing: { backgroundColor: '#FFF3CD' },
  syncBannerSuccess: { backgroundColor: '#D4EDDA' },
  syncBannerError: { backgroundColor: '#F8D7DA' },
  syncText: { fontSize: 14, fontWeight: '500', flex: 1 },
  retryText: { color: colors.primary, fontWeight: 'bold' },
});