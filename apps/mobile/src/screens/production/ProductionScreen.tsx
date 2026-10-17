import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../features/auth/authStore';
import { useRole } from '../../hooks/useRole';
import { useProductionStore, type ProductionQueueItem } from '../../features/production/productionStore';
import { useOfflineStore } from '../../features/offline/offlineStore';
import { getSocket } from '../../lib/socket';
import apiClient from '../../api/apiClient';
import { RecipeSearchPicker, type RecipePick } from '../../components/production/RecipeSearchPicker';
import { colors, spacing, typography } from '../../lib/theme';
import type { RootNavigationProp } from '../../types/navigation';

type LineDraft = { item_id: string; item_name: string; unit: string; standard_quantity: number; actual: string; unit_cost?: number; unit_weight?: number; weight_unit?: string };
type RecipeDetails = { item_id: string; item_name: string; yield_quantity: number; yield_unit: string; ingredients: LineDraft[]; outputs: LineDraft[] };
type ApiRow = Record<string, unknown>;
const asNum = (v: unknown, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const asText = (v: unknown, fallback = '') => v == null ? fallback : String(v);
const calculatedYield = (lines: LineDraft[], unit: string) => {
  let massKg = 0; let hasWeight = false; let pieceSum = 0;
  for (const line of lines) {
    const qty = asNum(line.actual, 0);
    if (!Number.isFinite(qty) || qty < 0) continue;
    pieceSum += qty;
    if (line.unit_weight != null && line.unit_weight > 0 && qty > 0) {
      hasWeight = true; const wu = (line.weight_unit || 'g').toLowerCase();
      massKg += (wu === 'kg' || wu === 'l') ? qty * line.unit_weight : (qty * line.unit_weight) / 1000;
    }
  }
  if (hasWeight && massKg > 0) { const u = (unit || 'pcs').toLowerCase(); if (u === 'g' || u === 'ml') return massKg * 1000; if (u === 'kg' || u === 'l') return massKg; return massKg; }
  return pieceSum;
};
const unwrap = (data: unknown): ApiRow => {
  const root = (data ?? {}) as ApiRow;
  const inner = root.data && typeof root.data === 'object' ? root.data as ApiRow : root;
  return inner.recipe && typeof inner.recipe === 'object' ? inner.recipe as ApiRow : inner;
};

export default function ProductionScreen() {
  const navigation = useNavigation<RootNavigationProp>();
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { isKitchen, isManager, isAdmin } = useRole();
  const canStartProduction = isKitchen || isManager || isAdmin;
  const { startProduction, finishProduction, isSubmitting, getPendingCount, queue, queueLoading, queueError, fetchQueue, history, historyError, fetchHistory } = useProductionStore();
  const offlinePendingCount = useOfflineStore((s) => s.queue.filter((q) => q.module === 'production').length);
  const pendingCount = Math.max(offlinePendingCount, getPendingCount());
  const [selectedRecipe, setSelectedRecipe] = useState<RecipePick | null>(null);
  const [plannedQuantity, setPlannedQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [finishTarget, setFinishTarget] = useState<ProductionQueueItem | null>(null);
  const [finishLoading, setFinishLoading] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [recipeDetails, setRecipeDetails] = useState<RecipeDetails | null>(null);
  const [actualYield, setActualYield] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [wasteQuantity, setWasteQuantity] = useState('0');
  const [wasteReason, setWasteReason] = useState('');
  const [finishNotes, setFinishNotes] = useState('');
  const [inputLines, setInputLines] = useState<LineDraft[]>([]);
  const [outputLines, setOutputLines] = useState<LineDraft[]>([]);

  const refreshProduction = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([fetchQueue(), fetchHistory()]); }
    finally { setRefreshing(false); }
  }, [fetchQueue, fetchHistory]);

  useFocusEffect(useCallback(() => { void fetchQueue(); void fetchHistory(); return undefined; }, [fetchQueue, fetchHistory]));

  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const socket = getSocket('/production');
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onUpdate = () => { void fetchQueue(); void fetchHistory(); };
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect);
    socket.on('production_updated', onUpdate); socket.on('production_started', onUpdate);
    socket.on('production_finished', onUpdate); socket.on('production_completed', onUpdate);
    if (socket.connected) setConnected(true);
    return () => {
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect);
      socket.off('production_updated', onUpdate); socket.off('production_started', onUpdate);
      socket.off('production_finished', onUpdate); socket.off('production_completed', onUpdate);
    };
  }, [isAuthenticated, token, fetchQueue, fetchHistory]);

  useEffect(() => {
    if (!finishTarget) return;
    let cancelled = false;
    const load = async () => {
      setFinishLoading(true); setFinishError(''); setRecipeDetails(null);
      setBatchNumber(''); setExpiryDate(''); setWasteQuantity('0'); setWasteReason(''); setFinishNotes('');
      try {
        if (!finishTarget.recipe_id) throw new Error('This batch has no recipe ID. Ask a manager to check the production record.');
        const response = await apiClient.get(`/recipe/${encodeURIComponent(finishTarget.recipe_id)}`);
        const raw = unwrap(response.data);
        const planned = Math.max(0, finishTarget.planned_quantity || 0);
        const yieldQty = asNum(raw.standardYield ?? raw.standard_yield ?? raw.yieldQuantity ?? raw.yield_quantity, 1) || 1;
        const scale = planned / yieldQty;
        const rawInputs = Array.isArray(raw.ingredients) ? raw.ingredients as ApiRow[] : [];
        const rawOutputs = Array.isArray(raw.outputs) ? raw.outputs as ApiRow[] : [];
        let ingredients: LineDraft[] = rawInputs.map((r) => {
          const standard = asNum(r.quantityPerUnit ?? r.quantity_per_unit ?? r.quantity, 0) * scale;
          return { item_id: asText(r.rawItemId ?? r.raw_item_id ?? r.item_id), item_name: asText(r.name ?? r.rawItemName ?? r.raw_item_name ?? r.item_name ?? r.rawItemId ?? r.raw_item_id), unit: asText(r.unit, 'pcs'), standard_quantity: standard, actual: String(standard), unit_cost: asNum(r.unitCost ?? r.unit_cost, 0) };
        }).filter((r) => r.item_id);
        // Match the web finish workflow: prefer current WAC for ingredient costing.
        if (ingredients.length) {
          try {
            const itemIds = [...new Set(ingredients.map((line) => line.item_id.trim()).filter(Boolean))];
            const { data: costingData } = await apiClient.get('/costing/sku-costs', {
              params: { shopId: '1', itemIds: itemIds.join(',') },
            });
            const costingRoot = (costingData ?? {}) as ApiRow;
            const costs = (costingRoot.costs ?? {}) as Record<string, unknown>;
            ingredients = ingredients.map((line) => {
              const wac = asNum(costs[line.item_id.trim()], 0);
              return wac > 0 ? { ...line, unit_cost: wac } : line;
            });
          } catch { /* Keep recipe-provided costs when WAC lookup is unavailable, as web does. */ }
        }
        const primaryItemId = asText(raw.itemId ?? raw.item_id ?? raw.menuItemId ?? finishTarget.item_id);
        const primaryItemName = asText(raw.name ?? raw.item_name ?? finishTarget.item_name);
        const outputs: LineDraft[] = rawOutputs.map((r) => {
          const standardBase = asNum(r.standardQuantity ?? r.standard_quantity, yieldQty);
          const standard = standardBase * scale;
          return { item_id: asText(r.itemId ?? r.item_id), item_name: asText(r.itemName ?? r.item_name ?? r.name ?? r.itemId ?? r.item_id), unit: asText(r.unit, asText(raw.unit ?? raw.yieldUnit ?? raw.yield_unit, 'pcs')), standard_quantity: standard, actual: String(standard), unit_cost: asNum(r.unitCost ?? r.unit_cost, 0), unit_weight: asNum(r.unitWeight ?? r.unit_weight, 0) || undefined, weight_unit: asText(r.weightUnit ?? r.weight_unit, 'g') };
        }).filter((r) => r.item_id);
        const finalOutputs = outputs.length ? outputs : (primaryItemId ? [{ item_id: primaryItemId, item_name: primaryItemName || primaryItemId, unit: asText(raw.unit ?? raw.yieldUnit ?? raw.yield_unit, 'pcs'), standard_quantity: planned, actual: String(planned), unit_cost: 0 }] : []);
        if (!finalOutputs.length) throw new Error('Recipe does not identify a finished output SKU. Update the recipe before finishing this batch.');
        const details: RecipeDetails = { item_id: primaryItemId || finalOutputs[0].item_id, item_name: primaryItemName || finalOutputs[0].item_name, yield_quantity: yieldQty, yield_unit: asText(raw.unit ?? raw.yieldUnit ?? raw.yield_unit, 'pcs'), ingredients, outputs: finalOutputs };
        if (cancelled) return;
        setRecipeDetails(details); setInputLines(ingredients); setOutputLines(finalOutputs);
        setActualYield(String(finalOutputs.reduce((sum, row) => sum + asNum(row.actual), 0) || planned));
      } catch (e: unknown) {
        if (!cancelled) setFinishError(e instanceof Error ? e.message : 'Could not load recipe standards.');
      } finally { if (!cancelled) setFinishLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [finishTarget]);

  const validateForm = () => {
    const next: Record<string, string> = {};
    if (!selectedRecipe?.recipeId) next.recipe = 'Select a recipe.';
    if (!plannedQuantity.trim() || !Number.isFinite(Number(plannedQuantity)) || Number(plannedQuantity) <= 0) next.planned_quantity = 'Enter a positive batch quantity.';
    setErrors(next); return Object.keys(next).length === 0;
  };

  const handleStartProduction = async () => {
    if (!validateForm() || !selectedRecipe) return;
    const result = await startProduction({ recipe_id: selectedRecipe.recipeId, item_id: selectedRecipe.itemId, item_name: selectedRecipe.name, planned_quantity: Number(plannedQuantity), notes: notes.trim() || undefined });
    if (!result.success) { Alert.alert('Could not start production', result.message); return; }
    Alert.alert(result.offline ? 'Saved offline' : 'Production started', result.message);
    setSelectedRecipe(null); setPlannedQuantity(''); setNotes(''); setErrors({});
    void refreshProduction();
  };

  const handleFinish = async () => {
    if (!finishTarget || !recipeDetails || finishLoading || isSubmitting) return;
    if (!batchNumber.trim()) { setFinishError('Batch number is required.'); return; }
    if (!Number.isFinite(Number(wasteQuantity)) || Number(wasteQuantity) < 0) { setFinishError('Waste quantity must be zero or greater.'); return; }
    if (Number(wasteQuantity) > 0 && !wasteReason.trim()) { setFinishError('Waste reason is required when waste quantity is greater than zero.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate.trim()) || Number.isNaN(Date.parse(`${expiryDate}T00:00:00`))) { setFinishError('Enter a valid expiry date as YYYY-MM-DD.'); return; }
    const outputs = outputLines.map((r) => ({ ...r, quantity: Number(r.actual) }));
    if (outputs.some((r) => !Number.isFinite(r.quantity) || r.quantity < 0)) { setFinishError('Output quantities must be zero or greater.'); return; }
    if (!outputs.some((r) => r.quantity > 0) && !(Number(actualYield) > 0)) { setFinishError('Enter a positive actual yield or output quantity.'); return; }
    const inputs = inputLines.map((r) => ({ item_id: r.item_id, item_name: r.item_name, unit: r.unit, standard_quantity: r.standard_quantity, actual_quantity: Number(r.actual), unit_cost: r.unit_cost ?? 0 }));
    if (inputs.some((r) => !Number.isFinite(r.actual_quantity) || r.actual_quantity < 0)) { setFinishError('Input quantities must be zero or greater.'); return; }
    const finishOutputs = outputs.map((r) => ({ item_id: r.item_id, item_name: r.item_name, unit: r.unit, standard_quantity: r.standard_quantity, actual_quantity: r.quantity, unit_cost: r.unit_cost ?? 0, unit_weight: r.unit_weight, weight_unit: r.weight_unit }));
    const result = await finishProduction({ production_id: finishTarget.production_id, item_id: recipeDetails.item_id, item_name: recipeDetails.item_name, planned_quantity: finishTarget.planned_quantity, actual_quantity_produced: Number(actualYield) || calculatedYield(outputLines, recipeDetails.yield_unit), batch_number: batchNumber.trim(), expiry_date: expiryDate.trim(), waste_quantity: Number(wasteQuantity) || 0, waste_reason: wasteReason.trim() || undefined, notes: finishNotes.trim() || undefined, inputs, outputs: finishOutputs });
    if (!result.success) { setFinishError(result.message); return; }
    Alert.alert(result.offline ? 'Finish queued offline' : 'Batch finished', result.message);
    setFinishTarget(null); setRecipeDetails(null); void refreshProduction();
  };

  const updateLine = (setter: React.Dispatch<React.SetStateAction<LineDraft[]>>, index: number, value: string) => setter((rows) => rows.map((row, i) => i === index ? { ...row, actual: value } : row));
  const queueCount = queue.length;
  const completedCount = history.length;
  const historyCountText = useMemo(() => `${completedCount} completed`, [completedCount]);

  if (!canStartProduction) return <View style={styles.container}><Text style={typography.title}>Production</Text><Text style={styles.muted}>You do not have permission to start or finish production batches.</Text></View>;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshProduction()} />}>
        <View style={styles.pageHeader}>
          <View style={{ flex: 1 }}><Text style={typography.title}>Kitchen production</Text><Text style={styles.muted}>Start batches, track active work, and record finished output.</Text></View>
          <View style={[styles.livePill, connected ? styles.liveOn : styles.liveOff]}><View style={[styles.liveDot, { backgroundColor: connected ? colors.success : colors.warning }]} /><Text style={styles.liveText}>{connected ? 'Live' : 'Offline / reconnecting'}</Text></View>
        </View>
        <View style={styles.metrics}>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{queueCount}</Text><Text style={styles.metricLabel}>Active batches</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{completedCount}</Text><Text style={styles.metricLabel}>History records</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{pendingCount}</Text><Text style={styles.metricLabel}>Pending sync</Text></View>
        </View>
        <View style={styles.sectionHeader}><Text style={typography.subtitle}>Production queue</Text><TouchableOpacity onPress={() => navigation.navigate('ProductionHistory')}><Text style={styles.link}>View history →</Text></TouchableOpacity></View>
        {queueLoading && queue.length === 0 ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} /> : queueError ? <View style={styles.messageCard}><Text style={styles.errorText}>{queueError}</Text><TouchableOpacity onPress={() => void fetchQueue()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Retry queue</Text></TouchableOpacity></View> : queue.length === 0 ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No active batches</Text><Text style={styles.muted}>Start a batch below. It will appear here after the server confirms it.</Text></View> : queue.map((item) => <View key={item.production_id} style={styles.queueCard}>
          <View style={styles.queueTop}><View style={{ flex: 1 }}><Text style={styles.queueTitle}>{item.item_name}</Text><Text style={styles.muted}>Batch {item.production_id}</Text></View><View style={styles.statusBadge}><Text style={styles.statusText}>In progress</Text></View></View>
          <View style={styles.queueMeta}><Text style={styles.metaText}>Planned: <Text style={styles.strong}>{item.planned_quantity}</Text></Text><Text style={styles.metaText}>Started: {item.started_at && !Number.isNaN(Date.parse(item.started_at)) ? new Date(item.started_at).toLocaleString() : 'Time unavailable'}</Text></View>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setFinishTarget(item)}><Text style={styles.primaryButtonText}>Finish batch</Text></TouchableOpacity>
        </View>)}
        {historyError ? <Text style={styles.errorText}>History: {historyError}</Text> : null}
        <View style={styles.sectionHeader}><Text style={typography.subtitle}>Start a new batch</Text><Text style={styles.muted}>{connected ? 'Connected' : 'Connection pending'}</Text></View>
        <View style={styles.formCard}>
          <Text style={typography.label}>Recipe *</Text>
          <RecipeSearchPicker value={selectedRecipe} onChange={(r) => { setSelectedRecipe(r); if (r && !plannedQuantity) setPlannedQuantity(String(r.standardYield || '')); if (errors.recipe) setErrors((prev) => { const next = { ...prev }; delete next.recipe; return next; }); }} />
          {errors.recipe ? <Text style={styles.errorText}>{errors.recipe}</Text> : null}
          {selectedRecipe ? <Text style={styles.muted}>Output SKU: {selectedRecipe.itemId} · Unit: {selectedRecipe.unit}</Text> : null}
          <Text style={typography.label}>Planned batch quantity *</Text>
          <TextInput style={[styles.input, errors.planned_quantity ? styles.inputError : null]} placeholder="e.g. 10" placeholderTextColor={colors.textSecondary} value={plannedQuantity} onChangeText={setPlannedQuantity} keyboardType="decimal-pad" />
          {errors.planned_quantity ? <Text style={styles.errorText}>{errors.planned_quantity}</Text> : null}
          <Text style={typography.label}>Notes (optional)</Text>
          <TextInput style={[styles.input, styles.notesInput]} placeholder="Instructions for the batch" placeholderTextColor={colors.textSecondary} value={notes} onChangeText={setNotes} multiline />
          <TouchableOpacity style={[styles.primaryButton, (!selectedRecipe || isSubmitting) && styles.disabledButton]} disabled={!selectedRecipe || isSubmitting} onPress={() => void handleStartProduction()}>{isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Start production batch</Text>}</TouchableOpacity>
          <View style={styles.quickLinks}><TouchableOpacity onPress={() => navigation.navigate('ProductionHistory')}><Text style={styles.link}>Production history</Text></TouchableOpacity><TouchableOpacity onPress={() => navigation.navigate('PrePrep')}><Text style={styles.link}>Pre-prep</Text></TouchableOpacity></View>
        </View>
      </ScrollView>

      <Modal visible={!!finishTarget} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !isSubmitting && setFinishTarget(null)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}><View style={{ flex: 1 }}><Text style={typography.title}>Finish batch</Text><Text style={styles.muted}>{finishTarget?.item_name} · Planned {finishTarget?.planned_quantity}</Text></View><TouchableOpacity onPress={() => setFinishTarget(null)} disabled={isSubmitting}><Text style={styles.link}>Cancel</Text></TouchableOpacity></View>
            {finishLoading ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.xl }} /> : <>
              {finishError ? <View style={styles.errorBox}><Text style={styles.errorText}>{finishError}</Text></View> : null}
              {!recipeDetails && !finishError ? <Text style={styles.muted}>Loading recipe standards…</Text> : null}
              {recipeDetails ? <>
                <Text style={styles.sectionTitle}>Actual output</Text>
                {outputLines.map((line, i) => <View key={`${line.item_id}-${i}`} style={styles.lineRow}><View style={{ flex: 1 }}><Text style={styles.lineTitle}>{line.item_name}</Text><Text style={styles.muted}>Standard {line.standard_quantity} {line.unit}</Text></View><TextInput style={styles.quantityInput} value={line.actual} onChangeText={(v) => { const next = outputLines.map((line, index) => index === i ? { ...line, actual: v } : line); setOutputLines(next); setActualYield(String(calculatedYield(next, recipeDetails.yield_unit))); }} keyboardType="decimal-pad" accessibilityLabel={`Actual output ${line.item_name}`} /></View>)}
                <Text style={typography.label}>Actual total yield</Text><TextInput style={styles.input} value={actualYield} onChangeText={setActualYield} keyboardType="decimal-pad" />
                {inputLines.length ? <><Text style={styles.sectionTitle}>Actual ingredients used</Text>{inputLines.map((line, i) => <View key={`${line.item_id}-${i}`} style={styles.lineRow}><View style={{ flex: 1 }}><Text style={styles.lineTitle}>{line.item_name}</Text><Text style={styles.muted}>Standard {line.standard_quantity} {line.unit}</Text></View><TextInput style={styles.quantityInput} value={line.actual} onChangeText={(v) => updateLine(setInputLines, i, v)} keyboardType="decimal-pad" accessibilityLabel={`Actual input ${line.item_name}`} /></View>)}</> : null}
                <Text style={typography.label}>Batch number *</Text><TextInput style={styles.input} value={batchNumber} onChangeText={setBatchNumber} placeholder="Enter batch/lot number" placeholderTextColor={colors.textSecondary} />
                <Text style={typography.label}>Expiry date * (YYYY-MM-DD)</Text><TextInput style={styles.input} value={expiryDate} onChangeText={setExpiryDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary} autoCapitalize="none" />
                <Text style={typography.label}>Waste quantity</Text><TextInput style={styles.input} value={wasteQuantity} onChangeText={setWasteQuantity} keyboardType="decimal-pad" />
                <Text style={typography.label}>Waste reason</Text><TextInput style={styles.input} value={wasteReason} onChangeText={setWasteReason} placeholder="Required when recording waste" placeholderTextColor={colors.textSecondary} />
                <Text style={typography.label}>Notes</Text><TextInput style={[styles.input, styles.notesInput]} value={finishNotes} onChangeText={setFinishNotes} multiline placeholder="Optional finish notes" placeholderTextColor={colors.textSecondary} />
                <TouchableOpacity style={[styles.primaryButton, isSubmitting && styles.disabledButton]} onPress={() => void handleFinish()} disabled={isSubmitting || finishLoading}>{isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Confirm finished production</Text>}</TouchableOpacity>
              </> : null}
            </>}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  pageHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md }, muted: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  livePill: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }, liveOn: { backgroundColor: '#E7F6EC' }, liveOff: { backgroundColor: '#FFF1D6' }, liveDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 }, liveText: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
  metrics: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }, metricCard: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: spacing.md, borderWidth: 1, borderColor: colors.border }, metricValue: { fontSize: 24, fontWeight: '800', color: colors.primary }, metricLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.sm, gap: spacing.sm }, sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  queueCard: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border }, queueTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, queueTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary }, statusBadge: { backgroundColor: '#FFF1D6', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 }, statusText: { fontSize: 11, color: '#8A4B00', fontWeight: '700' }, queueMeta: { gap: 4, marginTop: spacing.sm, marginBottom: spacing.md }, metaText: { fontSize: 13, color: colors.textSecondary }, strong: { color: colors.textPrimary, fontWeight: '700' },
  emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: spacing.lg, marginBottom: spacing.md }, emptyTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 16, marginBottom: 4 }, messageCard: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: 12, marginBottom: spacing.md },
  formCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm }, input: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.sm }, notesInput: { minHeight: 78, textAlignVertical: 'top' }, inputError: { borderColor: colors.danger }, errorText: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: spacing.sm }, primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' }, disabledButton: { opacity: 0.55 }, secondaryButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.sm, alignSelf: 'flex-start', marginTop: spacing.sm }, secondaryButtonText: { color: colors.primary, fontWeight: '700' }, link: { color: colors.primary, fontSize: 13, fontWeight: '700' }, quickLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  modalRoot: { flex: 1, backgroundColor: colors.background }, modalContent: { padding: spacing.md, paddingBottom: spacing.xxl }, modalHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md }, errorBox: { backgroundColor: '#FDECEC', borderRadius: 10, padding: spacing.sm, marginBottom: spacing.sm }, lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.sm, marginBottom: spacing.sm }, lineTitle: { fontWeight: '700', color: colors.textPrimary }, quantityInput: { width: 100, textAlign: 'right', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: spacing.sm, paddingVertical: 10, color: colors.textPrimary, fontSize: 16 },
});
