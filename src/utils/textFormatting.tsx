import React from "react";
import { Text } from "react-native";

/**
 * Render markdown bold (**text**) as styled <Text> spans.
 * Splits on **..** and alternates between normal and bold.
 */
export function renderBold(
  text: string,
  boldColor: string
): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <Text key={i} style={{ fontWeight: "700", color: boldColor }}>
        {part}
      </Text>
    ) : (
      <Text key={i}>{part}</Text>
    )
  );
}
