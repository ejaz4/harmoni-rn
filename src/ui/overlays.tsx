import { useEffect, useRef, useState, type ReactNode } from "react";
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";

import { haptic } from "@/lib/haptics";
import { Artwork } from "./Artwork";
import { Icon, type IconName } from "./Icon";
import { Press } from "./Press";
import { Text } from "./Text";
import { iosShadow } from "./shadow";
import { colors, fonts, spring } from "./theme";

/** The thick material menus and alerts are made of. */
const SHEET = "#242321";
const HAIR = StyleSheet.hairlineWidth;

// ---------- Toasts: a HUD capsule that drops in from the top ----------

interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}

const useToasts = create<{ toast: Toast | null }>(() => ({ toast: null }));
let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, kind: "info" | "error" = "info") {
  const id = ++toastId;
  if (kind === "error") haptic.reject();
  useToasts.setState({ toast: { id, message, kind } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useToasts.setState((s) => (s.toast?.id === id ? { toast: null } : s)), 2600);
}

/** Kept for callers; toasts now sit at the top, clear of the dock and the player. */
export const useToastOffset = create<{ bottom: number }>(() => ({ bottom: 0 }));

const hudIn = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -36 }, { scale: 0.86 }] },
    animations: {
      opacity: withTiming(1, { duration: 160 }),
      transform: [{ translateY: withSpring(0, spring.bouncy) }, { scale: withSpring(1, spring.bouncy) }],
    },
  };
};
const hudOut = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 180 }),
      transform: [
        { translateY: withTiming(-24, { duration: 220, easing: Easing.in(Easing.quad) }) },
        { scale: withTiming(0.92, { duration: 220 }) },
      ],
    },
  };
};

function ToastHost() {
  const t = useToasts((s) => s.toast);
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: "center", paddingTop: insets.top + 6 }]}>
      {t ? (
        <Animated.View key={t.id} entering={hudIn} exiting={hudOut} style={styles.hud}>
          <Pressable onPress={() => useToasts.setState({ toast: null })} accessibilityRole="alert" style={styles.hudInner}>
            {t.kind === "error" ? <Icon name="info" size={18} color={colors.danger} /> : null}
            <Text variant="subhead" weight={600} numberOfLines={2} style={{ flexShrink: 1 }}>
              {t.message}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ---------- Dialogs: alerts, with or without a field ----------

interface DialogSpec {
  title: string;
  note?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirm?: string;
  danger?: boolean;
  field: boolean;
  resolve: (v: string | boolean | undefined) => void;
}

const useDialog = create<{ dialog: DialogSpec | null }>(() => ({ dialog: null }));

export function prompt(opts: {
  title: string;
  note?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirm?: string;
}): Promise<string | undefined> {
  return new Promise((resolve) =>
    useDialog.setState({ dialog: { ...opts, field: true, resolve: (v) => resolve(typeof v === "string" ? v : undefined) } }),
  );
}

export function confirm(opts: { title: string; note?: string; confirm?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useDialog.setState({ dialog: { ...opts, field: false, resolve: (v) => resolve(v === true) } }));
}

const alertIn = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 1.1 }] },
    animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 420, dampingRatio: 0.82 }) }] },
  };
};
const alertOut = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withTiming(0, { duration: 150 }), transform: [{ scale: withTiming(0.94, { duration: 150 }) }] },
  };
};

function DialogHost() {
  const dialog = useDialog((s) => s.dialog);
  const [value, setValue] = useState("");
  const { width } = useWindowDimensions();
  useEffect(() => {
    if (dialog) {
      setValue(dialog.defaultValue ?? "");
      haptic.tick();
    }
  }, [dialog]);
  const close = (v: string | boolean | undefined) => {
    if (!dialog) return;
    Keyboard.dismiss();
    dialog.resolve(v);
    useDialog.setState({ dialog: null });
  };
  useEffect(() => {
    if (!dialog) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close(undefined);
      return true;
    });
    return () => sub.remove();
  });
  const trimmed = value.trim();
  const disabled = !!dialog?.field && !trimmed;
  return dialog ? (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => close(dialog.field ? undefined : false)}
        accessible={false}
        importantForAccessibility="no"
      />
      <Animated.View entering={alertIn} exiting={alertOut} style={[styles.alert, { width: Math.min(340, width - 48) }]}>
        <View style={{ gap: 6 }}>
          <Text variant="headline">{dialog.title}</Text>
          {dialog.note ? (
            <Text variant="subhead" color={colors.text2}>
              {dialog.note}
            </Text>
          ) : null}
        </View>
        {dialog.field ? (
          <View style={{ gap: 6 }}>
            {dialog.label ? (
              <Text variant="footnote" color={colors.text2}>
                {dialog.label}
              </Text>
            ) : null}
            <TextInput
              autoFocus
              value={value}
              onChangeText={setValue}
              maxLength={100}
              placeholder={dialog.placeholder}
              placeholderTextColor={colors.text3}
              selectionColor={colors.tint}
              cursorColor={colors.tint}
              onSubmitEditing={() => !disabled && close(trimmed)}
              returnKeyType="done"
              selectTextOnFocus
              style={styles.field}
            />
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
          <Press
            onPress={() => close(dialog.field ? undefined : false)}
            feedback="tap"
            scaleTo={0.96}
            style={[styles.alertButton, { backgroundColor: "rgba(255,255,255,0.09)" }]}
          >
            <Text variant="callout" weight={600}>
              Cancel
            </Text>
          </Press>
          <Press
            disabled={disabled}
            feedback="confirm"
            scaleTo={0.96}
            onPress={() => close(dialog.field ? trimmed : true)}
            style={[
              styles.alertButton,
              { backgroundColor: dialog.danger ? "rgba(255,107,94,0.16)" : colors.accent, opacity: disabled ? 0.45 : 1 },
            ]}
          >
            <Text variant="callout" weight={600} color={dialog.danger ? colors.danger : colors.accentInk}>
              {dialog.confirm ?? (dialog.field ? "Save" : "OK")}
            </Text>
          </Press>
        </View>
      </Animated.View>
    </Animated.View>
  ) : null;
}

// ---------- Menus: an action sheet, with a preview of what it's for ----------

export type MenuItem =
  | {
      label: string;
      icon?: IconName;
      detail?: string;
      checked?: boolean;
      disabled?: boolean;
      danger?: boolean;
      keepOpen?: boolean;
      onPress?: () => void;
      submenu?: () => MenuItem[];
    }
  | "divider";

export interface MenuPreview {
  title: string;
  subtitle?: string;
  artwork?: string | null;
  round?: boolean;
}

interface MenuSpec {
  /** What the menu is about: a song, an album… Shown at the top with its artwork. */
  preview?: MenuPreview;
  header?: ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  label?: string;
}

const useMenu = create<{ menu: MenuSpec | null; version: number }>(() => ({ menu: null, version: 0 }));

export function openMenu(spec: MenuSpec) {
  haptic.contextClick();
  useMenu.setState((s) => ({ menu: spec, version: s.version + 1 }));
}

export function closeMenu() {
  useMenu.setState({ menu: null });
}

/** Re-render an open menu (after a keepOpen item changes state). */
export function refreshMenu() {
  useMenu.setState((s) => ({ version: s.version + 1 }));
}

/** Items split into groups at each divider. */
function groups(items: MenuItem[]) {
  const out: Exclude<MenuItem, "divider">[][] = [[]];
  for (const it of items) {
    if (it === "divider") {
      if (out[out.length - 1].length) out.push([]);
    } else out[out.length - 1].push(it);
  }
  return out.filter((g) => g.length);
}

function MenuHost() {
  const { menu, version } = useMenu();
  const [shown, setShown] = useState<MenuSpec | null>(null);
  const [stack, setStack] = useState<{ title: string; items: () => MenuItem[] }[]>([]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const y = useSharedValue(height);
  const backdrop = useSharedValue(0);
  const sheetH = useRef(height * 0.6);
  /** How far the list is scrolled, for the swipe to dismiss. */
  const listY = useSharedValue(0);
  void version;

  useEffect(() => {
    if (menu) {
      setShown(menu);
      setStack([]);
      listY.value = 0;
      y.value = sheetH.current + 80;
      backdrop.value = withTiming(1, { duration: 260 });
      y.value = withSpring(0, { duration: 480, dampingRatio: 0.9 });
    } else if (shown) {
      backdrop.value = withTiming(0, { duration: 220 });
      y.value = withTiming(sheetH.current + 80, { duration: 240, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setShown)(null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length) setStack((s) => s.slice(0, -1));
      else closeMenu();
      return true;
    });
    return () => sub.remove();
  }, [menu, stack.length]);

  // Swipe down to dismiss, but only from the top of the list: scrolled down,
  // a drag down scrolls back up instead (the list and the swipe both want
  // the same 8dp, so the swipe decides by hand rather than racing it).
  const start = useSharedValue({ x: 0, y: 0 });
  const onListScroll = useAnimatedScrollHandler((e) => {
    listY.value = e.contentOffset.y;
  });
  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (t) start.value = { x: t.absoluteX, y: t.absoluteY };
    })
    .onTouchesMove((e, state) => {
      const t = e.allTouches[0];
      if (!t) return;
      const dx = t.absoluteX - start.value.x;
      const dy = t.absoluteY - start.value.y;
      if (Math.abs(dx) > 20 || dy < -8) state.fail();
      else if (dy > 8) {
        if (listY.value <= 0) state.activate();
        else state.fail();
      }
    })
    .onUpdate((e) => {
      // Rubber band upwards, free downwards.
      y.value = e.translationY > 0 ? e.translationY : -Math.sqrt(-e.translationY) * 2;
    })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 800) runOnJS(closeMenu)();
      else y.value = withSpring(0, { duration: 420, dampingRatio: 0.85, velocity: e.velocityY });
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!shown) return null;
  const top = stack[stack.length - 1];
  const base = typeof shown.items === "function" ? shown.items() : shown.items;
  const list = groups(top ? top.items() : base);

  const choose = (item: Exclude<MenuItem, "divider">) => {
    if (item.disabled) return;
    if (item.submenu) {
      haptic.tick();
      setStack((s) => [...s, { title: item.label, items: item.submenu! }]);
      return;
    }
    if (!item.keepOpen) closeMenu();
    else haptic.select();
    item.onPress?.();
    if (item.keepOpen) refreshMenu();
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={menu ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)" }, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} accessibilityLabel="Close menu" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          onLayout={(e) => (sheetH.current = e.nativeEvent.layout.height)}
          accessibilityLabel={shown.label}
          style={[{ position: "absolute", left: 10, right: 10, bottom: 10 + insets.bottom, gap: 8 }, sheetStyle]}
        >
          <View style={[styles.sheet, { maxHeight: height * 0.72 - insets.top }]}>
            <Animated.ScrollView
              bounces={false}
              overScrollMode="never"
              showsVerticalScrollIndicator={false}
              onScroll={onListScroll}
              scrollEventThrottle={16}
            >
              <Animated.View key={stack.length} entering={FadeIn.duration(200)}>
                {top ? (
                  <Pressable
                    onPress={() => setStack((s) => s.slice(0, -1))}
                    style={({ pressed }) => [styles.subhead, pressed && styles.pressed]}
                    accessibilityLabel={`Back from ${top.title}`}
                  >
                    <Icon name="chevron-left" size={20} color={colors.tint} />
                    <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>
                      {top.title}
                    </Text>
                  </Pressable>
                ) : shown.preview ? (
                  <View style={styles.preview}>
                    <Artwork
                      url={shown.preview.artwork ?? undefined}
                      size={48}
                      radius={shown.preview.round ? 24 : 8}
                      round={shown.preview.round}
                    />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text variant="headline" numberOfLines={1}>
                        {shown.preview.title}
                      </Text>
                      {shown.preview.subtitle ? (
                        <Text variant="subhead" color={colors.text2} numberOfLines={1}>
                          {shown.preview.subtitle}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : shown.header ? (
                  <View style={styles.header}>{shown.header}</View>
                ) : null}
                {list.map((g, gi) => {
                  const checks = g.some((it) => it.checked !== undefined);
                  return (
                    <View key={gi} style={gi > 0 || top || shown.preview || shown.header ? styles.groupGap : null}>
                      {g.map((item, i) => (
                        <MenuRow
                          key={`${item.label}${i}`}
                          item={item}
                          checks={checks}
                          last={i === g.length - 1}
                          onPress={() => choose(item)}
                        />
                      ))}
                    </View>
                  );
                })}
              </Animated.View>
            </Animated.ScrollView>
          </View>
          <Pressable
            onPress={closeMenu}
            style={({ pressed }) => [styles.cancel, pressed && { backgroundColor: "rgba(52,50,48,1)" }]}
            accessibilityLabel="Cancel"
          >
            <Text variant="headline" color={colors.tint}>
              Cancel
            </Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function MenuRow({
  item,
  checks,
  last,
  onPress,
}: {
  item: Exclude<MenuItem, "divider">;
  checks: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const color = item.danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={item.disabled}
      accessibilityRole="menuitem"
      accessibilityState={{ checked: item.checked, disabled: item.disabled }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, item.disabled && { opacity: 0.4 }]}
    >
      {checks ? <View style={{ width: 22 }}>{item.checked ? <Icon name="check" size={18} color={colors.tint} /> : null}</View> : null}
      <View style={{ flex: 1, paddingVertical: 12, gap: 1 }}>
        <Text variant="body" color={color} numberOfLines={1}>
          {item.label}
        </Text>
        {item.detail ? (
          <Text variant="footnote" color={colors.text2} numberOfLines={2}>
            {item.detail}
          </Text>
        ) : null}
      </View>
      {item.submenu ? (
        <Icon name="chevron-right" size={18} color={colors.text3} />
      ) : item.icon ? (
        <Icon name={item.icon} size={20} color={item.danger ? colors.danger : colors.text} />
      ) : null}
      {last ? null : <View style={[styles.rowLine, { left: checks ? 56 : 20 }]} />}
    </Pressable>
  );
}

/** Mount once at the root, above everything. */
// ---------- Sheets: a card of anything from the bottom (share settings…) ----------

interface SheetSpec {
  title: string;
  render: () => ReactNode;
}

const useSheet = create<{ sheet: SheetSpec | null }>(() => ({ sheet: null }));

export function openSheet(spec: SheetSpec) {
  haptic.contextClick();
  useSheet.setState({ sheet: spec });
}

export function closeSheet() {
  Keyboard.dismiss();
  useSheet.setState({ sheet: null });
}

function SheetHost() {
  const { sheet } = useSheet();
  const [shown, setShown] = useState<SheetSpec | null>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const y = useSharedValue(height);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    if (sheet) {
      setShown(sheet);
      y.value = height;
      backdrop.value = withTiming(1, { duration: 260 });
      y.value = withSpring(0, { duration: 520, dampingRatio: 0.9 });
    } else if (shown) {
      backdrop.value = withTiming(0, { duration: 220 });
      y.value = withTiming(height, { duration: 260, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setShown)(null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  useEffect(() => {
    if (!sheet) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeSheet();
      return true;
    });
    return () => sub.remove();
  }, [sheet]);

  // Dragged down by its top (the content may scroll).
  const pan = Gesture.Pan()
    .activeOffsetY(6)
    .onUpdate((e) => {
      y.value = e.translationY > 0 ? e.translationY : -Math.sqrt(-e.translationY) * 2;
    })
    .onEnd((e) => {
      if (e.translationY > 100 || e.velocityY > 800) runOnJS(closeSheet)();
      else y.value = withSpring(0, { duration: 420, dampingRatio: 0.85, velocity: e.velocityY });
    });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  if (!shown) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={sheet ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)" }, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} accessible={false} importantForAccessibility="no" />
      </Animated.View>
      <Animated.View
        accessibilityLabel={shown.title}
        style={[
          styles.sheet,
          {
            position: "absolute",
            left: 8,
            right: 8,
            bottom: 8 + insets.bottom,
            maxHeight: height - insets.top - insets.bottom - 40,
            borderRadius: 30,
          },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={pan}>
          <View style={{ paddingTop: 8, paddingBottom: 6 }}>
            <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.22)" }} />
            <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 10, paddingTop: 8 }}>
              <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>
                {shown.title}
              </Text>
              <Press
                onPress={closeSheet}
                feedback="tap"
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel="Done"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: "rgba(255,255,255,0.1)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="close" size={16} color={colors.text2} />
              </Press>
            </View>
          </View>
        </GestureDetector>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 18 }}
        >
          {shown.render()}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

export function OverlayHost() {
  return (
    <>
      <MenuHost />
      <SheetHost />
      <DialogHost />
      <ToastHost />
    </>
  );
}

const styles = StyleSheet.create({
  hud: {
    maxWidth: "86%",
    borderRadius: 999,
    backgroundColor: "rgba(44,43,41,0.98)",
    borderWidth: HAIR,
    borderColor: "rgba(255,255,255,0.1)",
    elevation: 12,
    ...iosShadow(12),
    shadowColor: "#000",
  },
  hudInner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, minHeight: 46 },
  scrim: { backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" },
  alert: {
    backgroundColor: SHEET,
    borderRadius: 30,
    padding: 22,
    paddingTop: 24,
    gap: 16,
    elevation: 24,
    ...iosShadow(24),
    borderWidth: HAIR,
    borderColor: "rgba(255,255,255,0.08)",
  },
  field: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    color: colors.text,
    fontFamily: fonts[400],
    fontSize: 17,
  },
  alertButton: { flex: 1, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  sheet: { backgroundColor: SHEET, borderRadius: 24, overflow: "hidden", borderWidth: HAIR, borderColor: "rgba(255,255,255,0.07)" },
  cancel: {
    height: 56,
    borderRadius: 18,
    backgroundColor: SHEET,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: HAIR,
    borderColor: "rgba(255,255,255,0.07)",
  },
  preview: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  header: { paddingHorizontal: 20, paddingVertical: 16 },
  subhead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 52 },
  groupGap: { borderTopWidth: 8, borderTopColor: "rgba(0,0,0,0.3)" },
  row: { minHeight: 50, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 14 },
  rowLine: { position: "absolute", right: 0, bottom: 0, height: HAIR, backgroundColor: "rgba(255,255,255,0.1)" },
  pressed: { backgroundColor: "rgba(255,255,255,0.08)" },
});
