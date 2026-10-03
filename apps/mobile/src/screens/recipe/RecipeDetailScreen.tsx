// apps/mobile/src/screens/recipe/RecipeDetailScreen.tsx
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography } from '../../lib/theme';

type RootStackParamList = {
  RecipeDetail: { recipe: any };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'RecipeDetail'>;

export default function RecipeDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute();
  const { recipe } = route.params as { recipe: any };

  if (!recipe) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Recipe not found</Text>
      </View>
    );
  }

  const handleEdit = () => {
    Alert.alert('Edit Recipe', 'This feature is coming soon!');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={typography.title}>{recipe.item_name}</Text>
        <Text style={styles.recipeId}>Recipe ID: {recipe.recipe_id || 'N/A'}</Text>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.row}>
          <View style={styles.half}>
            <Text style={styles.label}>Standard Yield</Text>
            <Text style={styles.value}>
              {recipe.standard_yield} {recipe.unit}
            </Text>
          </View>
          <View style={styles.half}>
            <Text style={styles.label}>Status</Text>
            <Text style={[styles.value, { color: colors.success }]}>Active</Text>
          </View>
        </View>

        {recipe.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.label}>Notes</Text>
            <Text style={styles.notes}>{recipe.notes}</Text>
          </View>
        )}
      </View>

      <Text style={typography.subtitle}>Ingredients (Bill of Materials)</Text>
      
      <View style={styles.ingredientsContainer}>
        {recipe.ingredients && recipe.ingredients.length > 0 ? (
          recipe.ingredients.map((ing: any, index: number) => (
            <View key={index} style={styles.ingredientRow}>
              <Text style={styles.ingredientName}>{ing.raw_item_name}</Text>
              <Text style={styles.ingredientQty}>
                {ing.quantity_per_unit} {ing.unit}
              </Text>
            </View>
          ))
        ) : (
          <View style={styles.emptyIngredients}>
            <Text style={styles.emptyText}>No ingredients added yet</Text>
            <Text style={styles.emptySubText}>Add ingredients to this recipe</Text>
          </View>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.editButton} onPress={handleEdit}>
          <Text style={styles.editButtonText}>Edit Recipe</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.deleteButton}
          onPress={() => Alert.alert('Delete', 'This feature is coming soon')}
        >
          <Text style={styles.deleteButtonText}>Delete Recipe</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: spacing.lg,
  },
  recipeId: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  half: {
    flex: 1,
  },
  label: {
    ...typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  value: {
    ...typography.body,
    fontWeight: '600',
  },
  notesSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  notes: {
    ...typography.small,
    fontStyle: 'italic',
    color: colors.textSecondary,
  },
  ingredientsContainer: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  ingredientName: {
    ...typography.body,
    flex: 1,
  },
  ingredientQty: {
    ...typography.body,
    fontWeight: '600',
    color: colors.primary,
  },
  emptyIngredients: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptySubText: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  editButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
  },
  editButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  errorText: {
    color: colors.danger,
    fontSize: 18,
  },
});