// apps/mobile/src/screens/approvals/ApprovalsScreen.tsx
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import {
  approveRequest,
  fetchPendingApprovals,
  rejectRequest,
  type PendingApproval,
} from '../../api/approvalsApi';
import { useRole } from '../../hooks/useRole';
import { colors, spacing } from '../../lib/theme';

const DEFAULT_SHOP_ID = '1';

function formatKes(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

function humanize(type: string): string {
  return type.replace(/_/g, ' ');
}

export default function ApprovalsScreen() {
  const { isAdmin, isManager } = useRole();
  const canAct = isAdmin || isManager;

  const [items, setItems] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchPendingApprovals(DEFAULT_SHOP_ID);
      setItems(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load approvals');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const doReject = useCallback(async (item: PendingApproval, reason: string) => {
    setBusyId(item.id);
    try {
      await rejectRequest(item.id, reason);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      Alert.alert('Rejected', item.summary);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }, []);

  const onApprove = useCallback(async (item: PendingApproval) => {
    setBusyId(item.id);
    try {
      await approveRequest(item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      Alert.alert('Approved', item.summary);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }, []);

  const onReject = useCallback(
    (item: PendingApproval) => {
      if (Platform.OS === 'ios' && typeof (Alert as { prompt?: unknown }).prompt === 'function') {
        (Alert as { prompt: Function }).prompt(
          'Reject request',
          'Enter a reason',
          (reason?: string) => {
            if (!reason || !reason.trim()) {
              Alert.alert('Reason required', 'Please provide a rejection reason.');
              return;
            }
            void doReject(item, reason.trim());
          },
          'plain-text',
        );
        return;
      }
      Alert.alert('Reject this request?', item.summary, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => void doReject(item, 'Rejected on mobile'),
        },
      ]);
    },
    [doReject],
  );

  if (!canAct) {
    return (
      <View style={styles.center}>
        <Text style={styles.denied}>
          Only managers and admins can review approvals.
        </Text>
      </View>
    );
  }

  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
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
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing pending</Text>
            <Text style={styles.emptySub}>
              Write-offs, adjustments, and refunds needing approval show up here.
            </Text>
          </View>
        }
        contentContainerStyle={items.length === 0 ? styles.flexGrow : undefined}
        renderItem={({ item }) => {
          const busy = busyId === item.id;
          return (
            <View style={styles.card}>
              <Text style={styles.type}>{humanize(item.type)}</Text>
              <Text style={styles.summary}>{item.summary}</Text>
              <Text style={styles.meta}>
                {formatKes(item.amount)} · {item.requestedBy}
              </Text>
              <Text style={styles.metaMuted}>
                {item.requestedAt
                  ? new Date(item.requestedAt).toLocaleString()
                  : ''}
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnReject]}
                  disabled={busy}
                  onPress={() => onReject(item)}
                >
                  <Text style={styles.btnRejectText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnApprove]}
                  disabled={busy}
                  onPress={() => void onApprove(item)}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnApproveText}>Approve</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  flexGrow: { flexGrow: 1 },
  denied: { color: colors.danger, textAlign: 'center', fontSize: 16 },
  error: { color: colors.danger, marginBottom: spacing.sm },
  empty: {
    marginTop: 48,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptySub: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  type: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  summary: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  meta: { marginTop: 6, fontSize: 14, color: colors.textPrimary },
  metaMuted: { marginTop: 2, fontSize: 12, color: colors.textSecondary },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  btn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    minWidth: 96,
    alignItems: 'center',
  },
  btnReject: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnRejectText: { color: colors.danger, fontWeight: '600' },
  btnApprove: { backgroundColor: colors.primary },
  btnApproveText: { color: '#fff', fontWeight: '700' },
});
