import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Feature, FeatureStatus, MoSCoW, FeatureSortField } from "../types";
import { FeatureTableProps, FeatureTableFilters, FeatureTableTheme } from "./types";

const STATUS_COLORS: Record<FeatureStatus, string> = {
  Planned: "#3b82f6",
  "In Progress": "#f59e0b",
  Done: "#22c55e",
  Rejected: "#ef4444",
};

const MOSCOW_COLORS: Record<MoSCoW, string> = {
  MUST: "#ef4444",
  SHOULD: "#f59e0b",
  COULD: "#3b82f6",
  WONT: "#6b7280",
};

const ALL_STATUSES: FeatureStatus[] = ["Planned", "In Progress", "Done", "Rejected"];
const ALL_MOSCOW: MoSCoW[] = ["MUST", "SHOULD", "COULD", "WONT"];
const SORT_FIELDS: FeatureSortField[] = ["priority", "status", "category", "id"];

function FilterChip({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: FeatureTableTheme;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.accent : theme.bgSecondary,
          borderColor: active ? theme.accent : theme.border,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? "#fff" : theme.textSecondary }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function StatusBadge({ status }: { status: FeatureStatus }) {
  return (
    <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] + "22" }]}>
      <Text style={[styles.badgeText, { color: STATUS_COLORS[status] }]}>{status}</Text>
    </View>
  );
}

function MoscowPill({ moscow }: { moscow: MoSCoW }) {
  return (
    <View style={[styles.pill, { backgroundColor: MOSCOW_COLORS[moscow] + "22" }]}>
      <Text style={[styles.pillText, { color: MOSCOW_COLORS[moscow] }]}>{moscow}</Text>
    </View>
  );
}

export function FeatureTable({
  features,
  theme,
  filters: externalFilters,
  onFeaturePress,
  onFilterChange,
  sortBy: externalSort,
  onSortChange,
}: FeatureTableProps) {
  const [internalFilters, setInternalFilters] = useState<FeatureTableFilters>({});
  const [internalSort, setInternalSort] = useState<FeatureSortField>("priority");

  const filters = externalFilters ?? internalFilters;
  const sortBy = externalSort ?? internalSort;

  const setFilters = (f: FeatureTableFilters) => {
    if (onFilterChange) onFilterChange(f);
    else setInternalFilters(f);
  };

  const setSort = (s: FeatureSortField) => {
    if (onSortChange) onSortChange(s);
    else setInternalSort(s);
  };

  const categories = useMemo(
    () => [...new Set(features.map((f) => f.category))].sort(),
    [features]
  );

  const filtered = useMemo(() => {
    let result = features;
    if (filters.status) result = result.filter((f) => f.status === filters.status);
    if (filters.category) result = result.filter((f) => f.category === filters.category);
    if (filters.moscow) result = result.filter((f) => f.moscow === filters.moscow);
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "priority":
          return (a.priority ?? 999) - (b.priority ?? 999);
        case "status":
          return a.status.localeCompare(b.status);
        case "category":
          return a.category.localeCompare(b.category);
        case "id":
        default:
          return a.id.localeCompare(b.id);
      }
    });
  }, [features, filters, sortBy]);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Filter bar */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <FilterChip
            label="All"
            active={!filters.status}
            onPress={() => setFilters({ ...filters, status: undefined })}
            theme={theme}
          />
          {ALL_STATUSES.map((s) => (
            <FilterChip
              key={s}
              label={s}
              active={filters.status === s}
              onPress={() =>
                setFilters({ ...filters, status: filters.status === s ? undefined : s })
              }
              theme={theme}
            />
          ))}
        </ScrollView>
      </View>

      {/* Category filter */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <FilterChip
            label="All Categories"
            active={!filters.category}
            onPress={() => setFilters({ ...filters, category: undefined })}
            theme={theme}
          />
          {categories.map((c) => (
            <FilterChip
              key={c}
              label={c}
              active={filters.category === c}
              onPress={() =>
                setFilters({ ...filters, category: filters.category === c ? undefined : c })
              }
              theme={theme}
            />
          ))}
        </ScrollView>
      </View>

      {/* Sort bar */}
      <View style={[styles.sortBar, { borderBottomColor: theme.border }]}>
        <Text style={[styles.sortLabel, { color: theme.textMuted }]}>Sort: </Text>
        {SORT_FIELDS.map((f) => (
          <TouchableOpacity key={f} onPress={() => setSort(f)} style={styles.sortOption}>
            <Text
              style={[
                styles.sortText,
                { color: sortBy === f ? theme.accent : theme.textSecondary },
              ]}
            >
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Feature list */}
      <ScrollView style={styles.list}>
        {filtered.map((feature) => (
          <TouchableOpacity
            key={feature.id}
            onPress={() => onFeaturePress?.(feature)}
            disabled={!onFeaturePress}
            style={[
              styles.row,
              { backgroundColor: theme.bgSecondary, borderColor: theme.border },
            ]}
          >
            <View style={styles.rowHeader}>
              <Text style={[styles.featureId, { color: theme.textMuted }]}>{feature.id}</Text>
              <MoscowPill moscow={feature.moscow} />
              <StatusBadge status={feature.status} />
            </View>
            <Text style={[styles.featureTitle, { color: theme.text }]}>{feature.title}</Text>
            <View style={styles.rowFooter}>
              <Text style={[styles.category, { color: theme.textSecondary }]}>
                {feature.category}
              </Text>
              {feature.priority !== null && (
                <Text style={[styles.priority, { color: theme.textMuted }]}>
                  P{feature.priority}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        ))}
        {filtered.length === 0 && (
          <Text style={[styles.empty, { color: theme.textMuted }]}>No features match filters</Text>
        )}
      </ScrollView>

      {/* Count */}
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Text style={[styles.count, { color: theme.textMuted }]}>
          {filtered.length} of {features.length} features
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterBar: { paddingHorizontal: 12, paddingVertical: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  chipText: { fontSize: 13, fontWeight: "500" },
  sortBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  sortLabel: { fontSize: 12 },
  sortOption: { marginLeft: 12 },
  sortText: { fontSize: 12, fontWeight: "600" },
  list: { flex: 1 },
  row: {
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  featureId: { fontSize: 12, fontWeight: "600", fontFamily: "monospace" },
  featureTitle: { fontSize: 15, fontWeight: "500", marginBottom: 4 },
  rowFooter: { flexDirection: "row", alignItems: "center", gap: 12 },
  category: { fontSize: 12 },
  priority: { fontSize: 12, fontWeight: "600" },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  pillText: { fontSize: 11, fontWeight: "700" },
  empty: { textAlign: "center", padding: 24, fontSize: 14 },
  footer: { borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  count: { fontSize: 12 },
});
