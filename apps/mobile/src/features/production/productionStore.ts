// apps/mobile/src/features/production/productionStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import apiClient from '../../api/apiClient';
import { useOfflineStore } from '../offline/offlineStore';

export type ProductionItem = {
  production_id?: string;
  recipe_id?: string;
  item_id: string;
  item_name: string;
  planned_quantity: number;
  actual_quantity_produced?: number;
  waste_quantity?: number;
  waste_reason?: string;
  batch_number?: string;
  notes?: string;
  status: 'in_progress' | 'completed' | 'pending_sync';
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string | null;
  expiry_date?: string;
  available_stock?: number;
};

export type ProductionQueueItem = {
  production_id: string;
  recipe_id: string;
  item_id?: string;
  item_name: string;
  planned_quantity: number;
  status: 'started' | 'in_progress' | 'finished' | 'completed';
  started_at: string;
  finished_at?: string | null;
};

type StartProductionInput = {
  /** Required by Nest StartProductionSchema */
  recipe_id: string;
  item_id: string;
  item_name: string;
  planned_quantity: number;
  notes?: string;
};

type StartResult = {
  success: boolean;
  offline?: boolean;
  message: string;
  productionId?: string;
};

export type FinishProductionInput = {
  production_id: string;
  item_id?: string;
  item_name?: string;
  planned_quantity?: number;
  actual_quantity_produced: number;
  waste_quantity?: number;
  waste_reason?: string;
  batch_number?: string;
  expiry_date?: string;
  unit_cost?: number;
  total_cost?: number;
  notes?: string;
  inputs?: Array<Record<string, unknown>>;
  outputs?: Array<Record<string, unknown>>;
};

interface ProductionState {
  pendingProductions: ProductionItem[];
  history: ProductionItem[];
  queue: ProductionQueueItem[];
  queueLoading: boolean;
  queueError: string | null;
  historyLoading: boolean;
  historyError: string | null;
  syncStatus: 'idle' | 'syncing' | 'success' | 'error';
  syncError: string | null;
  isSubmitting: boolean;

  addProduction: (item: Omit<ProductionItem, 'queuedAt' | 'status'>) => void;
  startProduction: (input: StartProductionInput) => Promise<StartResult>;
  /** Nest finish body — production_id required (snake_case) */
  finishProduction: (input: FinishProductionInput) => Promise<StartResult>;
  removeProduction: (id: string) => void;
  syncPending: () => Promise<void>;
  retryFailedSync: () => Promise<void>;
  clearSynced: () => void;
  getPendingCount: () => number;
  fetchHistory: () => Promise<void>;
  fetchQueue: () => Promise<void>;
}

export const useProductionStore = create<ProductionState>()(
  persist(
    (set, get) => ({
      pendingProductions: [],
      history: [],
      queue: [],
      queueLoading: false,
      queueError: null,
      historyLoading: false,
      historyError: null,
      syncStatus: 'idle',
      syncError: null,
      isSubmitting: false,

      addProduction: (item) => {
        const newItem: ProductionItem = {
          ...item,
          status: 'pending_sync',
          queuedAt: new Date().toISOString(),
          production_id:
            item.production_id ||
            `local-${item.item_id}-${Date.now().toString(36)}`,
        };
        set((state) => ({
          pendingProductions: [...state.pendingProductions, newItem],
          syncStatus: 'idle',
          syncError: null,
        }));
      },

      startProduction: async (input) => {
        set({ isSubmitting: true });
        const localId = `local-${input.item_id}-${Date.now().toString(36)}`;
        const body = {
          recipe_id: input.recipe_id,
          item_id: input.item_id,
          item_name: input.item_name,
          planned_quantity: input.planned_quantity,
          notes: input.notes,
        };

        try {
          const res = await apiClient.post('/production/start', body, {
            headers: { 'Idempotency-Key': `start-production-${localId}` },
          });
          const root = (res.data ?? {}) as Record<string, unknown>;
          const serverId = String(
            root.productionId ?? root.production_id ?? root.id ??
            (root.data as Record<string, unknown> | undefined)?.production_id ?? '',
          );
          set({ isSubmitting: false });
          void get().fetchQueue();
          void get().fetchHistory();
          return {
            success: true,
            offline: false,
            message: String(root.message ?? 'Production started'),
            productionId: serverId || localId,
          };
        } catch (err: unknown) {
          const e = err as { response?: { status?: number }; message?: string; code?: string };
          const isNetworkFailure = !e.response && (
            e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED' ||
            e.message === 'Network Error' || /network|timeout|offline/i.test(String(e.message ?? ''))
          );

          // Never turn validation, authorization, or server errors into fake offline success.
          if (!isNetworkFailure) {
            const raw = (err as { response?: { data?: { message?: unknown } }; message?: string })
              .response?.data?.message ?? e.message ?? 'Could not start production';
            const message = Array.isArray(raw) ? raw.join(', ') : String(raw);
            set({ isSubmitting: false });
            return { success: false, message };
          }

          get().addProduction({
            production_id: localId,
            item_id: input.item_id,
            item_name: input.item_name,
            planned_quantity: input.planned_quantity,
            notes: input.notes,
            recipe_id: input.recipe_id,
          });
          // Start operations use this store's persisted pending list as their single
          // retry source. Do not also enqueue them in OfflineStore: that would replay
          // the same batch twice through two independent sync mechanisms.
          set({ isSubmitting: false });
          return {
            success: true, offline: true,
            message: 'Network unavailable. Batch saved locally and will sync when online.',
            productionId: localId,
          };
        }
      },

      finishProduction: async (input) => {
        set({ isSubmitting: true });
        const productionId = input.production_id;
        if (!productionId) {
          set({ isSubmitting: false });
          return { success: false, message: 'production_id required' };
        }
        if (!input.expiry_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.expiry_date)) {
          set({ isSubmitting: false });
          return { success: false, message: 'Expiry date is required (YYYY-MM-DD).' };
        }
        const body = {
          production_id: productionId,
          productionId: productionId,
          item_id: input.item_id,
          item_name: input.item_name,
          planned_quantity: input.planned_quantity,
          actual_quantity_produced: input.actual_quantity_produced,
          waste_quantity: input.waste_quantity ?? 0,
          waste_reason: input.waste_reason,
          batch_number: input.batch_number || `AUTO-${productionId.slice(-8)}`,
          expiry_date: input.expiry_date,
          unit_cost: input.unit_cost,
          total_cost: input.total_cost,
          notes: input.notes,
          inputs: input.inputs,
          outputs: input.outputs,
        };
        try {
          const res = await apiClient.post('/production/finish', body, {
            headers: {
              'Idempotency-Key': `prod-finish-${productionId}`,
            },
          });
          set({ isSubmitting: false });
          void get().fetchQueue();
          void get().fetchHistory();
          return {
            success: true,
            productionId,
            message:
              res.data?.message || 'Production finished successfully',
          };
        } catch (err: any) {
          const isNetwork =
            !err.response && (
              err.message === 'Network Error' ||
              err.code === 'ERR_NETWORK' ||
              err.code === 'ECONNABORTED' ||
              /network|timeout|offline/i.test(String(err.message ?? ''))
            );
          if (isNetwork) {
            try {
              await useOfflineStore.getState().addAction({
                module: 'production',
                endpoint: '/production/finish',
                method: 'POST',
                payload: body,
                idempotencyKey: `prod-finish-${productionId}`,
              });
            } catch {
              /* optional */
            }
            set({ isSubmitting: false });
            return {
              success: true,
              offline: true,
              productionId,
              message: 'Finish saved offline — will sync when online',
            };
          }
          const raw = err.response?.data?.message || err.message;
          const message = Array.isArray(raw)
            ? raw.join(', ')
            : raw || 'Finish failed';
          set({ isSubmitting: false });
          return { success: false, message };
        }
      },

      removeProduction: (id) => {
        set((state) => ({
          pendingProductions: state.pendingProductions.filter(
            (p) => p.production_id !== id && p.batch_number !== id,
          ),
        }));
      },

      syncPending: async () => {
        if (get().syncStatus === 'syncing') return;
        const pending = get().pendingProductions;
        if (pending.length === 0) return;

        set({ syncStatus: 'syncing', syncError: null });
        let successCount = 0;
        const failed: ProductionItem[] = [];

        for (const item of pending) {
          try {
            if (!item.recipe_id) throw new Error('Queued production is missing recipe_id');
            await apiClient.post('/production/start', {
              recipe_id: item.recipe_id,
              item_id: item.item_id,
              item_name: item.item_name,
              planned_quantity: item.planned_quantity,
              notes: item.notes,
            }, { headers: { 'Idempotency-Key': `start-production-${item.production_id}` } });
            successCount++;
          } catch {
            failed.push(item);
          }
        }

        if (failed.length === 0) {
          void get().fetchQueue();
          void get().fetchHistory();
          set({
            pendingProductions: [],
            syncStatus: 'success',
            syncError: null,
          });
          setTimeout(() => set({ syncStatus: 'idle' }), 2500);
        } else {
          set({
            pendingProductions: failed,
            syncStatus: 'error',
            syncError: `${successCount} ok, ${failed.length} failed`,
          });
        }
      },

      retryFailedSync: async () => {
        await get().syncPending();
      },

      clearSynced: () => set({ pendingProductions: [] }),

      getPendingCount: () => get().pendingProductions.length,

      fetchQueue: async () => {
        set({ queueLoading: true, queueError: null });
        try {
          const res = await apiClient.get('/kitchen/production-queue');
          const root = (res.data ?? {}) as Record<string, unknown>;
          const raw = Array.isArray(res.data) ? res.data :
            (root.queue ?? root.items ?? root.data ?? []);
          const rows = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
          const queue = rows.map((row) => ({
            production_id: String(row.productionId ?? row.production_id ?? row.id ?? ''),
            recipe_id: String(row.recipeId ?? row.recipe_id ?? ''),
            item_id: String(row.itemId ?? row.item_id ?? ''),
            item_name: String(row.recipeName ?? row.recipe_name ?? row.itemName ?? row.item_name ?? 'Production batch'),
            planned_quantity: Number(row.batchSize ?? row.batch_size ?? row.plannedQuantity ?? row.planned_quantity ?? 0),
            status: String(row.status ?? 'started').toLowerCase() as ProductionQueueItem['status'],
            started_at: String(row.startedAt ?? row.started_at ?? row.createdAt ?? row.created_at ?? ''),
            finished_at: (row.finishedAt ?? row.finished_at ?? null) as string | null,
          })).filter((row) => row.production_id && !['finished', 'completed'].includes(row.status));
          set({ queue, queueLoading: false, queueError: null });
        } catch (err: unknown) {
          const e = err as { response?: { data?: { message?: unknown } }; message?: string };
          const raw = e.response?.data?.message ?? e.message ?? 'Could not load production queue';
          set({ queueLoading: false, queueError: Array.isArray(raw) ? raw.join(', ') : String(raw) });
        }
      },

      fetchHistory: async () => {
        set({ historyLoading: true, historyError: null });
        try {
          const res = await apiClient.get('/kitchen/production-history');
          const root = (res.data ?? {}) as Record<string, unknown>;
          const raw = Array.isArray(res.data) ? res.data :
            (root.items ?? root.history ?? root.data ?? []);
          const rows = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
          const history = rows.map((row): ProductionItem => {
            const productionId = String(row.productionId ?? row.production_id ?? row.id ?? '');
            const finishedAt = String(row.finishedAt ?? row.finished_at ?? row.completedAt ?? row.completed_at ?? row.createdAt ?? row.created_at ?? '');
            return {
              production_id: productionId,
              recipe_id: String(row.recipeId ?? row.recipe_id ?? ''),
              item_id: String(row.itemId ?? row.item_id ?? ''),
              item_name: String(row.recipeName ?? row.recipe_name ?? row.itemName ?? row.item_name ?? 'Production batch'),
              planned_quantity: Number(row.batchSize ?? row.batch_size ?? row.plannedQuantity ?? row.planned_quantity ?? 0),
              actual_quantity_produced: row.actualYield != null || row.actual_yield != null || row.actual_quantity_produced != null
                ? Number(row.actualYield ?? row.actual_yield ?? row.actual_quantity_produced) : undefined,
              waste_quantity: row.wasteQuantity != null || row.waste_quantity != null ? Number(row.wasteQuantity ?? row.waste_quantity) : undefined,
              batch_number: String(row.batchNumber ?? row.batch_number ?? '') || undefined,
              expiry_date: String(row.expiryDate ?? row.expiry_date ?? row.stockExpiry ?? '') || undefined,
              available_stock: row.availableStock != null || row.available_stock != null ? Number(row.availableStock ?? row.available_stock) : undefined,
              status: 'completed',
              queuedAt: finishedAt || new Date(0).toISOString(),
              startedAt: String(row.startedAt ?? row.started_at ?? ''),
              finishedAt: finishedAt || null,
              notes: String(row.notes ?? '') || undefined,
            };
          }).filter((row) => row.production_id);
          set({ history, historyLoading: false, historyError: null });
        } catch (err: unknown) {
          const e = err as { response?: { data?: { message?: unknown } }; message?: string };
          const raw = e.response?.data?.message ?? e.message ?? 'Could not load production history';
          set({ historyLoading: false, historyError: Array.isArray(raw) ? raw.join(', ') : String(raw) });
        }
      },
    }),
    {
      name: 'restflow-pending-productions',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        pendingProductions: state.pendingProductions,
      }),
    },
  ),
);