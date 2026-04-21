import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";

interface TopicCardProps {
  name: string;
  taskCount: number;
  eventCount: number;
  signalCount: number;
  lastActive: string;
  priorityBreakdown: { high: number; medium: number; low: number };
  colorDot: string;
  onPress: () => void;
  theme: Theme;
  archived?: boolean;
}

const PRIORITY_COLORS = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

export default function TopicCard({
  name,
  taskCount,
  eventCount,
  signalCount,
  lastActive,
  priorityBreakdown,
  colorDot,
  onPress,
  theme,
  archived,
}: TopicCardProps) {
  const hasAnyPriority =
    priorityBreakdown.high > 0 ||
    priorityBreakdown.medium > 0 ||
    priorityBreakdown.low > 0;

  return (
    <TouchableOpacity
      style={[
        s.card,
        { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight },
        archived && { opacity: 0.6 },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Header row: dot + name + optional archived badge + chevron */}
      <View style={s.headerRow}>
        <View style={[s.dot, { backgroundColor: colorDot }]} />
        <Text style={[s.name, { color: theme.text }]} numberOfLines={1}>
          {name}
        </Text>
        {archived && (
          <Text style={[s.badge, { color: theme.textMuted, borderColor: theme.borderLight }]}>
            {"\u{1F4E6}"} archived
          </Text>
        )}
        <Text style={[s.chevron, { color: theme.textMuted }]}>{"\u2192"}</Text>
      </View>

      {/* Stats line */}
      <Text style={[s.stats, { color: theme.textSecondary }]}>
        {taskCount} tasks {"\u00B7"} {eventCount} events {"\u00B7"} {signalCount} signals
      </Text>

      {/* Last active */}
      <Text style={[s.lastActive, { color: theme.textMuted }]}>
        Last active: {lastActive}
      </Text>

      {/* Priority pills */}
      {hasAnyPriority && (
        <View style={s.pillRow}>
          {priorityBreakdown.high > 0 && (
            <View style={[s.pill, { backgroundColor: PRIORITY_COLORS.high + "15" }]}>
              <Text style={[s.pillText, { color: PRIORITY_COLORS.high }]}>
                HIGH {priorityBreakdown.high}
              </Text>
            </View>
          )}
          {priorityBreakdown.medium > 0 && (
            <View style={[s.pill, { backgroundColor: PRIORITY_COLORS.medium + "15" }]}>
              <Text style={[s.pillText, { color: PRIORITY_COLORS.medium }]}>
                MEDIUM {priorityBreakdown.medium}
              </Text>
            </View>
          )}
          {priorityBreakdown.low > 0 && (
            <View style={[s.pill, { backgroundColor: PRIORITY_COLORS.low + "15" }]}>
              <Text style={[s.pillText, { color: PRIORITY_COLORS.low }]}>
                LOW {priorityBreakdown.low}
              </Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  chevron: {
    fontSize: 16,
  },
  badge: {
    fontSize: 10,
    fontWeight: "600",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  stats: {
    fontSize: 12,
    marginTop: 6,
  },
  lastActive: {
    fontSize: 11,
    marginTop: 2,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pillText: {
    fontSize: 10,
    fontWeight: "700",
  },
});
