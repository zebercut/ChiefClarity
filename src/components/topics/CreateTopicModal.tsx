/**
 * Shared modal for creating a new topic from anywhere in the app.
 * Used by the Topics list page (bare create) and the Reassign picker (create + reassign).
 */
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Pressable,
} from "react-native";
import type { Theme } from "../../constants/themes";

interface Props {
  theme: Theme;
  existingSlugs: string[];        // used to block dupes with a friendly message
  onCancel: () => void;
  onCreate: (name: string, aliases: string[]) => Promise<void> | void;
  /** Optional override for the Save button label (e.g. "Create & reassign") */
  ctaLabel?: string;
  /** Optional helper sentence rendered under the title */
  helperText?: string;
}

export default function CreateTopicModal({
  theme, existingSlugs, onCancel, onCreate, ctaLabel, helperText,
}: Props) {
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name is required."); return; }
    const slug = slugify(trimmed);
    if (!slug) { setError("Name must contain at least one letter or number."); return; }
    if (existingSlugs.includes(slug)) { setError("A topic with this name already exists."); return; }

    const aliasList = aliases
      .split(",")
      .map(a => a.trim())
      .filter(a => a.length > 0);

    setBusy(true);
    try {
      await onCreate(trimmed, aliasList);
    } catch (err: any) {
      setError(err?.message || "Could not create topic.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        {/* Sibling Pressable covers the full screen behind the panel. Any tap on
            the panel itself is caught by the panel's children and never reaches
            this Pressable, so typing in the TextInput doesn't dismiss the modal.
            Previous version wrapped the panel in a TouchableOpacity, which on
            react-native-web fires onPress even for taps inside the panel. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View
          style={[s.panel, { backgroundColor: theme.bgSecondary, borderColor: theme.borderLight }]}
        >
          <Text style={[s.title, { color: theme.text }]}>New topic</Text>
          {helperText && (
            <Text style={[s.helper, { color: theme.textMuted }]}>{helperText}</Text>
          )}

          <ScrollView style={{ maxHeight: 320 }}>
            <Text style={[s.label, { color: theme.textSecondary }]}>Name</Text>
            <TextInput
              style={[s.input, { color: theme.text, borderColor: theme.borderLight, backgroundColor: theme.bg }]}
              placeholder="e.g. Finance"
              placeholderTextColor={theme.placeholder}
              value={name}
              onChangeText={(v) => { setName(v); setError(null); }}
              autoFocus
              editable={!busy}
            />

            <Text style={[s.label, { color: theme.textSecondary, marginTop: 10 }]}>
              Aliases (optional, comma-separated)
            </Text>
            <TextInput
              style={[s.input, { color: theme.text, borderColor: theme.borderLight, backgroundColor: theme.bg }]}
              placeholder="e.g. money, budget, taxes"
              placeholderTextColor={theme.placeholder}
              value={aliases}
              onChangeText={setAliases}
              editable={!busy}
            />
            <Text style={[s.hint, { color: theme.textMuted }]}>
              Aliases help auto-match tasks whose titles use different words for the same topic.
            </Text>
          </ScrollView>

          {error && (
            <Text style={[s.error, { color: theme.danger || "#ef4444" }]}>{error}</Text>
          )}

          <View style={s.actions}>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: theme.bgTertiary, borderColor: theme.borderLight }]}
              onPress={onCancel}
              disabled={busy}
            >
              <Text style={[s.btnText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}
              onPress={handleSubmit}
              disabled={busy}
            >
              <Text style={[s.btnText, { color: "#fff" }]}>
                {busy ? "Saving…" : (ctaLabel || "Create")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  panel: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    width: "100%",
    maxWidth: 420,
  },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  helper: { fontSize: 12, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "600", marginTop: 4, marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  hint: { fontSize: 11, marginTop: 4 },
  error: { fontSize: 12, marginTop: 8 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  btn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  btnText: { fontSize: 12, fontWeight: "600" },
});
