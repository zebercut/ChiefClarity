import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { Theme } from "../../constants/themes";

interface TopicSuggestionCardProps {
  topic: string;
  count: number;
  threshold: number;
  onAccept: () => void;
  onReject: () => void;
  onDefer: () => void;
  theme: Theme;
}

export default function TopicSuggestionCard({
  topic,
  count,
  threshold,
  onAccept,
  onReject,
  onDefer,
  theme,
}: TopicSuggestionCardProps) {
  return (
    <View
      style={[
        sc.card,
        {
          backgroundColor: theme.accent + "10",
          borderColor: theme.accent + "30",
        },
      ]}
    >
      <Text style={[sc.topicName, { color: theme.text }]}>
        {"\u2728"} {topic}
      </Text>
      <Text style={[sc.description, { color: theme.textMuted }]}>
        Mentioned {count} times across tasks and notes
      </Text>
      <View style={sc.btnRow}>
        <TouchableOpacity
          style={[sc.btn, { backgroundColor: theme.accent }]}
          onPress={onAccept}
        >
          <Text style={[sc.btnText, { color: "#ffffff" }]}>Create</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            sc.btn,
            {
              backgroundColor: theme.bgTertiary,
              borderWidth: 1,
              borderColor: theme.borderLight,
            },
          ]}
          onPress={onReject}
        >
          <Text style={[sc.btnText, { color: theme.textSecondary }]}>
            Dismiss
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            sc.btn,
            {
              backgroundColor: theme.bgTertiary,
              borderWidth: 1,
              borderColor: theme.borderLight,
            },
          ]}
          onPress={onDefer}
        >
          <Text style={[sc.btnText, { color: theme.textSecondary }]}>
            Later
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const sc = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  topicName: {
    fontSize: 14,
    fontWeight: "600",
  },
  description: {
    fontSize: 12,
    marginTop: 2,
  },
  btnRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  btnText: {
    fontSize: 11,
    fontWeight: "600",
  },
});
