// apps/mobile/src/screens/production/ProductionScreen.tsx
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useAuthStore } from '../../features/auth/authStore';
import { useProductionStore } from '../../features/production/productionStore';
import { useOfflineStore } from '../../features/offline/offlineStore';
import { getSocket } from '../../lib/socket';
import {
  RecipeSearchPicker,
  type RecipePick,
} from '../../components/production/RecipeSearchPicker';
import { colors, spacing, typography } from '../../lib/theme';
import type { RootNavigationProp } from '../../types/navigation';

type LiveProduction = {
  production_id: string;
  item_name: string;
  planned_quantity: number;
  actual_quantity?: number;
  waste_quantity?: number;
  yield_percentage?: number;
  status: 'in_progress' | 'completed';
  timestamp: string;
};

export default function ProductionScreen() {
  const navigation = useNavigation<RootNavigationProp>();
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { startProduction, isSubmitting, getPendingCount } =
    useProductionStore();

  const offlinePendingCount = useOfflineStore(
    (s) => s.queue.filter((q) => q.module === 'production').length,
  );

  const localPendingCount = getPendingCount();
  const pendingCount = Math.max(offlinePendingCount, localPendingCount);

  const [selectedRecipe, setSelectedRecipe] = useState<RecipePick | null>(null);
  const [plannedQuantity, setPlannedQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [liveProductions, setLiveProductions] = useState<LiveProduction[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !token) return;

    const socket = getSocket('/production');
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onUpdate = (payload: LiveProduction) => {
      setLiveProductions((prev) => {
        const idx = prev.findIndex(
          (p) => p.production_id === payload.production_id,
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...payload };
          return next;
        }
        return [payload, ...prev].slice(0, 20);
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('production_updated', onUpdate);
    socket.on('production_started', onUpdate);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('production_updated', onUpdate);
      socket.off('production_started', onUpdate);
    };
  }, [isAuthenticated, token]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!selectedRecipe?.recipeId) {
      newErrors.recipe = 'Select a recipe';
    }
    if (
      !plannedQuantity.trim() ||
      Number.isNaN(parseFloat(plannedQuantity)) ||
      parseFloat(plannedQuantity) <= 0
    ) {
      newErrors.planned_quantity = 'Planned quantity must be a positive number';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleStartProduction = async () => {
    if (!validateForm() || !selectedRecipe) {
      Alert.alert('Validation Error', 'Please fix the highlighted fields');
      return;
    }

    const result = await startProduction({
      recipe_id: selectedRecipe.recipeId,
      item_id: selectedRecipe.itemId,
      item_name: selectedRecipe.name,
      planned_quantity: parseFloat(plannedQuantity),
      notes: notes.trim() || undefined,
    });

    if (result.success) {
      Alert.alert(
        result.offline ? 'Saved Offline' : 'Success',
        result.message,
      );
      setSelectedRecipe(null);
      setPlannedQuantity('');
      setNotes('');
      setErrors({});
    } else {
      Alert.alert('Error', result.message);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={typography.title}>Start Production</Text>
        <Text style={styles.connection}>
          {connected ? '● Live' : '○ Connecting...'}
          {pendingCount > 0 ? `  ·  ${pendingCount} pending` : ''}
        </Text>

        <View style={styles.links}>
          <TouchableOpacity onPress={() => navigation.navigate('ProductionHistory')}>
            <Text style={styles.link}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('PrePrep')}>
            <Text style={styles.link}>Pre-prep</Text>
          </TouchableOpacity>
        </View>

        {liveProductions.length > 0 && (
          <>
            <Text style={[typography.subtitle, { marginBottom: spacing.sm }]}>
              Live runs
            </Text>
            <FlatList
              data={liveProductions}
              keyExtractor={(item) => item.production_id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.liveCard}>
                  <Text style={styles.itemName}>{item.item_name}</Text>
                  <Text style={styles.meta}>
                    Planned: {item.planned_quantity}
                    {item.actual_quantity != null
                      ? ` · Actual: ${item.actual_quantity}`
                      : ''}
                    {item.status ? ` · ${item.status}` : ''}
                  </Text>
                </View>
              )}
            />
          </>
        )}

        <View style={styles.form}>
          <View style={styles.formGroup}>
            <Text style={typography.label}>Recipe *</Text>
            <RecipeSearchPicker
              value={selectedRecipe}
              onChange={(r) => {
                setSelectedRecipe(r);
                if (errors.recipe) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.recipe;
                    return next;
                  });
                }
                if (r && !plannedQuantity) {
                  setPlannedQuantity(String(r.standardYield || ''));
                }
              }}
            />
            {errors.recipe ? (
              <Text style={styles.errorText}>{errors.recipe}</Text>
            ) : null}
            {selectedRecipe ? (
              <Text style={styles.hint}>
                Output SKU {selectedRecipe.itemId}
                {selectedRecipe.maxPortions != null
                  ? ` · stock allows ~${selectedRecipe.maxPortions} ${selectedRecipe.unit}`
                  : ''}
              </Text>
            ) : null}
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Batch size (planned yield) *</Text>
            <TextInput
              style={[
                styles.input,
                errors.planned_quantity && styles.inputError,
              ]}
              placeholder="e.g. 10"
              value={plannedQuantity}
              onChangeText={(v) => {
                setPlannedQuantity(v);
                if (errors.planned_quantity) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.planned_quantity;
                    return next;
                  });
                }
              }}
              keyboardType="decimal-pad"
            />
            {errors.planned_quantity ? (
              <Text style={styles.errorText}>{errors.planned_quantity}</Text>
            ) : null}
          </View>

          <View style={styles.formGroup}>
            <Text style={typography.label}>Notes</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="Optional notes"
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </View>

          <TouchableOpacity
            style={[
              styles.button,
              (!selectedRecipe || isSubmitting) && styles.buttonDisabled,
            ]}
            onPress={() => void handleStartProduction()}
            disabled={!selectedRecipe || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Start Production</Text>
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
  connection: { color: colors.textSecondary, marginBottom: spacing.sm },
  links: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  link: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  form: { marginTop: spacing.md },
  formGroup: { marginBottom: spacing.lg },
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
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  errorText: { color: colors.danger, fontSize: 14, marginTop: spacing.xs },
  hint: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
  liveCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemName: { fontWeight: '600', color: colors.textPrimary },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
});
