// apps/mobile/src/screens/kitchen/KitchenDisplayScreen.tsx
import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { RootNavigationProp } from '../../types/navigation';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';

import { useAuthStore } from '../../features/auth/authStore';
import apiClient from '../../api/apiClient';
import { API_ENDPOINTS } from '../../api/endpoints';
import { useKitchenStore } from '../../features/kitchen/kitchenStore';
import type { KitchenOrder, OrderStatus } from '../../types/api';
import { colors, spacing, typography } from '../../lib/theme';
import { getSocket } from '../../lib/socket';
import OrderCard from '../../components/kitchen/OrderCard';
import KitchenOrderDetail from './KitchenOrderDetail';

export default function KitchenDisplayScreen() {
  const navigation = useNavigation<RootNavigationProp>();
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const {
    orders,
    selectedOrder,
    addOrder,
    setOrders,
    updateOrderStatus,
    setSelectedOrder,
  } = useKitchenStore();

  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const loadActiveOrders = async () => {
      try {
        const response = await apiClient.get(API_ENDPOINTS.KITCHEN_ACTIVE_ORDERS, { params: { shopId: '1' } });
        const payload = response.data as Record<string, unknown> | unknown[];
        const root = (payload ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(payload) ? payload : Array.isArray(root.orders) ? root.orders : Array.isArray(root.items) ? root.items : Array.isArray(root.data) ? root.data : [];
        const normalized = (rows as Record<string, unknown>[]).map((row) => {
          const rawItems = Array.isArray(row.items) ? row.items as Record<string, unknown>[] : Array.isArray(row.lines) ? row.lines as Record<string, unknown>[] : [];
          const statusValue = String(row.status ?? 'pending').toLowerCase();
          const status = (['pending', 'preparing', 'ready', 'completed', 'cancelled'].includes(statusValue) ? statusValue : 'pending') as OrderStatus;
          const orderTypeValue = String(row.order_type ?? row.orderType ?? 'dine-in').replace(/_/g, '-');
          return {
            order_id: String(row.order_id ?? row.orderId ?? row.id ?? ''),
            items: rawItems.map((item) => ({
              menu_id: String(item.menu_id ?? item.menuItemId ?? item.menu_item_id ?? item.item_id ?? ''),
              menu_name: String(item.menu_name ?? item.menuItemName ?? item.name ?? item.item_name ?? ''),
              quantity: Number(item.quantity ?? item.qty ?? 1),
              notes: item.notes == null ? undefined : String(item.notes),
              unit_price: Number(item.unit_price ?? item.selling_price ?? item.price ?? 0),
            })),
            order_type: (['dine-in', 'takeaway', 'delivery', 'pickup'].includes(orderTypeValue) ? orderTypeValue : 'dine-in') as KitchenOrder['order_type'],
            table_number: row.table_number == null && row.tableNumber == null ? undefined : String(row.table_number ?? row.tableNumber),
            customer_name: row.customer_name == null && row.customerName == null ? undefined : String(row.customer_name ?? row.customerName),
            customer_phone: row.customer_phone == null && row.customerPhone == null ? undefined : String(row.customer_phone ?? row.customerPhone),
            status,
            started_at: row.started_at == null && row.startedAt == null ? undefined : String(row.started_at ?? row.startedAt),
            completed_at: row.completed_at == null && row.completedAt == null ? undefined : String(row.completed_at ?? row.completedAt),
            timestamp: String(row.timestamp ?? row.created_at ?? row.createdAt ?? new Date().toISOString()),
            total_amount: Number(row.total_amount ?? row.totalAmount ?? 0),
          } as KitchenOrder;
        }).filter((order) => order.order_id);
        if (!cancelled) setOrders(normalized);
      } catch (error) {
        if (!cancelled) Alert.alert('Kitchen orders', error instanceof Error ? error.message : 'Could not load existing active orders.');
      }
    };
    void loadActiveOrders();

    const socket = getSocket('/pos');

    const onConnect = () => {
      setConnected(true);
      socket.emit('join_kitchen');
    };
    const onDisconnect = () => setConnected(false);
    const onNewOrder = (order: KitchenOrder) => {
      addOrder(order);
    };
    const onStatusUpdated = (data: {
      order_id: string;
      status: OrderStatus;
    }) => {
      updateOrderStatus(data.order_id, data.status);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('kitchen_new_order', onNewOrder);
    socket.on('order_status_updated', onStatusUpdated);

    if (socket.connected) {
      setConnected(true);
      socket.emit('join_kitchen');
    }

    setLoading(false);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('kitchen_new_order', onNewOrder);
      socket.off('order_status_updated', onStatusUpdated);
      cancelled = true;
      // do not disconnect shared socket â€” leave for other screens
    };
  }, [token, isAuthenticated, addOrder, setOrders, updateOrderStatus]);

  const handleStatusChange = async (order_id: string, status: OrderStatus) => {
    try {
      await apiClient.patch(API_ENDPOINTS.KITCHEN_ORDER_STATUS(order_id), { status });
      updateOrderStatus(order_id, status);
      const socket = getSocket('/pos');
      socket.emit('update_order_status', { order_id, status });
    } catch (error) {
      Alert.alert('Could not update order', error instanceof Error ? error.message : 'The kitchen status was not saved.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const activeOrders = orders.filter((o) => o.status === 'pending' || o.status === 'preparing');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={typography.title}>Kitchen Display</Text>
        <Text
          style={[
            styles.connection,
            { color: connected ? colors.success : colors.danger },
          ]}
        >
          {connected ? 'â— LIVE' : 'â—‹ Offline'}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.startBatchButton}
        onPress={() => navigation.navigate('Production')}
        accessibilityRole="button"
        accessibilityLabel="Start production batch"
      >
        <Text style={styles.startBatchButtonText}>+ Start batch</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.historyLink}
        onPress={() => navigation.navigate('ProductionHistory')}
        accessibilityRole="button"
      >
        <Text style={styles.historyLinkText}>Production history</Text>
      </TouchableOpacity>

      <Text style={styles.subtitle}>
        Active Orders ({activeOrders.length})
      </Text>

      <FlatList
        data={activeOrders}
        keyExtractor={(item) => item.order_id}
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            onPress={() => setSelectedOrder(item)}
            onStatusChange={(status) =>
              handleStatusChange(item.order_id, status)
            }
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No active orders</Text>
            <Text style={styles.emptySub}>
              New orders will appear here live
            </Text>
          </View>
        }
      />

      <KitchenOrderDetail
        order={selectedOrder}
        visible={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  connection: {
    fontWeight: '700',
  },
  startBatchButton: { backgroundColor: colors.primary, paddingVertical: spacing.md, borderRadius: 10, alignItems: 'center', marginBottom: spacing.sm },
  startBatchButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  historyLink: { alignSelf: 'flex-start', paddingVertical: spacing.xs, marginBottom: spacing.sm },
  historyLinkText: { color: colors.primary, fontWeight: '600' },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    marginTop: 80,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  emptySub: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
});
