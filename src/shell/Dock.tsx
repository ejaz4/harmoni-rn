import type { BottomTabBarProps } from "expo-router/js-tabs";
import { memo, useEffect, useRef, type ComponentRef, type RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOutDown,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";

import { haptic } from "@/lib/haptics";
import { kv } from "@/lib/storage";
import { usePlayback, usePlayingOn, useProgress } from "@/player/hooks";
import { player } from "@/player/player";
import { Artwork } from "@/ui/Artwork";
import { Icon, type IconName } from "@/ui/Icon";
import { Material } from "@/ui/Material";
import { Press } from "@/ui/Press";
import { Spinner } from "@/ui/Spinner";
import { Text } from "@/ui/Text";
import { iosShadow } from "@/ui/shadow";
import { colors, spring } from "@/ui/theme";
import { MINI, TABS } from "./layout";
import { sheetProgress } from "./sheet";
import { openNowPlaying, scrollTabToTop, searchFocus } from "./state";

const TAB_META: Record<string, { label: string; icon: IconName; active: IconName }> = {
  "(home)": { label: "Home", icon: "home", active: "home-solid" },
  "(search)": { label: "Search", icon: "search", active: "search" },
  "(library)": { label: "Library", icon: "library", active: "library-solid" },
};

/**
 * The tab navigator hands its props here instead of drawing a bar, so the dock
 * can sit outside the tab content and blur it (a material can't blur itself).
 */
export const useTabBarProps = create<{ props: BottomTabBarProps | null }>(() => ({ props: null }));
export function TabBarBridge(props: BottomTabBarProps) {
  useEffect(() => {
    useTabBarProps.setState({ props });
  });
  return null;
}

/** Where the mini player's artwork sits on screen, for Now Playing to grow out of. */
export const miniArtFrame = { x: 0, y: 0, size: 40 };

export function Dock({ target }: { target: RefObject<ComponentRef<typeof View> | null> }) {
  const props = useTabBarProps((s) => s.props);
  const insets = useSafeAreaInsets();
  const { song } = usePlayback();
  // Where you were, for Settings › Look & feel › Open on › Where you left off.
  const tabName = props?.state.routes[props.state.index]?.name;
  useEffect(() => {
    if (tabName) kv.set("lastTab", tabName);
  }, [tabName]);
  if (!props) return null;
  const { state, emitter, navigateToTab } = props;
  return (
    // The whole dock takes touches, down to the screen edge: a tap in a gap between its
    // controls, or on Android's navigation handle below them, never reaches the list behind.
    <View
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      style={[styles.dock, { paddingBottom: insets.bottom }]}
    >
      <Material target={target} thick={false} intensity={80} />
      <View style={styles.hairline} />
      {song ? <MiniPlayer /> : null}
      <View style={styles.tabs}>
        {state.routes.map((route, i) => {
          const meta = TAB_META[route.name];
          if (!meta) return null;
          const focused = state.index === i;
          return (
            <Tab
              key={route.key}
              label={meta.label}
              icon={focused ? meta.active : meta.icon}
              focused={focused}
              onPress={() => {
                const nested = (route as { state?: { index?: number } }).state;
                const atRoot = !nested?.index;
                const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (focused) {
                  haptic.tick();
                  if (atRoot) {
                    if (route.name === "(search)") searchFocus.current?.();
                    else scrollTabToTop(route.name);
                  }
                } else if (!event.defaultPrevented) {
                  haptic.select();
                  navigateToTab(route.key);
                }
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

const Tab = memo(function Tab({ label, icon, focused, onPress }: { label: string; icon: IconName; focused: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  const on = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    on.value = withSpring(focused ? 1 : 0, spring.snappy);
  }, [focused, on]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const color = focused ? colors.accent : colors.text3;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPressIn={() => (scale.value = withSpring(0.88, spring.press))}
      onPressOut={() => (scale.value = withSpring(1, spring.bouncy))}
      onPress={onPress}
      style={styles.tab}
    >
      <Animated.View style={[{ alignItems: "center", gap: 3 }, style]}>
        <Icon name={icon} size={25} color={color} />
        <Text variant="caption2" color={color}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
});

function MiniPlayer() {
  const pb = usePlayback();
  const song = pb.song!;
  const playingOn = usePlayingOn();
  const artRef = useRef<ComponentRef<typeof View>>(null);

  // Swipe sideways to skip, up to open; the content follows the finger with resistance.
  const dx = useSharedValue(0);
  const pressed = useSharedValue(0);
  const pan = Gesture.Pan()
    .minDistance(8)
    .onUpdate((e) => {
      if (Math.abs(e.translationX) > Math.abs(e.translationY)) dx.value = e.translationX * 0.4;
      else if (e.translationY < 0) dx.value = 0;
    })
    .onEnd((e) => {
      const horizontal = Math.abs(e.translationX) > Math.abs(e.translationY);
      if (!horizontal && (e.translationY < -40 || e.velocityY < -600)) runOnJS(openNowPlaying)("art");
      else if (horizontal && (e.translationX < -64 || e.velocityX < -700)) runOnJS(skip)(1);
      else if (horizontal && (e.translationX > 64 || e.velocityX > 700)) runOnJS(skip)(-1);
      dx.value = withSpring(0, spring.bouncy);
    });
  const tap = Gesture.Tap()
    .maxDuration(400)
    .onBegin(() => (pressed.value = withTiming(1, { duration: 90 })))
    .onFinalize(() => (pressed.value = withTiming(0, { duration: 240 })))
    .onEnd(() => runOnJS(openNowPlaying)("art"));
  const gesture = Gesture.Exclusive(pan, tap);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }],
    opacity: interpolate(Math.abs(dx.value), [0, 60], [1, 0.5], "clamp"),
  }));
  const cardStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(255,255,255,${0.07 + pressed.value * 0.05})`,
    transform: [{ scale: 1 - pressed.value * 0.015 }],
    // The capsule hands its artwork to Now Playing as it opens.
    opacity: interpolate(sheetProgress.value, [0, 0.15], [1, 0], "clamp"),
  }));

  const artists = song.artists.map((a) => a.name).join(", ");
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOutDown.duration(200)}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.mini, cardStyle]}>
          <Animated.View style={[{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }, contentStyle]}>
            <View
              ref={artRef}
              collapsable={false}
              onLayout={() => {
                artRef.current?.measureInWindow((x: number, y: number, w: number) => {
                  miniArtFrame.x = x;
                  miniArtFrame.y = y;
                  miniArtFrame.size = w;
                });
              }}
              style={styles.miniArt}
            >
              <Artwork url={song.artworkUrl} size={40} radius={8} />
            </View>
            <Animated.View key={song.id} entering={FadeIn.duration(260)} style={{ flex: 1 }}>
              <Text variant="subhead" weight={500} numberOfLines={1}>
                {song.title}
              </Text>
              {playingOn ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon name="link" size={12} color={colors.tint} />
                  <Text variant="footnote" weight={500} color={colors.tint} numberOfLines={1} style={{ flex: 1 }}>
                    {playingOn}
                  </Text>
                </View>
              ) : (
                <Text variant="footnote" color={colors.text2} numberOfLines={1}>
                  {artists}
                </Text>
              )}
            </Animated.View>
          </Animated.View>
          <Press
            onPress={() => player.toggle()}
            feedback={pb.playing ? "toggleOff" : "toggleOn"}
            accessibilityLabel={pb.buffering ? "Loading" : pb.playing ? "Pause" : "Play"}
            style={styles.miniBtn}
            scaleTo={0.82}
          >
            {pb.buffering && pb.playing ? (
              <Spinner size={22} color={colors.text} />
            ) : (
              <Icon name={pb.playing ? "pause" : "play"} size={28} />
            )}
          </Press>
          <Press onPress={() => player.next()} accessibilityLabel="Next" style={styles.miniBtn} scaleTo={0.82}>
            <Icon name="next" size={26} />
          </Press>
          <MiniProgress fallback={song.durationMs} />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

function skip(dir: 1 | -1) {
  haptic.gestureEnd();
  if (dir > 0) player.next();
  else player.prev();
}

function MiniProgress({ fallback }: { fallback?: number }) {
  const { positionMs, durationMs } = useProgress(500);
  const dur = durationMs ?? fallback ?? 0;
  const p = dur > 0 ? Math.min(1, positionMs / dur) : 0;
  return (
    <View pointerEvents="none" style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${p * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 8 },
  hairline: { position: "absolute", top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  tabs: { height: TABS - 8, flexDirection: "row" },
  tab: { flex: 1, alignItems: "center", justifyContent: "center" },
  mini: {
    height: MINI - 4,
    marginHorizontal: 10,
    marginBottom: 4,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: 16,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  miniArt: { borderRadius: 8, elevation: 6, shadowColor: "#000", ...iosShadow(6) },
  miniBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  progressTrack: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  progressFill: { height: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.7)" },
});
