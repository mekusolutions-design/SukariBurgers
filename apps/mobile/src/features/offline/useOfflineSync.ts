// apps/mobile/src/features/offline/useOfflineSync.ts
import { useEffect, useRef } from 'react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useOfflineStore } from './offlineStore';
import { useProductionStore } from '../production/productionStore';
import { useAuthStore } from '../auth/authStore';

/**
 * Call once near the root of the app (e.g. App.tsx or RootNavigator).
 * Loads the queue and auto-syncs when the device comes online.
 */
export const useOfflineSync = () => {
  const { isFullyOnline } = useNetworkStatus();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { syncNow, loadQueue, queue, isSyncing, lastSyncResult } =
    useOfflineStore();

  const wasOffline = useRef(false);
  const didInitialProductionSync = useRef(false);
  const syncPendingProductions = useProductionStore((s) => s.syncPending);
  const pendingProductions = useProductionStore((s) => s.pendingProductions.length);
  const fetchProductionQueue = useProductionStore((s) => s.fetchQueue);
  const fetchProductionHistory = useProductionStore((s) => s.fetchHistory);

  // Load queue on mount
  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Auto-sync both persisted offline actions and legacy production-start records.
  // Production starts use productionStore as their single retry source; other modules
  // continue using the shared offline action queue.
  useEffect(() => {
    if (!isAuthenticated) return;

    if (!isFullyOnline) {
      wasOffline.current = true;
      return;
    }

    const shouldSyncProduction = pendingProductions > 0 &&
      (wasOffline.current || !didInitialProductionSync.current);
    if (shouldSyncProduction) {
      didInitialProductionSync.current = true;
      void syncPendingProductions().then(() => {
        void fetchProductionQueue();
        void fetchProductionHistory();
      });
    }

    if (wasOffline.current && queue.length > 0 && !isSyncing) {
      console.log('🌐 Back online → auto-syncing offline queue...');
      void syncNow().then((result) => {
        if (result.success > 0) {
          void fetchProductionQueue();
          void fetchProductionHistory();
        }
      });
    }
    wasOffline.current = false;
  }, [isFullyOnline, isAuthenticated, queue.length, isSyncing, syncNow, pendingProductions, syncPendingProductions, fetchProductionQueue, fetchProductionHistory]);

  return {
    pendingCount: queue.length,
    isSyncing,
    lastSyncResult,
    isOnline: isFullyOnline,
    syncNow,
  };
};