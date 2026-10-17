import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { RootNavigationProp } from '../../types/navigation';
import type { RootStackParamList } from '../../navigation/types';
import { useRole } from '../../hooks/useRole';
import { colors, spacing, typography } from '../../lib/theme';

type ModuleItem = { title: string; description: string; route: keyof RootStackParamList; roles?: string[] };
const GROUPS: { title: string; items: ModuleItem[] }[] = [
  { title: 'Daily operations', items: [
    { title: 'Inventory & stock', description: 'Stock levels, urgency, and item details', route: 'StockOverview' },
    { title: 'Receive goods', description: 'Record incoming stock and deliveries', route: 'Receive', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'Kitchen orders', description: 'View active orders and update kitchen status', route: 'KitchenDisplay', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'POS', description: 'Create orders and send them to the kitchen', route: 'PosOrder', roles: ['ADMIN', 'MANAGER', 'POS'] },
  ] },
  { title: 'Kitchen & production', items: [
    { title: 'Production workspace', description: 'Start batches, find active production, and finish batches', route: 'Production', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'Production history', description: 'Review completed batches, expiry, and resulting stock', route: 'ProductionHistory', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'Recipes', description: 'Browse recipes and recipe details', route: 'RecipeList', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'Finished goods', description: 'Review finished product inventory', route: 'FinishedGoods', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'Pre-prep', description: 'Convert raw ingredients to prepped stock', route: 'PrePrep', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'Closing stock', description: 'Review and submit closing counts', route: 'ClosingStock', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'Refill request', description: 'Request stock replenishment', route: 'RefillRequest', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'Refill approvals', description: 'Review pending refill requests', route: 'RefillApproval', roles: ['ADMIN', 'MANAGER'] },
  ] },
  { title: 'Control & administration', items: [
    { title: 'Dashboard', description: 'Business and operational summaries', route: 'ManagerDashboard', roles: ['ADMIN', 'MANAGER'] },
    { title: 'Approvals', description: 'Review requests requiring approval', route: 'Approvals', roles: ['ADMIN', 'MANAGER'] },
    { title: 'Consumption & alerts', description: 'Review consumption value, food cost, and alerts', route: 'Consumption', roles: ['ADMIN', 'MANAGER'] },
    { title: 'Variance review', description: 'Investigate batch variances and assign reasons', route: 'Variance', roles: ['ADMIN', 'MANAGER'] },
    { title: 'Traceability', description: 'Search item and batch event timelines', route: 'Trace', roles: ['ADMIN', 'MANAGER'] },
    { title: 'Team management', description: 'View users and manage roles', route: 'Team', roles: ['ADMIN'] },
    { title: 'Menu & catalog', description: 'Browse menu items and catalog availability', route: 'MenuList', roles: ['ADMIN', 'MANAGER', 'POS'] },
    { title: 'Record waste', description: 'Record waste and its reason', route: 'RecordWaste', roles: ['ADMIN', 'MANAGER', 'KITCHEN'] },
    { title: 'Barcode scanner', description: 'Scan supported stock identifiers', route: 'BarcodeScanner' },
    { title: 'Notifications', description: 'Configure notification preferences', route: 'NotificationSettings' },
    { title: 'My profile', description: 'Account and session details', route: 'Profile' },
  ] },
];

export default function ModuleHubScreen() {
  const navigation = useNavigation<RootNavigationProp>();
  const { role } = useRole();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={typography.title}>All modules</Text>
      <Text style={styles.intro}>Choose a workspace. Available actions depend on your account permissions.</Text>
      {GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.roles || item.roles.includes(String(role ?? '')));
        if (!items.length) return null;
        return <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.grid}>{items.map((item) => <TouchableOpacity key={item.route} style={styles.card} activeOpacity={0.78} onPress={() => navigation.navigate(item.route as never)}>
            <View style={styles.cardTop}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.arrow}>›</Text></View>
            <Text style={styles.cardDescription}>{item.description}</Text>
          </TouchableOpacity>)}</View>
        </View>;
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.md, paddingBottom: spacing.xxl },
  intro: { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 20 },
  group: { marginTop: spacing.md }, groupTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, card: { width: '48%', flexGrow: 1, minHeight: 104, padding: spacing.md, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }, cardTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 14, flex: 1 }, arrow: { color: colors.primary, fontSize: 24, fontWeight: '700' }, cardDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
});
