import type { ThemeMode } from "../types";

export interface Theme {
  mode: ThemeMode;
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  border: string;
  borderLight: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  danger: string;
  userBubble: string;
  userBubbleText: string;
  aiBubble: string;
  aiBubbleBorder: string;
  aiBubbleText: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  placeholder: string;
  chipBg: string;
  chipBorder: string;
  chipText: string;
  statusDotAccent: string;
  statusDotDanger: string;
  statusDotSecondary: string;
}

const dark: Theme = {
  mode: "dark",
  bg: "#09090b",
  bgSecondary: "#18181b",
  bgTertiary: "#27272a",
  border: "#18181b",
  borderLight: "#27272a",
  text: "#fafafa",
  textSecondary: "#a1a1aa",
  textMuted: "#71717a",
  accent: "#6366f1",
  accentSoft: "#4f46e5",
  danger: "#ef4444",
  userBubble: "#6366f1",
  userBubbleText: "#ffffff",
  aiBubble: "#18181b",
  aiBubbleBorder: "#27272a",
  aiBubbleText: "#e4e4e7",
  inputBg: "#18181b",
  inputBorder: "#27272a",
  inputText: "#fafafa",
  placeholder: "#555",
  chipBg: "#27272a",
  chipBorder: "#3f3f46",
  chipText: "#a1a1aa",
  statusDotAccent: "#6366f1",
  statusDotDanger: "#ef4444",
  statusDotSecondary: "#8b5cf6",
};

const light: Theme = {
  mode: "light",
  bg: "#ffffff",
  bgSecondary: "#f4f4f5",
  bgTertiary: "#e4e4e7",
  border: "#e4e4e7",
  borderLight: "#d4d4d8",
  text: "#18181b",
  textSecondary: "#52525b",
  textMuted: "#a1a1aa",
  accent: "#6366f1",
  accentSoft: "#4f46e5",
  danger: "#dc2626",
  userBubble: "#6366f1",
  userBubbleText: "#ffffff",
  aiBubble: "#f4f4f5",
  aiBubbleBorder: "#e4e4e7",
  aiBubbleText: "#27272a",
  inputBg: "#f4f4f5",
  inputBorder: "#d4d4d8",
  inputText: "#18181b",
  placeholder: "#a1a1aa",
  chipBg: "#e4e4e7",
  chipBorder: "#d4d4d8",
  chipText: "#52525b",
  statusDotAccent: "#6366f1",
  statusDotDanger: "#dc2626",
  statusDotSecondary: "#7c3aed",
};

export const themes: Record<ThemeMode, Theme> = { dark, light };
