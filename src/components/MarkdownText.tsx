import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import type { Theme } from "../constants/themes";

interface Props {
  children: string;
  theme: Theme;
}

/**
 * Lightweight markdown renderer for chat bubbles.
 * Handles: headers, bold, italic, tables, lists, hr, blockquotes, inline code.
 * No external dependencies — works on web and mobile.
 */
export default function MarkdownText({ children, theme }: Props) {
  const lines = children.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<View key={i} style={[ms.hr, { backgroundColor: theme.borderLight }]} />);
      i++;
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length as 1 | 2 | 3;
      const headerStyles = {
        1: { fontSize: 19, fontWeight: "700" as const },
        2: { fontSize: 17, fontWeight: "700" as const },
        3: { fontSize: 15, fontWeight: "600" as const },
      };
      elements.push(
        <Text key={i} style={[ms.header, headerStyles[level], { color: theme.text }]}>
          {renderInline(headerMatch[2], theme)}
        </Text>
      );
      i++;
      continue;
    }

    // Table detection
    if (i + 1 < lines.length && /^\|.*\|$/.test(line.trim()) && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(renderTable(tableLines, theme, elements.length));
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      elements.push(
        <View key={`ul-${i}`} style={ms.list}>
          {listItems.map((item, j) => (
            <View key={j} style={ms.listItem}>
              <Text style={[ms.bullet, { color: theme.accent }]}>{"\u2022"}</Text>
              <Text style={[ms.listText, { color: theme.aiBubbleText }]}>
                {renderInline(item, theme)}
              </Text>
            </View>
          ))}
        </View>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      elements.push(
        <View key={`ol-${i}`} style={ms.list}>
          {listItems.map((item, j) => (
            <View key={j} style={ms.listItem}>
              <Text style={[ms.olNum, { color: theme.accent }]}>{j + 1}.</Text>
              <Text style={[ms.listText, { color: theme.aiBubbleText }]}>
                {renderInline(item, theme)}
              </Text>
            </View>
          ))}
        </View>
      );
      continue;
    }

    // Blockquote
    if (/^>\s*/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s*/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s*/, ""));
        i++;
      }
      elements.push(
        <View key={`bq-${i}`} style={[ms.blockquote, { borderLeftColor: theme.accent, backgroundColor: theme.bgSecondary }]}>
          <Text style={[ms.bodyText, { color: theme.aiBubbleText }]}>
            {renderInline(quoteLines.join(" "), theme)}
          </Text>
        </View>
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<View key={i} style={ms.spacer} />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <Text key={i} style={[ms.bodyText, { color: theme.aiBubbleText }]}>
        {renderInline(line, theme)}
      </Text>
    );
    i++;
  }

  return <View>{elements}</View>;
}

/** Render inline markdown: **bold**, *italic*, `code`, ~~strike~~ */
function renderInline(text: string, theme: Theme): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Regex matches **bold**, *italic*, `code` in order
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      parts.push(
        <Text key={key++} style={{ fontWeight: "600", color: theme.text }}>
          {match[2]}
        </Text>
      );
    } else if (match[3]) {
      // *italic*
      parts.push(
        <Text key={key++} style={{ fontStyle: "italic" }}>
          {match[3]}
        </Text>
      );
    } else if (match[4]) {
      // `code`
      parts.push(
        <Text
          key={key++}
          style={{
            backgroundColor: theme.bgTertiary,
            color: theme.accent,
            borderRadius: 3,
            paddingHorizontal: 4,
            fontSize: 13,
            fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
          }}
        >
          {match[4]}
        </Text>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}

/** Render a markdown table */
function renderTable(lines: string[], theme: Theme, keyBase: number): React.ReactNode {
  const parseRow = (line: string) =>
    line.split("|").slice(1, -1).map((c) => c.trim());

  const headerCells = parseRow(lines[0]);
  // Skip separator line (index 1)
  const bodyRows = lines.slice(2).map(parseRow);

  return (
    <View key={`table-${keyBase}`} style={[ms.table, { borderColor: theme.borderLight }]}>
      {/* Header */}
      <View style={[ms.tableRow, { backgroundColor: theme.bgTertiary }]}>
        {headerCells.map((cell, j) => (
          <View key={j} style={[ms.tableCell, j < headerCells.length - 1 && { borderRightWidth: 1, borderRightColor: theme.borderLight }]}>
            <Text style={[ms.tableCellText, { color: theme.text, fontWeight: "600" }]}>
              {renderInline(cell, theme)}
            </Text>
          </View>
        ))}
      </View>
      {/* Body */}
      {bodyRows.map((row, ri) => (
        <View key={ri} style={[ms.tableRow, { borderTopWidth: 1, borderTopColor: theme.borderLight }]}>
          {row.map((cell, j) => (
            <View key={j} style={[ms.tableCell, j < row.length - 1 && { borderRightWidth: 1, borderRightColor: theme.borderLight }]}>
              <Text style={[ms.tableCellText, { color: theme.aiBubbleText }]}>
                {renderInline(cell, theme)}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const ms = StyleSheet.create({
  bodyText: { fontSize: 15, lineHeight: 22, marginVertical: 2 },
  header: { marginTop: 10, marginBottom: 4 },
  hr: { height: 1, marginVertical: 10 },
  spacer: { height: 8 },
  list: { marginVertical: 4 },
  listItem: { flexDirection: "row", alignItems: "flex-start", marginVertical: 2, paddingRight: 8 },
  bullet: { width: 16, fontSize: 15, lineHeight: 22, textAlign: "center" },
  olNum: { width: 20, fontSize: 14, lineHeight: 22, textAlign: "right", marginRight: 4, fontWeight: "600" },
  listText: { flex: 1, fontSize: 15, lineHeight: 22 },
  blockquote: { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 4, marginVertical: 6, borderRadius: 4 },
  table: { borderWidth: 1, borderRadius: 8, marginVertical: 8, overflow: "hidden" },
  tableRow: { flexDirection: "row" },
  tableCell: { flex: 1, padding: 8 },
  tableCellText: { fontSize: 13, lineHeight: 18 },
});
