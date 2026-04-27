import React, { useContext, useEffect, useState } from "react";
import { Slot, usePathname, useRouter } from "expo-router";
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { ConfigContext } from "../_layout";
import type { Theme } from "../../src/constants/themes";
import { loadSkillRegistry } from "../../src/modules/skillRegistry";
import type { SkillSurface } from "../../src/types/skills";

const DESKTOP_BREAKPOINT = 900;
const SIDEBAR_WIDTH = 220;
const BOTTOM_BAR_HEIGHT = 60;

interface NavItem {
  name: string;
  path: string;
  label: string;
  icon: string;
}

const STATIC_NAV_ITEMS: NavItem[] = [
  { name: "chat", path: "/(tabs)/chat", label: "Chat", icon: "\u{1F4AC}" },
  { name: "tasks", path: "/(tabs)/tasks", label: "Tasks", icon: "\u2705" },
  { name: "notes", path: "/(tabs)/notes", label: "Notes", icon: "\u270D\uFE0F" },
  { name: "topics", path: "/(tabs)/topics", label: "Topics", icon: "\u{1F4DA}" },
  { name: "focus", path: "/(tabs)/focus", label: "Focus", icon: "\u{1F4CB}" },
];

function surfaceToNavItem(s: SkillSurface): NavItem {
  return { name: s.id, path: s.route, label: s.label, icon: s.icon };
}

// Static nav merged with skill-contributed surfaces. Surfaces append after
// static items (vision principle #13: shell is stable, skills join).
function useNavItems(): NavItem[] {
  const [surfaces, setSurfaces] = useState<SkillSurface[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadSkillRegistry()
      .then((reg) => {
        if (cancelled) return;
        setSurfaces(reg.getAllSurfaces());
      })
      .catch(() => {
        // Loader logs its own warning; nav falls back to static items.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return [...STATIC_NAV_ITEMS, ...surfaces.map(surfaceToNavItem)];
}

// Match against the route segment so nested paths like /tasks/123 still
// highlight the parent tab.
function isRouteFocused(pathname: string | null | undefined, name: string): boolean {
  if (!pathname) return false;
  const segments = pathname.split("/").filter(Boolean);
  return segments.includes(name);
}

export default function TabsLayout() {
  const { theme } = useContext(ConfigContext);
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: theme.bg },
        isDesktop && styles.rootDesktop,
      ]}
    >
      {isDesktop && <Sidebar theme={theme} />}
      <View style={styles.content}>
        <Slot />
      </View>
      {!isDesktop && <BottomBar theme={theme} />}
    </View>
  );
}

// ─── Desktop sidebar ────────────────────────────────────────────────────────

function Sidebar({ theme }: { theme: Theme }) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = useNavItems();

  return (
    <View
      style={[
        desktop.sidebar,
        { backgroundColor: theme.bg, borderRightColor: theme.borderLight },
      ]}
    >
      <View style={desktop.logoRow}>
        <View style={[desktop.logoMark, { backgroundColor: theme.accent }]}>
          <Text style={desktop.logoMarkText}>{"\u2728"}</Text>
        </View>
        <Text style={[desktop.logoText, { color: theme.text }]}>ChiefClarity</Text>
      </View>

      <View style={desktop.nav}>
        {navItems.map((item) => {
          const focused = isRouteFocused(pathname, item.name);
          return (
            <TouchableOpacity
              key={item.name}
              onPress={() => router.navigate(item.path as any)}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={item.label}
              style={[
                desktop.navItem,
                focused && { backgroundColor: theme.accent + "15" },
              ]}
            >
              <Text
                style={[
                  desktop.navIcon,
                  { color: focused ? theme.accent : theme.textSecondary },
                ]}
              >
                {item.icon}
              </Text>
              <Text
                style={[
                  desktop.navLabel,
                  {
                    color: focused ? theme.accent : theme.textSecondary,
                    fontWeight: focused ? "700" : "500",
                  },
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Footer: vault recovery link */}
      <View style={desktop.footer}>
        <TouchableOpacity
          onPress={() => router.navigate("/recovery" as any)}
          accessibilityRole="button"
          accessibilityLabel="Vault recovery"
          style={desktop.navItem}
        >
          <Text style={[desktop.navIcon, { color: theme.textMuted }]}>{"\u{1F511}"}</Text>
          <Text style={[desktop.navLabel, { color: theme.textMuted }]}>
            Vault
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Mobile bottom bar ──────────────────────────────────────────────────────

function BottomBar({ theme }: { theme: Theme }) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = useNavItems();

  return (
    <View
      style={[
        mobile.bar,
        { backgroundColor: theme.bg, borderTopColor: theme.borderLight },
      ]}
    >
      {navItems.map((item) => {
        const focused = pathname?.endsWith(`/${item.name}`) ?? false;
        const color = focused ? theme.accent : theme.textMuted;
        return (
          <TouchableOpacity
            key={item.name}
            onPress={() => router.replace(item.path as any)}
            style={mobile.tabItem}
          >
            <Text style={[mobile.tabIcon, { opacity: focused ? 1 : 0.6 }]}>
              {item.icon}
            </Text>
            <Text
              style={[
                mobile.tabLabel,
                {
                  color,
                  opacity: focused ? 1 : 0.7,
                  fontWeight: focused ? "700" : "500",
                },
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}

      {/* Vault recovery — small fifth slot */}
      <TouchableOpacity
        onPress={() => router.navigate("/recovery" as any)}
        style={mobile.tabItem}
        accessibilityRole="button"
        accessibilityLabel="Vault recovery"
      >
        <Text style={[mobile.tabIcon, { opacity: 0.6 }]}>{"\u{1F511}"}</Text>
        <Text
          style={[
            mobile.tabLabel,
            { color: theme.textMuted, opacity: 0.7, fontWeight: "500" },
          ]}
        >
          Vault
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootDesktop: { flexDirection: "row" },
  content: { flex: 1 },
});

const desktop = StyleSheet.create({
  sidebar: {
    width: SIDEBAR_WIDTH,
    height: "100%",
    borderRightWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 28,
  },
  footer: {
    marginTop: "auto",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#222",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMarkText: { fontSize: 16 },
  logoText: { fontSize: 17, fontWeight: "800" },
  nav: { gap: 4 },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
  },
  navIcon: { fontSize: 16 },
  navLabel: { fontSize: 14 },
});

const mobile = StyleSheet.create({
  bar: {
    flexDirection: "row",
    height: BOTTOM_BAR_HEIGHT,
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tabIcon: { fontSize: 20 },
  tabLabel: { fontSize: 10 },
});
