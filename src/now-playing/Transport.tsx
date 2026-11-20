import { useEffect, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming } from "react-native-reanimated";

import { frameLoop } from "@/lib/frames";
import { haptic } from "@/lib/haptics";
import { time } from "@/lib/format";
import { readPosition, usePlayback } from "@/player/hooks";
import { player } from "@/player/player";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { Spinner } from "@/ui/Spinner";
import { Text } from "@/ui/Text";

const W = (a: number) => `rgba(255,255,255,${a})`;

/** The progress bar: fills smoothly every frame; drag scrubs, release seeks. */
export function Progress({ sheetPan }: { sheetPan?: GestureType }) {
  const pb = usePlayback();
  const width = useSharedValue(0);
  const fraction = useSharedValue(0);
  const scrubbing = useSharedValue(false);
  const scrubFraction = useSharedValue(0);
  const [labels, setLabels] = useState({ pos: 0, dur: pb.durationMs ?? pb.song?.durationMs ?? null });
  const durRef = useRef<number | null>(labels.dur);
  const lastLabel = useRef(0);
  const scrubbingJs = useRef(false);
  const thick = useSharedValue(5);

  // Read the playhead on the JS thread at ~30fps; fill on the UI thread. On screen only.
  useEffect(() => {
    let last = 0;
    const loop = (t: number) => {
      if (t - last < 33) return;
      last = t;
      const p = readPosition();
      const dur = p.durationMs ?? pb.song?.durationMs ?? null;
      durRef.current = dur;
      if (!scrubbingJs.current) {
        fraction.value = dur ? Math.min(1, p.positionMs / dur) : 0;
        if (t - lastLabel.current > 250) {
          lastLabel.current = t;
          setLabels((l) => (Math.floor(l.pos / 1000) === Math.floor(p.positionMs / 1000) && l.dur === dur ? l : { pos: p.positionMs, dur }));
        }
      }
    };
    return frameLoop(loop);
  }, [pb.song?.durationMs, fraction]);

  const setScrub = (on: boolean) => {
    scrubbingJs.current = on;
  };
  const showScrub = (f: number) => {
    const d = durRef.current;
    if (d) setLabels({ pos: f * d, dur: d });
  };
  const seek = (f: number) => {
    const d = durRef.current;
    if (d) player.seek(f * d);
    haptic.gestureEnd();
    setTimeout(() => setScrub(false), 300);
  };

  let pan = Gesture.Pan()
    .minDistance(2)
    .hitSlop({ top: 16, bottom: 16 })
    .onBegin((e) => {
      scrubbing.value = true;
      thick.value = withTiming(9, { duration: 140 });
      scrubFraction.value = Math.max(0, Math.min(1, e.x / Math.max(1, width.value)));
      runOnJS(setScrub)(true);
      runOnJS(haptic.gestureStart)();
    })
    .onUpdate((e) => {
      scrubFraction.value = Math.max(0, Math.min(1, e.x / Math.max(1, width.value)));
      runOnJS(showScrub)(scrubFraction.value);
    })
    .onEnd(() => {
      fraction.value = scrubFraction.value;
      runOnJS(seek)(scrubFraction.value);
    })
    .onFinalize(() => {
      scrubbing.value = false;
      thick.value = withTiming(5, { duration: 200 });
    });
  if (sheetPan) pan = pan.blocksExternalGesture(sheetPan);
  // A tap on the bar seeks there too, like clicking the web's slider.
  const tap = Gesture.Tap()
    .hitSlop({ top: 16, bottom: 16 })
    .onEnd((e, ok) => {
      if (!ok) return;
      const f = Math.max(0, Math.min(1, e.x / Math.max(1, width.value)));
      fraction.value = f;
      runOnJS(setScrub)(true);
      runOnJS(seek)(f);
    });
  const gesture = Gesture.Exclusive(pan, tap);

  const fill = useAnimatedStyle(() => ({ width: (scrubbing.value ? scrubFraction.value : fraction.value) * width.value }));
  const track = useAnimatedStyle(() => ({ height: thick.value, borderRadius: thick.value / 2 }));

  const dur = labels.dur;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 }}>
      <Text size={12} color={W(0.65)} tabular style={{ width: 40 }}>
        {time(labels.pos)}
      </Text>
      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1, height: 28, justifyContent: "center" }} onLayout={(e: LayoutChangeEvent) => (width.value = e.nativeEvent.layout.width)} accessibilityRole="adjustable" accessibilityLabel="Seek">
          <Animated.View style={[{ backgroundColor: W(0.22), overflow: "hidden" }, track]}>
            <Animated.View style={[{ height: "100%", backgroundColor: W(0.92) }, fill]} />
          </Animated.View>
        </View>
      </GestureDetector>
      <Text size={12} color={W(0.65)} tabular align="right" style={{ width: 40 }}>
        {time(dur)}
      </Text>
    </View>
  );
}

function Toggle({ on, icon, label, onPress, badge }: { on: boolean; icon: "shuffle" | "repeat"; label: string; onPress: () => void; badge?: boolean }) {
  return (
    <Press onPress={onPress} feedback={on ? "toggleOff" : "toggleOn"} scaleTo={0.9} accessibilityLabel={label} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={21} color={on ? "#fff" : W(0.55)} />
      {badge ? (
        <View style={{ position: "absolute", top: 5, right: 5, minWidth: 12, height: 12, borderRadius: 6, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
          <Text size={9} weight={700} color="rgba(0,0,0,0.75)" style={{ lineHeight: 11 }}>
            1
          </Text>
        </View>
      ) : null}
      {on ? <View style={{ position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: "#fff" }} /> : null}
    </Press>
  );
}

export function Controls() {
  const pb = usePlayback();
  const none = !pb.song;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 14 }}>
      <Toggle on={pb.shuffle} icon="shuffle" label={pb.shuffle ? "Shuffle on" : "Shuffle"} onPress={() => player.setShuffle(!pb.shuffle)} />
      <Press disabled={none} onPress={() => player.prev()} scaleTo={0.88} accessibilityLabel="Previous" style={{ padding: 4, opacity: none ? 0.35 : 1 }}>
        <Icon name="prev" size={44} color={W(0.92)} />
      </Press>
      <Press
        disabled={none}
        onPress={() => player.toggle()}
        feedback={pb.playing ? "toggleOff" : "toggleOn"}
        scaleTo={0.9}
        accessibilityLabel={pb.buffering && pb.playing ? "Loading" : pb.playing ? "Pause" : "Play"}
        style={{ width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", opacity: none ? 0.35 : 1 }}
      >
        {pb.buffering && pb.playing ? <Spinner size={44} color="#fff" /> : <Icon name={pb.playing ? "pause" : "play"} size={60} color="#fff" />}
      </Press>
      <Press disabled={none} onPress={() => player.next()} scaleTo={0.88} accessibilityLabel="Next" style={{ padding: 4, opacity: none ? 0.35 : 1 }}>
        <Icon name="next" size={44} color={W(0.92)} />
      </Press>
      <Toggle
        on={pb.repeat !== "off"}
        badge={pb.repeat === "one"}
        icon="repeat"
        label={pb.repeat === "off" ? "Repeat" : pb.repeat === "all" ? "Repeating all" : "Repeating this song"}
        onPress={() => player.cycleRepeat()}
      />
    </View>
  );
}

export { useFrameCallback };
