// apps/mobile/src/screens/dashboard/ManagerDashboardScreen.tsx
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { fetchShopSummary, type ShopSummary } from '../../api/dashboardApi';
import { useRole } from '../../hooks/useRole';
import { colors, spacing, typography } from '../../lib/theme';
import type { RootNavigationProp } from '../../types/navigation';

const DEFAULT_SHOP_ID = '1';

function formatKes(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

export default function ManagerDashboardScreen() {
  const navigation = useNavigation<RootNavigationProp>();
  const { isManager, isAdmin, canUsePos } = useRole();
  const allowed = isManager || isAdmin;

  const [summary, setSummary] = useState<ShopSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchShopSummary(DEFAULT_SHOP_ID);
      setSummary(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load summary');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!allowed) return;
      setLoading(true);
      void load();
    }, [allowed, load]),
  );

  if (!allowed) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>This dashboard is only for managers</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          colors={[colors.primary]}
        />
      }
    >
      <Text style={typography.title}>Manager Dashboard</Text>
      <Text style={styles.sub}>
        {summary?.shopName ? summary.shopName : 'Shop overview'}
      </Text>

      {loading && !summary ? (
        <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.primary} />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {summary ? (
        <View style={styles.metrics}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Revenue</Text>
            <Text style={styles.metricValue}>{formatKes(summary.todayRevenue)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Orders</Text>
            <Text style={styles.metricValue}>{summary.todayOrders}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Open approvals</Text>
            <Text style={styles.metricValue}>{summary.openApprovals}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Low stock</Text>
            <Text style={styles.metricValue}>{summary.lowStockCount}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Near expiry</Text>
            <Text style={styles.metricValue}>{summary.nearExpiryCount}</Text>
          </View>
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Approvals')}
      >
        <Text style={styles.cardTitle}>Approvals</Text>
        <Text style={styles.cardDesc}>
          Review pending write-offs and adjustments
          {summary && summary.openApprovals > 0
            ? ` (${summary.openApprovals})`
            : ''}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('StockOverview')}
      >
        <Text style={styles.cardTitle}>Stock Overview</Text>
        <Text style={styles.cardDesc}>View current inventory levels</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Receive')}
      >
        <Text style={styles.cardTitle}>Receive Goods</Text>
        <Text style={styles.cardDesc}>Record new stock arrivals</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('ClosingStock')}
      >
        <Text style={styles.cardTitle}>Closing Stock</Text>
        <Text style={styles.cardDesc}>End-of-shift counts</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Production')}
      >
        <Text style={styles.cardTitle}>Start batch</Text>
        <Text style={styles.cardDesc}>Start a production batch from a recipe</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('ProductionHistory')}
      >
        <Text style={styles.cardTitle}>Production history</Text>
        <Text style={styles.cardDesc}>Review recent and completed batches</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('KitchenDisplay')}
      >
        <Text style={styles.cardTitle}>Kitchen display</Text>
        <Text style={styles.cardDesc}>View and update active kitchen orders</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('PrePrep')}
      >
        <Text style={styles.cardTitle}>Pre-prep</Text>
        <Text style={styles.cardDesc}>Raw → prepped lots</Text>
      </TouchableOpacity>

      {canUsePos ? (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('PosOrder')}
        >
          <Text style={styles.cardTitle}>POS Orders</Text>
          <Text style={styles.cardDesc}>Create or review sales</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  sub: {
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  message: {
    fontSize: 18,
    textAlign: 'center',
    color: colors.danger,
    marginTop: spacing.xl,
  },
  error: { color: colors.danger, marginBottom: spacing.sm },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  metricCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: { fontSize: 12, color: colors.textSecondary },
  metricValue: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: 12,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  cardDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
