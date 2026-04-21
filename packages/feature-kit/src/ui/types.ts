import { Feature, FeatureStatus, MoSCoW, FeatureSortField } from "../types";

export interface FeatureTableTheme {
  bg: string;
  bgSecondary: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  danger: string;
}

export interface FeatureTableFilters {
  status?: FeatureStatus;
  category?: string;
  moscow?: MoSCoW;
}

export interface FeatureTableProps {
  features: Feature[];
  theme: FeatureTableTheme;
  filters?: FeatureTableFilters;
  onFeaturePress?: (feature: Feature) => void;
  onFilterChange?: (filters: FeatureTableFilters) => void;
  sortBy?: FeatureSortField;
  onSortChange?: (field: FeatureSortField) => void;
}
