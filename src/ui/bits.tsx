import { useEffect, type ReactNode } from "react";
import { View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { haptic } from "@/lib/haptics";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Press } from "./Press";
import { Spinner } from "./Spinner";
import { Text } from "./Text";
import { iosShadow } from "./shadow";
import { colors } from "./theme";

/**
 * A section, as the web lays them out: a bold title with a quiet line under
 * it, and "Show all" on the right when it leads somewhere.
 */
export function Section({
  title,
  subtitle,
  link,
  onLink,
  action,
  children,
  style,
  titleFont,
}: {
  title: string;
  subtitle?: string;
  /** The link's words ("Show all"). */
  link?: string;
  onLink?: () => void;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** A font family for the title (a profile's own font). */
  titleFont?: string;
}) {
  return (
    <View style={[{ marginTop: 40 }, style]}>
      <View
        style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 14, minHeight: 30 }}
      >
        <View style={{ flexShrink: 1, gap: 2 }}>
          <Text variant="title2" numberOfLines={1} style={titleFont ? { fontFamily: titleFont } : null}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="footnote" color={colors.text3} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ??
          (onLink ? (
            <Press
              onPress={onLink}
              feedback="tap"
              scaleTo={0.96}
              dim
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${link ?? "Show all"}`}
              style={{ paddingBottom: subtitle ? 1 : 3 }}
            >
              <Text variant="footnote" weight={600} color={colors.text2}>
                {link ?? "Show all"}
              </Text>
            </Press>
          ) : null)}
      </View>
      {children}
    </View>
  );
}

/** Nothing here yet: a quiet, centred note with an optional button (HIG empty state). */
export function EmptyState({
  title,
  body,
  action,
  onAction,
  icon,
}: {
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  icon?: IconName;
}) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 36, paddingHorizontal: 24, gap: 8 }}>
      {icon ? (
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: colors.surface2,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 8,
          }}
        >
          <Icon name={icon} size={30} color={colors.text2} />
        </View>
      ) : null}
      <Text variant="title3" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="subhead" color={colors.text2} align="center" style={{ maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {action && onAction ? <Button label={action} onPress={onAction} size="md" style={{ marginTop: 12 }} /> : null}
    </View>
  );
}

/** A placeholder in the shape of what's coming, breathing softly (iOS redaction). */
/** One clock for every skeleton on screen, so they shimmer together. */
const shimmer = makeMutable(0);
let shimmering = false;

/**
 * A placeholder: a quiet fill with a soft band of light sweeping across it, in
 * step with every other placeholder on the page.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  radius: r = 8,
  style,
  round,
  delay = 0,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  round?: boolean;
  delay?: number;
}) {
  const w = useSharedValue(0);
  useEffect(() => {
    if (shimmering) return;
    shimmering = true;
    shimmer.value = withRepeat(
      withSequence(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.cubic) }), withTiming(1, { duration: 450 })),
      -1,
      false,
    );
  }, []);
  // Later rows lag a little, so the light seems to travel down the page.
  const lag = Math.min(0.3, delay / 1000);
  const sweep = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (shimmer.value - lag) / (1 - lag)));
    const band = Math.max(80, w.value * 0.7);
    return { width: band, transform: [{ translateX: -band + p * (w.value + band) }] };
  });
  return (
    <View
      onLayout={(e) => (w.value = e.nativeEvent.layout.width)}
      style={[{ width, height, borderRadius: round ? 9999 : r, backgroundColor: colors.surface2, overflow: "hidden" }, style]}
    >
      <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, left: 0 }, sweep]}>
        <LinearGradient
          colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.055)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

export function SongRowsSkeleton({ n = 5 }: { n?: number }) {
  const widths = ["46%", "62%", "38%", "54%", "44%", "58%", "40%"] as const;
  return (
    <View style={{ gap: 16 }}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <Skeleton width={48} height={48} radius={6} delay={i * 80} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={widths[i % widths.length]} height={14} delay={i * 80} />
            <Skeleton width="30%" height={12} delay={i * 80} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** The round cream play button (white over artwork and colour). */
export function PlayButton({
  playing,
  loading,
  onPress,
  size = 48,
  bg = colors.accent,
  fg = colors.accentInk,
  label,
  flat,
}: {
  playing?: boolean;
  loading?: boolean;
  onPress: () => void;
  size?: number;
  bg?: string;
  fg?: string;
  label?: string;
  /** No shadow (on a card, where the art already lifts it). */
  flat?: boolean;
}) {
  return (
    <Press
      onPress={onPress}
      feedback={playing ? "toggleOff" : "toggleOn"}
      scaleTo={0.94}
      accessibilityLabel={loading ? "Loading" : playing ? "Pause" : (label ?? "Play")}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        elevation: flat ? 0 : 6,
        ...iosShadow(flat ? 0 : 6),
        shadowColor: "#000",
      }}
    >
      {loading ? <Spinner size={size * 0.42} color={fg} /> : <Icon name={playing ? "pause" : "play"} size={size * 0.44} color={fg} />}
    </Press>
  );
}

export function ExplicitBadge() {
  return (
    <View
      style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: colors.surface3, alignItems: "center", justifyContent: "center" }}
    >
      <Text size={10} weight={700} color={colors.text2} style={{ lineHeight: 12 }}>
        E
      </Text>
    </View>
  );
}

export function SmallButton({
  label,
  icon,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      scaleTo={0.95}
      style={{
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: colors.surface3,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {icon ? <Icon name={icon} size={16} color={colors.text} /> : null}
      <Text size={13} weight={500}>
        {label}
      </Text>
    </Press>
  );
}

export function Switch({ value, onChange, light }: { value: boolean; onChange: (v: boolean) => void; light?: boolean }) {
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    x.value = withTiming(value ? 1 : 0, { duration: 140 });
  }, [value, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 20 }] }));
  const trackOn = light ? "rgba(255,255,255,0.92)" : colors.accent;
  const trackOff = light ? "rgba(255,255,255,0.18)" : colors.surface3;
  const knobOn = light ? "rgba(0,0,0,0.75)" : colors.accentInk;
  const knobOff = light ? "rgba(255,255,255,0.9)" : colors.text2;
  return (
    <Press
      onPress={() => {
        if (value) haptic.toggleOff();
        else haptic.toggleOn();
        onChange(!value);
      }}
      feedback={false}
      scaleTo={0.94}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={{ width: 46, height: 26, borderRadius: 13, backgroundColor: value ? trackOn : trackOff, justifyContent: "center" }}
    >
      <Animated.View
        style={[{ width: 20, height: 20, borderRadius: 10, marginLeft: 3, backgroundColor: value ? knobOn : knobOff }, knob]}
      />
    </Press>
  );
}

export function CenterSpinner() {
  return (
    <View style={{ paddingVertical: 48, alignItems: "center" }}>
      <Spinner size={28} color={colors.text2} />
    </View>
  );
}

/** A filter or sort pill: cream when it's the one chosen. */
export function Chip({
  label,
  selected,
  icon,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  icon?: IconName;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Press
      onPress={onPress}
      feedback={selected ? false : "select"}
      scaleTo={0.95}
      accessibilityRole={icon ? "button" : "tab"}
      accessibilityState={icon ? undefined : { selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: selected ? colors.accent : colors.surface2,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {icon ? <Icon name={icon} size={15} color={selected ? colors.accentInk : colors.text} /> : null}
      <Text variant="footnote" weight={600} color={selected ? colors.accentInk : colors.text}>
        {label}
      </Text>
    </Press>
  );
}
