// apps/mobile/src/screens/pos/PosOrderScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import apiClient from '../../api/apiClient';
import posApiClient from '../../api/posApiClient';
import { API_ENDPOINTS } from '../../api/endpoints';
import { useInventoryStore } from '../../features/inventory/inventoryStore';
import { usePosStore } from '../../features/pos/posStore';
import {
  buildLineSelections,
  choiceLinesNeedingPick,
  isMenuSellable,
  normalizeBootstrapMenus,
  normalizeMenuLines,
  validateLineSelections,
  type MenuComponentLine,
  type ComponentSelection,
} from '../../features/pos/posParityCore';
import { colors, spacing } from '../../lib/theme';

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category?: string;
  isAvailable?: boolean;
  maxPortions?: number;
  availableQuantity?: number;
  lines?: MenuComponentLine[];
  finishedGoodId?: string | null;
  ingredients?: Record<string, number>;
}

type ComboGroup = {
  groupIndex: number;
  menuCategoryId: string;
  menuCategoryName: string;
  quantity: number;
};

type Combo = {
  id: string;
  name: string;
  price: number;
  active: boolean;
  groups: ComboGroup[];
};

type MenuCategory = {
  id: string;
  name: string;
  menuItemIds: string[];
};

type SearchHit = {
  kind: 'item' | 'combo';
  id: string;
  name: string;
  price: number;
  category?: string;
  available: boolean;
  menu?: MenuItem;
  combo?: Combo;
};

type ComboSelection = { group_index: number; menu_item_ids: string[] };

interface OrderItem extends MenuItem {
  qty: number;
  line_type?: 'menu_item' | 'combo';
  combo_id?: string;
  combo_selections?: ComboSelection[];
  selections?: ComponentSelection[];
}

function fuzzyMatch(name: string, query: string): boolean {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return true;
  if (n.includes(q)) return true;
  const words = n.split(/\s+/);
  if (q.split(/\s+/).every((part) => words.some((word) => word.startsWith(part)))) return true;
  if (q.length < 4) return false;
  // Bounded one-edit matching for short counter searches.
  for (const word of words) {
    if (Math.abs(word.length - q.length) > 1) continue;
    let i = 0; let j = 0; let edits = 0;
    while (i < q.length && j < word.length) {
      if (q[i] === word[j]) { i++; j++; continue; }
      edits++;
      if (edits > 1) break;
      if (q.length > word.length) i++;
      else if (word.length > q.length) j++;
      else { i++; j++; }
    }
    if (i < q.length || j < word.length) edits++;
    if (edits <= 1) return true;
  }
  return false;
}


export default function PosOrderScreen(): React.JSX.Element {
  const { updateStockLocally } = useInventoryStore();
  const { submitOrder, isSubmitting } = usePosStore();

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCombo, setSelectedCombo] = useState<Combo | null>(null);
  const [comboModalOpen, setComboModalOpen] = useState(false);
  const [comboPicks, setComboPicks] = useState<Record<number, Record<string, number>>>({});
  const [order, setOrder] = useState<OrderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<'dine-in' | 'takeaway' | 'delivery'>(
    'dine-in',
  );
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  /** Multi-option CHOICE picker (web NewOrderPanel parity) */
  const [choiceMenu, setChoiceMenu] = useState<MenuItem | null>(null);
  const [choicePicks, setChoicePicks] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchMenu = async () => {
      try {
        setIsLoading(true);
        setError(null);
        // Prefer POS bootstrap (Go or Nest) — same path as web
        let raw: any[] = [];
        try {
          const boot = await posApiClient.get(API_ENDPOINTS.POS_BOOTSTRAP);
          const data = boot.data ?? {};
          raw = normalizeBootstrapMenus({
            menus: data.menus,
            items: data.items,
            availability: data.availability,
          });
        } catch {
          /* fall through */
        }
        if (!Array.isArray(raw) || raw.length === 0) {
          const res = await apiClient.get(API_ENDPOINTS.MENU_LIST);
          raw = Array.isArray(res.data)
            ? res.data
            : res.data?.items || res.data?.menus || [];
        }
        // Normalize Nest/Go fields → mobile list model
        const normalized: MenuItem[] = (raw || [])
          .map((m: Record<string, unknown>) => {
            const id = String(
              m.menuId ?? m.menu_id ?? m.menuItemId ?? m.menu_item_id ?? m.id ?? '',
            ).trim();
            if (!id) return null;
            const price = Number(
              m.sellingPrice ?? m.selling_price ?? m.price ?? 0,
            );
            const name = String(m.name ?? id);
            const maxPortions = Math.max(
              0,
              Math.floor(Number(m.maxPortions ?? m.availableQuantity ?? 0)),
            );
            const available = isMenuSellable({
              maxPortions,
              availableQuantity: maxPortions,
              isAvailable:
                m.isAvailable !== false && m.is_available !== false
                  ? (m.isAvailable as boolean | undefined)
                  : false,
            });
            return {
              id,
              name,
              price: Number.isFinite(price) ? price : 0,
              category: (m.category as string) || undefined,
              isAvailable: available,
              maxPortions,
              availableQuantity: maxPortions,
              lines: normalizeMenuLines(m.lines),
              finishedGoodId:
                (m.finishedGoodId as string | null | undefined) ??
                (m.finished_good_id as string | null | undefined) ??
                null,
            } as MenuItem;
          })
          .filter(Boolean) as MenuItem[];
        setMenu(normalized);

        const [comboResult, categoryResult] = await Promise.allSettled([
          apiClient.get(API_ENDPOINTS.MENU_COMBOS, { params: { shopId: '1' } }),
          apiClient.get(API_ENDPOINTS.MENU_CATEGORIES, { params: { shopId: '1' } }),
        ]);
        if (comboResult.status === 'fulfilled') {
          const payload = comboResult.value.data as Record<string, unknown> | unknown[];
          const root = (payload ?? {}) as Record<string, unknown>;
          const rows = Array.isArray(payload) ? payload : Array.isArray(root.items) ? root.items : Array.isArray(root.data) ? root.data : [];
          setCombos((rows as Record<string, unknown>[]).map((row) => {
            const groupsRaw = row.selectionGroups ?? row.selection_groups;
            const groups = Array.isArray(groupsRaw) ? groupsRaw as Record<string, unknown>[] : [];
            return {
              id: String(row.comboId ?? row.combo_id ?? row.id ?? ''),
              name: String(row.name ?? ''),
              price: Number(row.sellingPrice ?? row.selling_price ?? row.price ?? 0),
              active: row.active !== false,
              groups: groups.map((group, index) => ({
                groupIndex: Number(group.groupIndex ?? group.group_index ?? index),
                menuCategoryId: String(group.menuCategoryId ?? group.menu_category_id ?? ''),
                menuCategoryName: String(group.menuCategoryName ?? group.menu_category_name ?? group.name ?? 'Selection'),
                quantity: Math.max(1, Number(group.quantity ?? 1)),
              })),
            };
          }).filter((combo) => combo.id && combo.name && combo.active));
        }
        if (categoryResult.status === 'fulfilled') {
          const payload = categoryResult.value.data as Record<string, unknown> | unknown[];
          const root = (payload ?? {}) as Record<string, unknown>;
          const rows = Array.isArray(payload) ? payload : Array.isArray(root.items) ? root.items : Array.isArray(root.data) ? root.data : [];
          setCategories((rows as Record<string, unknown>[]).map((row) => {
            const menuItems = Array.isArray(row.menuItems) ? row.menuItems as Record<string, unknown>[] : Array.isArray(row.menu_items) ? row.menu_items as Record<string, unknown>[] : [];
            const idsRaw = row.menuItemIds ?? row.menu_item_ids;
            const ids = Array.isArray(idsRaw) ? idsRaw.map(String) : menuItems.map((item) => String(item.menuItemId ?? item.menu_item_id ?? item.id ?? '')).filter(Boolean);
            return {
              id: String(row.categoryId ?? row.category_id ?? row.id ?? ''),
              name: String(row.name ?? row.categoryName ?? ''),
              menuItemIds: ids,
            };
          }).filter((category) => category.id));
        }
      } catch (err: any) {
        const msg =
          err?.response?.data?.message || err.message || 'Failed to load menu';
        setError(Array.isArray(msg) ? msg.join(', ') : msg);
      } finally {
        setIsLoading(false);
      }
    };
    fetchMenu();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText.trim()), 200);
    return () => clearTimeout(timer);
  }, [searchText]);

  const searchHits = useMemo<SearchHit[]>(() => {
    const q = debouncedSearch.toLowerCase();
    const itemHits: SearchHit[] = menu
      .filter((item) => !q || fuzzyMatch(item.name, q) || fuzzyMatch(item.id, q) || fuzzyMatch(item.category ?? '', q))
      .map((item) => ({ kind: 'item', id: item.id, name: item.name, price: item.price, category: item.category, available: item.isAvailable !== false, menu: item }));
    if (!q) return itemHits;
    const comboHits: SearchHit[] = combos
      .filter((combo) => combo.active && fuzzyMatch(combo.name, q))
      .map((combo) => ({ kind: 'combo', id: combo.id, name: combo.name, price: combo.price, category: 'Combo', available: true, combo }));
    return [...itemHits, ...comboHits]
      .sort((a, b) => {
        const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return aPrefix - bPrefix || a.name.localeCompare(b.name);
      })
      .slice(0, 10);
  }, [menu, combos, debouncedSearch]);

  const addToOrder = (menuItem: MenuItem, preferred?: Record<string, string>) => {
    if (!isMenuSellable(menuItem)) {
      Alert.alert('Unavailable', `${menuItem.name} is out of stock.`);
      return;
    }
    const needing = choiceLinesNeedingPick(menuItem.lines);
    if (needing.length > 0 && !preferred) {
      setChoiceMenu(menuItem);
      setChoicePicks({});
      return;
    }
    const selections = buildLineSelections(menuItem.lines, 1, preferred);
    if (menuItem.lines && menuItem.lines.length > 0 && selections === null) {
      Alert.alert(
        'Choose options',
        `${menuItem.name} needs component selections before it can be sold.`,
      );
      setChoiceMenu(menuItem);
      setChoicePicks(preferred ?? {});
      return;
    }
    const err = validateLineSelections(
      menuItem.name,
      menuItem.lines,
      selections ?? [],
      1,
    );
    if (err) {
      Alert.alert('Incomplete selection', err);
      return;
    }
    setOrder((prev) => {
      const existing = prev.find((i) => i.id === menuItem.id);
      if (existing) {
        const nextQty = existing.qty + 1;
        const nextSel =
          buildLineSelections(menuItem.lines, nextQty, preferred) ??
          existing.selections;
        return prev.map((i) =>
          i.id === menuItem.id
            ? { ...i, qty: nextQty, selections: nextSel }
            : i,
        );
      }
      return [
        ...prev,
        {
          ...menuItem,
          qty: 1,
          line_type: 'menu_item' as const,
          selections: selections ?? [],
        },
      ];
    });
    setChoiceMenu(null);
    setChoicePicks({});
  };

  const confirmChoicePicks = () => {
    if (!choiceMenu) return;
    const needing = choiceLinesNeedingPick(choiceMenu.lines);
    for (const line of needing) {
      if (!choicePicks[line.componentKey]) {
        Alert.alert(
          'Select option',
          `Pick an option for ${line.finishedGoodCategoryName || line.componentKey}`,
        );
        return;
      }
    }
    addToOrder(choiceMenu, choicePicks);
  };



  const selectSearchHit = (hit: SearchHit) => {
    if (!hit.available) return;
    if (hit.kind === 'item' && hit.menu) {
      addToOrder(hit.menu);
      setSearchText('');
      return;
    }
    if (hit.kind === 'combo' && hit.combo) {
      setSelectedCombo(hit.combo);
      setComboPicks({});
      setComboModalOpen(true);
      setSearchText('');
    }
  };

  const setComboItemCount = (groupIndex: number, itemId: string, delta: number, required: number) => {
    setComboPicks((previous) => {
      const group = { ...(previous[groupIndex] ?? {}) };
      const current = group[itemId] ?? 0;
      const otherCount = Object.entries(group).filter(([id]) => id !== itemId).reduce<number>((sum, [, count]) => sum + Number(count), 0);
      const next = Math.max(0, Math.min(current + delta, required - otherCount));
      if (next === 0) delete group[itemId]; else group[itemId] = next;
      return { ...previous, [groupIndex]: group };
    });
  };

  const addSelectedCombo = () => {
    if (!selectedCombo) return;
    const missing = selectedCombo.groups.find((group) => {
      const picked = Object.values(comboPicks[group.groupIndex] ?? {}).reduce<number>((sum, count) => sum + Number(count), 0);
      return picked !== group.quantity;
    });
    if (missing) {
      Alert.alert('Complete combo choices', `Choose exactly ${missing.quantity} item(s) for ${missing.menuCategoryName}.`);
      return;
    }
    const selections = selectedCombo.groups.map((group) => {
      const ids: string[] = [];
      for (const [id, count] of Object.entries(comboPicks[group.groupIndex] ?? {})) {
        for (let i = 0; i < Number(count); i++) ids.push(id);
      }
      return { group_index: group.groupIndex, menu_item_ids: ids };
    });
    setOrder((previous) => [...previous, {
      id: `combo:${selectedCombo.id}:${Date.now()}`,
      name: selectedCombo.name,
      price: selectedCombo.price,
      category: 'Combo',
      isAvailable: true,
      qty: 1,
      line_type: 'combo',
      combo_id: selectedCombo.id,
      combo_selections: selections,
    }]);
    setComboModalOpen(false);
    setSelectedCombo(null);
    setComboPicks({});
  };

  const increaseQty = (id: string) => {
    setOrder((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const nextQty = i.qty + 1;
        const nextSel = buildLineSelections(i.lines, nextQty) ?? i.selections;
        return { ...i, qty: nextQty, selections: nextSel };
      }),
    );
  };

  const decreaseQty = (id: string) => {
    setOrder((prev) =>
      prev
        .map((i) => {
          if (i.id !== id) return i;
          const nextQty = i.qty - 1;
          if (nextQty <= 0) return null as unknown as OrderItem;
          const nextSel = buildLineSelections(i.lines, nextQty) ?? i.selections;
          return { ...i, qty: nextQty, selections: nextSel };
        })
        .filter(Boolean) as OrderItem[],
    );
  };

  const removeFromOrder = (id: string) => {
    setOrder((prev) => prev.filter((item) => item.id !== id));
  };

  const total = order.reduce((sum, item) => sum + item.price * item.qty, 0);

  const resetOrder = () => {
    setOrder([]);
    setCustomerName('');
    setCustomerPhone('');
    setTableNumber('');
    setDeliveryAddress('');
  };

  const handleCheckout = async () => {
    if (order.length === 0) {
      Alert.alert('Empty Order', 'Please add items first');
      return;
    }

    for (const item of order) {
      if (item.line_type === 'combo' || item.combo_id) continue;
      const msg = validateLineSelections(
        item.name,
        item.lines,
        item.selections,
        item.qty,
      );
      if (msg) {
        Alert.alert('Incomplete order', msg);
        return;
      }
    }

    const result = await submitOrder({
      order_type: orderType,
      table_number: tableNumber || undefined,
      customer_name: customerName || undefined,
      customer_phone: customerPhone || undefined,
      delivery_address: deliveryAddress || undefined,
      items: order.map((item) => ({
        line_type: item.line_type ?? 'menu_item',
        ...(item.line_type === 'combo'
          ? {
              combo_id: item.combo_id,
              combo_selections: (item.combo_selections ?? []).map((group) => ({
                ...group,
                menu_item_ids: Array.from({ length: item.qty }, () => group.menu_item_ids).flat(),
              })),
            }
          : { menu_item_id: item.id, menu_id: item.id }),
        menu_name: item.name,
        quantity: item.qty,
        unit_price: item.price,
        selling_price: item.price,
        selections: item.selections ?? [],
      })),
      total_amount: total,
      tax_amount: total * 0.16,
      discount_amount: 0,
      payment_method: 'cash',
    });

    if (!result.success) {
      Alert.alert('Checkout Failed', result.message);
      return;
    }

    // Optimistic local stock update only when online success
    if (!result.offline) {
      order.forEach((item) => {
        if (item.ingredients) {
          Object.entries(item.ingredients).forEach(([ingredient, qtyPer]) => {
            if (ingredient === 'dough') updateStockLocally('ST300', -qtyPer * item.qty);
            if (ingredient === 'cheese') updateStockLocally('A200', -qtyPer * item.qty);
          });
        }
      });
    }

    Alert.alert(
      result.offline ? 'Saved Offline' : 'Order Placed',
      `${result.message}\nTotal: KES ${total.toFixed(0)}`,
    );
    resetOrder();
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading menu...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.titleText}>POS - New Order</Text>

      <View style={styles.orderTypeContainer}>
        {(['dine-in', 'takeaway', 'delivery'] as const).map((type) => (
          <TouchableOpacity
            key={type}
            style={[
              styles.orderTypeButton,
              orderType === type && styles.orderTypeButtonActive,
            ]}
            onPress={() => setOrderType(type)}
          >
            <Text
              style={[
                styles.orderTypeText,
                orderType === type && styles.orderTypeTextActive,
              ]}
            >
              {type.replace('-', ' ').toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.customerSection}>
        <TextInput
          style={styles.input}
          placeholder="Customer Name"
          value={customerName}
          onChangeText={setCustomerName}
        />
        <TextInput
          style={styles.input}
          placeholder="Phone Number"
          value={customerPhone}
          onChangeText={setCustomerPhone}
          keyboardType="phone-pad"
        />
        {orderType === 'dine-in' && (
          <TextInput
            style={styles.input}
            placeholder="Table Number"
            value={tableNumber}
            onChangeText={setTableNumber}
          />
        )}
        {orderType === 'delivery' && (
          <TextInput
            style={styles.input}
            placeholder="Delivery Address"
            value={deliveryAddress}
            onChangeText={setDeliveryAddress}
          />
        )}
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Search menu items and combos…"
        value={searchText}
        onChangeText={setSearchText}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel="Search menu items and combos"
      />
      <FlatList
        data={searchHits}
        keyExtractor={(hit) => `${hit.kind}:${hit.id}`}
        style={styles.menuList}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.menuItem, !item.available && styles.menuItemUnavailable]}
            onPress={() => selectSearchHit(item)}
            disabled={!item.available}
            accessibilityRole="button"
            accessibilityState={{ disabled: !item.available }}
          >
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text style={[styles.menuName, !item.available && styles.unavailableText]}>{item.name}</Text>
              <Text style={styles.resultMeta}>
                {item.kind === 'combo' ? 'COMBO' : 'ITEM'}
                {item.category ? ` · ${item.category}` : ''}
                {item.kind === 'item' && item.menu?.maxPortions != null
                  ? ` · ${item.menu.maxPortions} left`
                  : ''}
                {!item.available ? ' · Unavailable' : ''}
              </Text>
            </View>
            <Text style={[styles.menuPrice, !item.available && styles.unavailableText]}>KES {item.price.toFixed(2)}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{debouncedSearch ? 'No menu item or combo found' : 'No menu items available'}</Text>
        }
      />

      <View style={styles.orderSummary}>
        <Text style={styles.subtitleText}>Current Order ({order.length})</Text>
        <FlatList
          data={order}
          keyExtractor={(item) => item.id}
          style={styles.orderList}
          renderItem={({ item }) => (
            <View style={styles.orderItem}>
              <View style={{ flex: 1 }}>
              <Text style={styles.orderName}>
                {item.name} × {item.qty}
              </Text>
              {item.selections && item.selections.length > 0 ? (
                <Text style={styles.resultMeta}>
                  {item.selections
                    .map(
                      (s) =>
                        `${s.finished_good_name || s.finished_good_id}×${s.quantity}`,
                    )
                    .join(' · ')}
                </Text>
              ) : null}
              </View>
              <View style={styles.quantityControls}>
                <TouchableOpacity onPress={() => decreaseQty(item.id)} style={styles.qtyButton}>
                  <Text>-</Text>
                </TouchableOpacity>
                <Text>{item.qty}</Text>
                <TouchableOpacity onPress={() => increaseQty(item.id)} style={styles.qtyButton}>
                  <Text>+</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeFromOrder(item.id)}>
                  <Text style={styles.removeText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyOrder}>Tap menu items to start</Text>
          }
        />

        {order.length > 0 && (
          <Text style={styles.totalAmount}>KES {total.toFixed(0)}</Text>
        )}

        <TouchableOpacity
          style={[
            styles.checkoutButton,
            (order.length === 0 || isSubmitting) && styles.checkoutDisabled,
          ]}
          onPress={handleCheckout}
          disabled={order.length === 0 || isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.checkoutText}>
              Checkout · KES {total.toFixed(0)}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal visible={comboModalOpen} animationType="slide" transparent onRequestClose={() => setComboModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.comboModal}>
            <Text style={styles.comboModalTitle}>{selectedCombo?.name ?? 'Choose combo items'}</Text>
            <Text style={styles.resultMeta}>Select the required items for each group.</Text>
            <ScrollView style={styles.comboScroll} keyboardShouldPersistTaps="handled">
              {selectedCombo?.groups.map((group) => {
                const category = categories.find((row) => row.id === group.menuCategoryId);
                const options = (category?.menuItemIds ?? []).map((id) => menu.find((item) => item.id === id)).filter((item): item is MenuItem => !!item);
                const picked = Object.values(comboPicks[group.groupIndex] ?? {}).reduce<number>((sum, count) => sum + Number(count), 0);
                return (
                  <View key={group.groupIndex} style={styles.comboGroup}>
                    <Text style={styles.comboGroupTitle}>{group.menuCategoryName || category?.name || 'Selection'} · choose {group.quantity} ({picked}/{group.quantity})</Text>
                    {options.map((option) => {
                      const count = comboPicks[group.groupIndex]?.[option.id] ?? 0;
                      return (
                        <View key={option.id} style={styles.comboOption}>
                          <Text style={styles.comboOptionName}>{option.name}</Text>
                          <View style={styles.quantityControls}>
                            <TouchableOpacity style={styles.qtyButton} disabled={count <= 0} onPress={() => setComboItemCount(group.groupIndex, option.id, -1, group.quantity)}><Text>-</Text></TouchableOpacity>
                            <Text>{count}</Text>
                            <TouchableOpacity style={styles.qtyButton} disabled={picked >= group.quantity} onPress={() => setComboItemCount(group.groupIndex, option.id, 1, group.quantity)}><Text>+</Text></TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                    {options.length === 0 ? <Text style={styles.resultMeta}>No items found for this combo group.</Text> : null}
                  </View>
                );
              })}
            </ScrollView>
            <Text style={styles.comboPrice}>KES {(selectedCombo?.price ?? 0).toFixed(2)}</Text>
            <View style={styles.comboActions}>
              <TouchableOpacity style={styles.cancelComboButton} onPress={() => { setComboModalOpen(false); setSelectedCombo(null); setComboPicks({}); }}><Text style={styles.cancelComboText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.addComboButton} onPress={addSelectedCombo}><Text style={styles.addComboText}>Add combo to order</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* CHOICE component picker — web NewOrderPanel parity */}
      <Modal
        visible={!!choiceMenu}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setChoiceMenu(null);
          setChoicePicks({});
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.subtitleText}>
              {choiceMenu?.name ?? 'Options'}
            </Text>
            <Text style={styles.resultMeta}>
              Choose options for each component (same as web POS)
            </Text>
            <ScrollView style={{ maxHeight: 360, marginVertical: spacing.sm }}>
              {(choiceMenu ? choiceLinesNeedingPick(choiceMenu.lines) : []).map(
                (line) => (
                  <View key={line.componentKey} style={{ marginBottom: spacing.md }}>
                    <Text style={styles.orderName}>
                      {line.finishedGoodCategoryName || line.componentKey}
                    </Text>
                    {(line.options ?? []).map((opt) => {
                      const selected =
                        choicePicks[line.componentKey] === opt.finishedGoodId;
                      const oos = (opt.availableStock ?? 0) <= 0;
                      return (
                        <TouchableOpacity
                          key={opt.finishedGoodId}
                          disabled={oos && !selected}
                          style={[
                            styles.choiceOption,
                            selected && styles.choiceOptionSelected,
                            oos && !selected && styles.menuItemUnavailable,
                          ]}
                          onPress={() =>
                            setChoicePicks((prev) => ({
                              ...prev,
                              [line.componentKey]: opt.finishedGoodId,
                            }))
                          }
                        >
                          <Text style={styles.menuName}>
                            {opt.finishedGoodName || opt.finishedGoodId}
                          </Text>
                          <Text style={styles.resultMeta}>
                            {oos
                              ? 'Out of stock'
                              : `Stock ${opt.availableStock ?? '—'}`}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ),
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.qtyButton}
                onPress={() => {
                  setChoiceMenu(null);
                  setChoicePicks({});
                }}
              >
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.checkoutButton}
                onPress={confirmChoicePicks}
              >
                <Text style={styles.checkoutText}>Add to order</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.md,
    maxHeight: '85%',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  choiceOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  choiceOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FFF5EB',
  },

  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: spacing.md, color: colors.textSecondary },
  errorText: { color: colors.danger, textAlign: 'center' },
  titleText: { fontSize: 22, fontWeight: '700', marginBottom: spacing.md, color: colors.textPrimary },
  subtitleText: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  orderTypeContainer: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  orderTypeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  orderTypeButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  orderTypeText: { fontWeight: '600', color: colors.textPrimary, fontSize: 12 },
  orderTypeTextActive: { color: '#fff' },
  customerSection: { marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
  },
  searchInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, marginBottom: spacing.sm, color: colors.textPrimary },
  menuList: { flex: 1 },
  resultMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  menuItemUnavailable: { opacity: 0.48 },
  unavailableText: { color: colors.textSecondary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.md },
  comboModal: { maxHeight: '90%', backgroundColor: colors.background, borderRadius: 16, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  comboModalTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  comboScroll: { marginTop: spacing.md, flexGrow: 0 },
  comboGroup: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.sm, marginBottom: spacing.sm },
  comboGroupTitle: { fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  comboOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  comboOptionName: { flex: 1, color: colors.textPrimary },
  comboPrice: { fontSize: 18, fontWeight: '700', color: colors.primary, textAlign: 'right', marginTop: spacing.sm },
  comboActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  cancelComboButton: { flex: 1, borderRadius: 10, padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelComboText: { color: colors.textPrimary, fontWeight: '600' },
  addComboButton: { flex: 2, borderRadius: 10, padding: spacing.md, backgroundColor: colors.primary, alignItems: 'center' },
  addComboText: { color: '#fff', fontWeight: '700' },
  menuItem: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuName: { fontWeight: '600', color: colors.textPrimary },
  menuPrice: { color: colors.primary, fontWeight: '700' },
  orderSummary: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '45%',
  },
  orderList: { maxHeight: 180 },
  orderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  orderName: { flex: 1, color: colors.textPrimary },
  quantityControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qtyButton: {
    width: 28,
    height: 28,
    backgroundColor: colors.border,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: colors.danger, fontWeight: '700' },
  totalAmount: {
    marginTop: spacing.sm,
    fontSize: 20,
    fontWeight: '700',
    color: colors.success,
    textAlign: 'right',
  },
  checkoutButton: {
    backgroundColor: colors.success,
    paddingVertical: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  checkoutDisabled: { opacity: 0.6 },
  checkoutText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  emptyOrder: { textAlign: 'center', color: colors.textSecondary, padding: spacing.md },
  emptyText: { textAlign: 'center', color: colors.textSecondary, padding: spacing.lg },
});