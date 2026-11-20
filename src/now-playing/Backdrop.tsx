import {
  Blur,
  Canvas,
  ColorMatrix,
  Group,
  Image as SkiaImage,
  Paint,
  rect,
  rrect,
  useImage,
  type SkImage,
  type Transforms3d,
} from "@shopify/react-native-skia";
import { Image } from "expo-image";
import { memo, useEffect, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  interpolateColor,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import type { ArtworkColors } from "harmoni-player";
import { sized } from "@/ui/Artwork";
import { bass } from "./bass";

const IOS = Platform.OS === "ios";

/** The bass, shaped so kicks stand out and the hum underneath doesn't. */
function kick(b: number) {
  "worklet";
  const k = Math.max(0, (b - 0.3) / 0.7);
  return k * k * (3 - 2 * k);
}

/**
 * The living backdrop: the cover's colour, with three huge blurred copies of
 * the cover turning and drifting slowly, under a soft veil. New songs fade in
 * over the old one. It moves with the music: on each kick the blobs swell,
 * the veil lifts and a glow of the cover's colour rises from below.
 */
export const Backdrop = memo(function Backdrop({ art, theme }: { art?: string; theme: ArtworkColors | null }) {
  const [layers, setLayers] = useState<{ key: string; art: string }[]>([]);
  useEffect(() => {
    if (!art) return;
    setLayers((l) => (l[l.length - 1]?.art === art ? l : [...l.slice(-1), { key: `${art}:${Date.now()}`, art }]));
  }, [art]);

  const base = useSharedValue(0);
  const from = useSharedValue("#2a2a2a");
  const to = useSharedValue("#2a2a2a");
  useEffect(() => {
    from.value = to.value;
    to.value = theme?.color ?? "#2a2a2a";
    base.value = 0;
    base.value = withTiming(1, { duration: 1200, easing: Easing.bezier(0.2, 0.7, 0.2, 1) });
  }, [theme, base, from, to]);
  const baseStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(base.value, [0, 1], [from.value, to.value]) }));

  const dark = theme?.light ? [0.32, 0.58] : [0.04, 0.32];
  const veil = useAnimatedStyle(() => ({ opacity: 1 - 0.45 * kick(bass.value) }));
  const glow = useAnimatedStyle(() => {
    const k = kick(bass.value);
    return { opacity: 0.85 * k, transform: [{ scaleY: 0.85 + 0.25 * k }] };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, baseStyle]} pointerEvents="none">
      {layers.map((l) => (
        <Animated.View key={l.key} entering={FadeIn.duration(1400)} exiting={FadeOut.duration(1400)} style={StyleSheet.absoluteFill}>
          {IOS ? <SkiaBlobs art={l.art} /> : <Blobs art={l.art} />}
        </Animated.View>
      ))}
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: "50% 100%" }, glow]}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="100%" rx="90%" ry="55%">
              <Stop offset="0" stopColor={theme?.color ?? "#ffffff"} stopOpacity={0.55} />
              <Stop offset="0.6" stopColor={theme?.color ?? "#ffffff"} stopOpacity={0.12} />
              <Stop offset="1" stopColor={theme?.color ?? "#ffffff"} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#glow)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, veil]}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <RadialGradient id="veil" cx="25%" cy="20%" rx="140%" ry="110%">
              <Stop offset="0" stopColor="#000" stopOpacity={dark[0]} />
              <Stop offset="1" stopColor="#000" stopOpacity={dark[1]} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#veil)" />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
});

/** The three blobs' clocks: two slow turns and a drift back and forth. */
function useBlobClocks() {
  const t1 = useSharedValue(0);
  const t2 = useSharedValue(0);
  const t3 = useSharedValue(0);
  useEffect(() => {
    t1.value = withRepeat(withTiming(1, { duration: 46000, easing: Easing.linear }), -1, false);
    t2.value = withRepeat(withTiming(1, { duration: 62000, easing: Easing.linear }), -1, false);
    t3.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 28000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 28000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [t1, t2, t3]);
  return { t1, t2, t3 };
}

function Blobs({ art }: { art: string }) {
  const { width, height } = useWindowDimensions();
  const vmax = Math.max(width, height) / 100;
  const { t1, t2, t3 } = useBlobClocks();
  const turn = (t: number, reverse: boolean, swell: number) => {
    "worklet";
    const scale = (1 + 0.12 * Math.sin(Math.PI * t)) * (1 + swell);
    return [{ rotate: `${(reverse ? -360 : 360) * t}deg` }, { scale }];
  };
  const s1 = useAnimatedStyle(() => ({ transform: turn(t1.value, false, 0.1 * kick(bass.value)) }));
  const s2 = useAnimatedStyle(() => ({ transform: turn(t2.value, true, 0.07 * kick(bass.value)) }));
  const s3 = useAnimatedStyle(() => ({
    transform: [
      { translateX: (-6 + 14 * t3.value) * vmax },
      { translateY: (-4 + 10 * t3.value) * vmax },
      { rotate: `${-20 + 55 * t3.value}deg` },
      { scale: 1 + 0.16 * kick(bass.value) },
    ],
    opacity: 0.6 + 0.3 * kick(bass.value),
  }));
  const src = { uri: sized(art, 200) };
  // Android 12+ blurs the whole circle (soft edges); the image is also pre-blurred for older phones.
  const blur = { filter: [{ blur: 60 }, { saturate: 1.8 }] } as object;
  const big = 80 * vmax;
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <Animated.View
        style={[
          { position: "absolute", width: big, height: big, top: -32 * vmax, left: -24 * vmax, borderRadius: big / 2, overflow: "hidden" },
          blur,
          s1,
        ]}
      >
        <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={12} />
      </Animated.View>
      <Animated.View
        style={[
          {
            position: "absolute",
            width: big,
            height: big,
            right: -30 * vmax,
            bottom: -38 * vmax,
            borderRadius: big / 2,
            overflow: "hidden",
            opacity: 0.9,
          },
          blur,
          s2,
        ]}
      >
        <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={12} />
      </Animated.View>
      <Animated.View
        style={[
          {
            position: "absolute",
            width: 56 * vmax,
            height: 56 * vmax,
            top: height * 0.12,
            left: width * 0.28,
            borderRadius: 28 * vmax,
            overflow: "hidden",
          },
          blur,
          s3,
        ]}
      >
        <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={12} />
      </Animated.View>
    </View>
  );
}

/** CSS's saturate(s) as a colour matrix. */
function saturate(s: number) {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}
const SATURATE = saturate(1.8);

/**
 * `Blobs` for iOS, where React Native has no blur or saturate filter: the same three covers,
 * placed and moving the same way, drawn with Skia under Android's blur(60) and saturate(1.8).
 */
function SkiaBlobs({ art }: { art: string }) {
  const { width, height } = useWindowDimensions();
  const vmax = Math.max(width, height) / 100;
  const image = useImage(sized(art, 200));
  const { t1, t2, t3 } = useBlobClocks();

  const big = 80 * vmax;
  const small = 56 * vmax;
  // Where each circle sits (Blobs' top/left/right/bottom), and its centre to turn about.
  const b1 = { x: -24 * vmax, y: -32 * vmax, size: big };
  const b2 = { x: width + 30 * vmax - big, y: height + 38 * vmax - big, size: big };
  const b3 = { x: width * 0.28, y: height * 0.12, size: small };

  const turn = (t: number, reverse: boolean, swell: number) => {
    "worklet";
    const scale = (1 + 0.12 * Math.sin(Math.PI * t)) * (1 + swell);
    return [{ rotate: (reverse ? -2 : 2) * Math.PI * t }, { scale }] as Transforms3d;
  };
  const tr1 = useDerivedValue(() => turn(t1.value, false, 0.1 * kick(bass.value)));
  const tr2 = useDerivedValue(() => turn(t2.value, true, 0.07 * kick(bass.value)));
  const tr3 = useDerivedValue((): Transforms3d => [
    { translateX: (-6 + 14 * t3.value) * vmax },
    { translateY: (-4 + 10 * t3.value) * vmax },
    { rotate: ((-20 + 55 * t3.value) * Math.PI) / 180 },
    { scale: 1 + 0.16 * kick(bass.value) },
  ]);
  const op3 = useDerivedValue(() => 0.6 + 0.3 * kick(bass.value));

  if (!image) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Group
        layer={
          <Paint>
            <Blur blur={60} />
            <ColorMatrix matrix={SATURATE} />
          </Paint>
        }
      >
        <SkiaBlob image={image} at={b1} transform={tr1} />
        <SkiaBlob image={image} at={b2} transform={tr2} opacity={0.9} />
        <SkiaBlob image={image} at={b3} transform={tr3} opacity={op3} />
      </Group>
    </Canvas>
  );
}

function SkiaBlob({
  image,
  at,
  transform,
  opacity,
}: {
  image: SkImage;
  at: { x: number; y: number; size: number };
  transform: SharedValue<Transforms3d>;
  opacity?: number | SharedValue<number>;
}) {
  const r = rect(at.x, at.y, at.size, at.size);
  return (
    <Group transform={transform} origin={{ x: at.x + at.size / 2, y: at.y + at.size / 2 }} opacity={opacity}>
      <Group clip={rrect(r, at.size / 2, at.size / 2)}>
        <SkiaImage image={image} x={r.x} y={r.y} width={at.size} height={at.size} fit="cover" />
      </Group>
    </Group>
  );
}
