import { useQuery } from "@tanstack/react-query";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { BackHandler, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { sheetProgress } from "@/shell/sheet";
import { miniArtFrame } from "@/shell/Dock";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { Api } from "@/api/endpoints";
import type { QueueSong } from "@/api/types";
import { haptic } from "@/lib/haptics";
import { kv } from "@/lib/storage";
import { useLink } from "@/link/link";
import { useArtworkColors, usePlayback, usePlayingOn } from "@/player/hooks";
import { closeNowPlaying, openNowPlaying, useNowPlaying, type NowPlayingView } from "@/shell/state";
import { openSongMenu, type Extra } from "@/song/menu";
import { setSleep, sleepLabel, useSleep } from "@/player/sleep";
import { useIsLiked, useLibrary } from "@/state/library";
import { useSession } from "@/state/session";
import { Artwork } from "@/ui/Artwork";
import { Icon, type IconName } from "@/ui/Icon";
import { toast } from "@/ui/overlays";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { iosShadow } from "@/ui/shadow";
import { spring } from "@/ui/theme";
import { FadeMask } from "@/ui/FadeMask";
import { Backdrop } from "./Backdrop";
import { useBass } from "./bass";
import { openLinkPicker } from "./LinkPicker";
import { PlainLyrics, SyncedLyrics } from "./Lyrics";
import { QueueView } from "./Queue";
import { Controls, Progress } from "./Transport";

const W = (a: number) => `rgba(255,255,255,${a})`;

export function NowPlaying() {
  const open = useNowPlaying((s) => s.open);
  const { height } = useWindowDimensions();
  const y = useSharedValue(height);
  const [mounted, setMounted] = useState(false);
  const pb = usePlayback();

  // Springs, so a flick carries its speed into the sheet (and the sheet into the flick).
  const flick = useSharedValue(0);
  useEffect(() => {
    if (open) {
      setMounted(true);
      if (y.value >= height - 1) y.value = height;
      y.value = withSpring(0, { ...spring.smooth, duration: 560, velocity: flick.value });
    } else {
      y.value = withSpring(height, { duration: 460, dampingRatio: 1, velocity: flick.value, overshootClamping: true }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    flick.value = 0;
  }, [open, height, y, flick]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeNowPlaying();
      return true;
    });
    return () => sub.remove();
  }, [open]);

  // Closes on its own when nothing's loaded any more.
  useEffect(() => {
    if (open && !pb.song) closeNowPlaying();
  }, [open, pb.song]);

  // Swipe down anywhere outside the lyrics and queue to close. Each area gets its own
  // gesture: one gesture shared between several detectors only works in one of them.
  const makePan = () =>
    Gesture.Pan()
      .activeOffsetY(10)
      .failOffsetX([-24, 24])
      .onUpdate((e) => {
        // Down follows the finger; up resists (rubber band).
        y.value = e.translationY >= 0 ? e.translationY : -Math.sqrt(-e.translationY) * 3;
      })
      .onEnd((e) => {
        if (e.translationY > 120 || (e.translationY > 24 && e.velocityY > 500)) {
          flick.value = e.velocityY;
          runOnJS(haptic.gestureEnd)();
          runOnJS(closeNowPlaying)();
        } else y.value = withSpring(0, { ...spring.bouncy, velocity: e.velocityY });
      });
  const pans: Pans = { grab: makePan(), head: makePan(), art: makePan(), bar: makePan() };

  const sheet = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, 1 - y.value / height));
    return {
      transform: [{ translateY: Math.max(-12, y.value) }],
      borderTopLeftRadius: interpolate(p, [0.9, 1], [32, 0], "clamp"),
      borderTopRightRadius: interpolate(p, [0.9, 1], [32, 0], "clamp"),
    };
  });
  useAnimatedReaction(
    () => y.value,
    (v) => {
      sheetProgress.value = Math.max(0, Math.min(1, 1 - v / height));
    },
  );

  if (!mounted || !pb.song) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 40, overflow: "hidden" }, sheet]}>
      <StatusBar style="light" />
      <Sheet pans={pans} song={pb.song} />
    </Animated.View>
  );
}

const PANEL = { duration: 620, dampingRatio: 0.86 };

/** Where the small artwork sits beside the title in the lyrics and queue views (window coordinates, sheet open). */
type Frame = { x: SharedValue<number>; y: SharedValue<number>; s: SharedValue<number> };

type Pans = Record<"grab" | "head" | "art" | "bar", ReturnType<typeof Gesture.Pan>>;

function Sheet({ pans, song }: { pans: Pans; song: QueueSong }) {
  const insets = useSafeAreaInsets();
  const view = useNowPlaying((s) => s.view);
  const theme = useArtworkColors(song.artworkUrl);
  const lyricsOn = useSession((s) => s.me?.server.features.lyrics ?? true);
  useBass();
  const lyricsQ = useQuery({
    queryKey: ["lyrics", song.id],
    queryFn: () => Api.lyrics(song.id),
    enabled: lyricsOn,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const lyrics = lyricsQ.data;
  const hasWords = !!lyrics?.found && !lyrics.instrumental && !!lyrics.lines?.length;
  const shown: NowPlayingView = view === "lyrics" ? (lyricsQ.isLoading || hasWords ? "lyrics" : "art") : view;
  const linkConnected = useLink((l) => l.enabled && l.connected);
  const playing = usePlayback().playing;

  // 0: the artwork view; 1: lyrics or queue. The artwork glides between the two.
  const panel = useSharedValue(shown === "art" ? 0 : 1);
  // What the panel shows; kept while it fades out so it doesn't vanish mid-glide.
  const [content, setContent] = useState<"lyrics" | "queue" | null>(shown === "art" ? null : shown);
  useEffect(() => {
    if (shown !== "art") setContent(shown);
    panel.value = withSpring(shown === "art" ? 0 : 1, PANEL, (done) => {
      if (done && shown === "art") runOnJS(setContent)(null);
    });
  }, [shown, panel]);
  const compact: Frame = { x: useSharedValue(0), y: useSharedValue(0), s: useSharedValue(0) };

  // Idle: in the lyrics view, 3 s without a touch while playing fades the chrome away.
  const [idle, setIdle] = useState(false);
  const chrome = useSharedValue(1);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (idle) setIdle(false);
    idleTimer.current = setTimeout(() => setIdle(true), 3000);
  };
  useEffect(() => {
    wake();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  const isIdle = idle && shown === "lyrics" && playing;
  useEffect(() => {
    chrome.value = withTiming(isIdle ? 0 : 1, { duration: 600, easing: Easing.bezier(0.2, 0.7, 0.2, 1) });
  }, [isIdle, chrome]);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.value }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(panel.value, [0.3, 1], [0, 1], "clamp"),
    transform: [{ translateY: (1 - panel.value) * 36 }, { scale: 0.97 + 0.03 * panel.value }],
  }));

  return (
    <View onTouchStart={wake} style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, overflow: "hidden" }}>
      <Backdrop art={song.artworkUrl} theme={theme} />
      <GestureDetector gesture={pans.grab}>
        <View>
          <Press
            onPress={closeNowPlaying}
            feedback="tap"
            scaleTo={1}
            accessibilityLabel="Close"
            style={{ height: 30, alignItems: "center", justifyContent: "center" }}
          >
            <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: W(0.4) }} />
          </Press>
        </View>
      </GestureDetector>

      <View style={{ flex: 1 }}>
        {/* Lyrics and queue, under a header with the song. */}
        <View style={StyleSheet.absoluteFill} pointerEvents={shown === "art" ? "none" : "box-none"}>
          <GestureDetector gesture={pans.head}>
            <View>
              <CompactHeader song={song} panel={panel} frame={compact} />
            </View>
          </GestureDetector>
          <Animated.View style={[{ flex: 1 }, contentStyle]}>
            {content === "queue" ? (
              <Animated.View key="queue" entering={FadeIn.duration(260)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
                <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 8 }}>
                  <FadeMask
                    stops={[
                      [0, 0],
                      [0.03, 1],
                      [0.86, 1],
                      [1, 0],
                    ]}
                  >
                    <QueueView />
                  </FadeMask>
                </View>
              </Animated.View>
            ) : content === "lyrics" ? (
              <Animated.View key="lyrics" entering={FadeIn.duration(260)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
                <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 8 }}>
                  {lyricsQ.isError ? (
                    <Text size={13} color={W(0.55)}>
                      Couldn't load lyrics right now.
                    </Text>
                  ) : lyrics && hasWords ? (
                    lyrics.sync === "line" || lyrics.sync === "word" ? (
                      <FadeMask
                        stops={[
                          [0, 0],
                          [0.12, 0],
                          [0.3, 1],
                          [0.8, 1],
                          [1, 0],
                        ]}
                      >
                        <SyncedLyrics key={song.id} lyrics={lyrics} durationMs={song.durationMs} />
                      </FadeMask>
                    ) : (
                      <FadeMask
                        stops={[
                          [0, 0],
                          [0.12, 1],
                          [0.8, 1],
                          [1, 0],
                        ]}
                      >
                        <PlainLyrics lyrics={lyrics} />
                      </FadeMask>
                    )
                  ) : null}
                  {hasWords ? <KeepAwakeForLyrics /> : null}
                </View>
              </Animated.View>
            ) : null}
          </Animated.View>
        </View>

        {/* The artwork, its title and buttons. In the other views only the artwork stays, small, by the title. */}
        <View style={StyleSheet.absoluteFill} pointerEvents={shown === "art" ? "box-none" : "none"}>
          <GestureDetector gesture={pans.art}>
            <View style={{ flex: 1 }}>
              <ArtStage
                song={song}
                panel={panel}
                compact={compact}
                quiet={lyrics && !hasWords ? (lyrics.instrumental ? "Instrumental" : "No lyrics for this one") : undefined}
              />
            </View>
          </GestureDetector>
        </View>
      </View>

      <GestureDetector gesture={pans.bar}>
        <View style={{ paddingHorizontal: 28 }}>
          <Progress sheetPan={pans.bar} />
          <Animated.View style={chromeStyle} pointerEvents={isIdle ? "none" : "auto"}>
            <Controls />
          </Animated.View>
        </View>
      </GestureDetector>

      <Animated.View
        style={[
          { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 34, paddingTop: 4, paddingBottom: 10 },
          chromeStyle,
        ]}
        pointerEvents={isIdle ? "none" : "auto"}
      >
        <ViewButton
          icon="lyrics"
          label="Lyrics"
          on={shown === "lyrics"}
          onPress={() => openNowPlaying(view === "lyrics" ? "art" : "lyrics")}
          disabled={!lyricsOn}
        />
        {linkConnected ? <LinkButton /> : null}
        <ViewButton
          icon="queue"
          label="Up next"
          on={shown === "queue"}
          onPress={() => openNowPlaying(view === "queue" ? "art" : "queue")}
        />
      </Animated.View>
    </View>
  );
}

function KeepAwakeForLyrics() {
  const keep = kv.get("settings.keepAwake", false);
  return keep ? <KeepAwake /> : null;
}
function KeepAwake() {
  useKeepAwake("lyrics");
  return null;
}

function ViewButton({
  icon,
  label,
  on,
  onPress,
  disabled,
  accent,
}: {
  icon: IconName;
  label: string;
  on?: boolean;
  onPress: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  const lit = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    lit.value = withSpring(on ? 1 : 0, spring.snappy);
  }, [on, lit]);
  const pill = useAnimatedStyle(() => ({ opacity: lit.value, transform: [{ scale: 0.6 + 0.4 * lit.value }] }));
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      feedback="select"
      scaleTo={0.88}
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1 }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 22, backgroundColor: W(0.2) }, pill]} />
      {accent ? <View style={[StyleSheet.absoluteFill, { borderRadius: 22, backgroundColor: "rgba(239,230,214,0.14)" }]} /> : null}
      <Icon name={icon} size={22} color={accent ? "#efe6d6" : on ? "#fff" : W(0.85)} />
    </Press>
  );
}

function LinkButton() {
  const playingOn = usePlayingOn();
  return (
    <ViewButton
      icon="link"
      label={playingOn ? `Playing on ${playingOn}. Harmoni Link` : "Harmoni Link"}
      accent={!!playingOn}
      onPress={openLinkPicker}
    />
  );
}

function LikeButton({ song }: { song: QueueSong }) {
  const liked = useIsLiked(song.id);
  return (
    <Press
      onPress={() =>
        useLibrary
          .getState()
          .toggleLike(song)
          .catch(() => toast("Couldn't save that. Try again?", "error"))
      }
      feedback={liked ? "toggleOff" : "confirm"}
      scaleTo={0.85}
      accessibilityLabel={liked ? "Remove from Liked" : "Add to Liked"}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: liked ? W(0.2) : "transparent",
      }}
    >
      <Icon name={liked ? "heart-solid" : "heart"} size={22} color={liked ? "#fff" : W(0.85)} />
    </Press>
  );
}

function PlayingOn() {
  const on = usePlayingOn();
  if (!on) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, opacity: 0.9 }}>
      <Icon name="link" size={14} color="#fff" />
      <Text size={13} weight={500} color="#fff" numberOfLines={1}>
        Playing on {on}
      </Text>
    </View>
  );
}

function CompactHeader({ song, panel, frame }: { song: QueueSong; panel: SharedValue<number>; frame: Frame }) {
  const { height } = useWindowDimensions();
  const ref = useRef<ComponentRef<typeof View>>(null);
  // The artwork itself is the big one, flown here (ArtStage); this only holds its place.
  const measure = () =>
    ref.current?.measureInWindow((x: number, y: number, w: number) => {
      frame.x.value = x;
      frame.y.value = y - (1 - sheetProgress.value) * height;
      frame.s.value = w;
    });
  const textStyle = useAnimatedStyle(() => ({
    opacity: interpolate(panel.value, [0.45, 1], [0, 1], "clamp"),
    transform: [{ translateX: (1 - panel.value) * -16 }],
  }));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 4 }}>
      <Press onPress={() => openNowPlaying("art")} feedback="tap" scaleTo={1} accessibilityLabel="Show artwork">
        <View ref={ref} collapsable={false} onLayout={measure} style={{ width: 56, height: 56 }} />
      </Press>
      <Animated.View style={[{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }, textStyle]}>
        <View style={{ flex: 1 }}>
          <Text size={17} weight={600} color="#fff" numberOfLines={1}>
            {song.title}
          </Text>
          <Text color={W(0.68)} numberOfLines={1}>
            {song.artists.map((a) => a.name).join(", ")}
          </Text>
          <PlayingOn />
        </View>
        <LikeButton song={song} />
      </Animated.View>
    </View>
  );
}

function sleepItem(): Extra {
  const s = useSleep.getState();
  return {
    label: "Sleep timer",
    icon: "timer",
    detail: sleepLabel(s),
    submenu: () => [
      ...[15, 30, 45, 60, 90].map((m) => ({
        label: `${m} minutes`,
        checked: false,
        onPress: () => (setSleep(m), toast(`Music stops in ${m} minutes`)),
      })),
      { label: "End of this song", checked: s.endOfSong, onPress: () => (setSleep("song"), toast("Music stops after this song")) },
      ...(s.until || s.endOfSong
        ? (["divider", { label: "Turn off", icon: "close" as const, onPress: () => (setSleep(null), toast("Sleep timer off")) }] as const)
        : []),
    ],
  };
}

function ArtStage({ song, quiet, panel, compact }: { song: QueueSong; quiet?: string; panel: SharedValue<number>; compact: Frame }) {
  const { width, height } = useWindowDimensions();
  const pb = usePlayback();
  const art = Math.min(width - 56, height * 0.44, 520);
  const scale = useSharedValue(pb.playing ? 1 : 0.86);
  useEffect(() => {
    // Paused artwork sinks back a little, playing artwork springs forward (Apple Music).
    scale.value = withSpring(pb.playing ? 1 : 0.86, pb.playing ? spring.bouncy : spring.smooth);
  }, [pb.playing, scale]);

  // The artwork grows out of the mini player's as the sheet rises, and shrinks back into it;
  // in the lyrics and queue views it flies to the small spot by the title.
  const ref = useRef<ComponentRef<typeof View>>(null);
  const fx = useSharedValue(-1);
  const fy = useSharedValue(0);
  const fs = useSharedValue(art);
  const measure = () => {
    ref.current?.measureInWindow((x: number, y: number, w: number) => {
      // Measured while the sheet may be moving: take its offset out.
      const off = (1 - sheetProgress.value) * height;
      fx.value = x;
      fy.value = y - off;
      fs.value = w;
    });
  };
  const mini = { x: miniArtFrame.x, y: miniArtFrame.y, s: miniArtFrame.size };
  const artStyle = useAnimatedStyle(() => {
    const p = sheetProgress.value;
    const t = compact.s.value > 0 ? panel.value : 0;
    if (fx.value < 0) {
      const c0 = ((1 - scale.value) * art) / 2;
      return { transform: [{ translateX: c0 }, { translateY: c0 }, { scale: scale.value }] };
    }
    // Where it belongs with the sheet open: big, small by the title, or on the way.
    const tx = fx.value + (compact.x.value - fx.value) * t;
    const ty = fy.value + (compact.y.value - fy.value) * t;
    const ts = fs.value + (compact.s.value - fs.value) * t;
    const morph = mini.s > 0 && p < 1;
    const dx = morph ? mini.x + (tx - mini.x) * p : tx;
    const dy = morph ? mini.y + (ty - mini.y) * p : ty;
    const ds = morph ? mini.s + (ts - mini.s) * p : ts;
    const off = (1 - p) * height;
    const k = ds / fs.value;
    // Scaled about the top-left (for the morph), so a paused artwork is moved back to the centre.
    const sEff = 1 - (1 - scale.value) * (1 - t) * (morph ? p : 1);
    const c = ((1 - sEff) * ds) / 2;
    return {
      transform: [{ translateX: dx - fx.value + c }, { translateY: dy - (fy.value + off) + c }, { scale: k * sEff }],
    };
  });
  const artRadius = useAnimatedStyle(() => {
    const p = sheetProgress.value;
    const t = compact.s.value > 0 ? panel.value : 0;
    const morph = mini.s > 0 && p < 1;
    const target = 12 + (8 - 12) * t;
    const shown = morph ? 8 + (target - 8) * p : target;
    const tsz = fs.value + (compact.s.value - fs.value) * t;
    const ds = morph ? mini.s + (tsz - mini.s) * p : tsz;
    const sEff = 1 - (1 - scale.value) * (1 - t) * (morph ? p : 1);
    return { borderRadius: shown / Math.max(0.01, (ds / Math.max(1, fs.value)) * sEff) };
  });
  // The title and buttons make way for the lyrics and queue.
  const infoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(panel.value, [0, 0.4], [1, 0], "clamp"),
    transform: [{ translateY: panel.value * 18 }],
  }));

  const featuredAt = song.artists.findIndex((a) => a.role === "featured");
  const go = (href: string) => {
    closeNowPlaying();
    setTimeout(() => router.push(href as never), 60);
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: 28, paddingBottom: 6, alignItems: "center" }}>
      <View style={{ flex: 1, justifyContent: "center" }}>
        {/* Measured here, where nothing moves it: measureInWindow counts transforms, so measuring the
            artwork itself while it was shrunk (paused) or flown to the title put it off from then on. */}
        <View ref={ref} collapsable={false} onLayout={measure}>
          <Animated.View style={[{ elevation: 28, shadowColor: "#000", ...iosShadow(28), borderRadius: 12, transformOrigin: "0% 0%" }, artStyle]}>
            <Press onLongPress={() => openSongMenu(song, [], { fromNowPlaying: true })} feedback={false} scaleTo={1}>
              <Animated.View style={[{ overflow: "hidden" }, artRadius]}>
                <Artwork url={song.artworkUrl} size={art} radius={0} px={900} priority="high" />
              </Animated.View>
            </Press>
          </Animated.View>
        </View>
      </View>
      <Animated.View style={[{ width: "100%", flexDirection: "row", alignItems: "center", gap: 12 }, infoStyle]}>
        <View style={{ flex: 1 }}>
          <Text variant="title3" color="#fff" numberOfLines={1}>
            {song.title}
          </Text>
          <Text variant="body" color={W(0.62)} numberOfLines={1}>
            {song.artists.map((a, i) => (
              <Text key={i} variant="body" color={W(0.62)} onPress={a.id ? () => go(`/artist/${a.id}`) : undefined}>
                {i > 0 ? (i === featuredAt ? " feat. " : ", ") : ""}
                {a.name}
              </Text>
            ))}
            {song.album?.id ? (
              <Text variant="body" color={W(0.62)} onPress={() => go(`/album/${song.album!.id}`)}>
                {" · "}
                {song.album.title}
              </Text>
            ) : null}
          </Text>
          <PlayingOn />
          {quiet ? (
            <Text size={13} color={W(0.55)} style={{ marginTop: 6 }}>
              {quiet}
            </Text>
          ) : null}
        </View>
        <Press
          onPress={() => openSongMenu(song, [sleepItem()], { fromNowPlaying: true })}
          feedback="contextClick"
          scaleTo={0.85}
          accessibilityLabel={`More options for ${song.title}`}
          style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="more" size={22} color={W(0.85)} />
        </Press>
        <LikeButton song={song} />
      </Animated.View>
    </View>
  );
}
