// Canonical navigation types live in src/navigation/types.ts.
// Keep this legacy import path as a re-export to prevent route-type drift.
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { RootStackParamList as CanonicalRootStackParamList } from '../navigation/types';

export type RootStackParamList = CanonicalRootStackParamList;
export type ScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
export type RootNavigationProp =
  NativeStackNavigationProp<RootStackParamList>;
