import Native from "harmoni-player";
import { useEffect } from "react";
import { AccessibilityInfo } from "react-native";
import { makeMutable, useFrameCallback } from "react-native-reanimated";

import { frameLoop } from "@/lib/frames";
import { kv } from "@/lib/storage";

/**
 * The bass in what's playing, for the Now Playing backdrop to move with.
 *
 * The native meter (BassMeter.kt) knows what's coming out of the speaker and
 * what's about to: JS asks it for the next half second, a frame at a time,
 * and the UI thread plays that out against the clock, easing towards each
 * value (quick to rise, slow to fall, like a VU meter). So the backdrop keeps
 * the beat even when the JS thread only gets round to asking a few times a
 * second.
 */
export const bass = makeMutable(0);
const ahead = makeMutable<{ at: number; v: number[] }>({ at: 0, v: [] });

const FRAMES = 30;
const STEP = 1000 / 60;

export const bassBackdropOn = () => kv.get("settings.bassBackdrop", true);

let users = 0;
let stop: (() => void) | null = null;
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => (reduceMotion = v))
  .catch(() => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => (reduceMotion = v));

function poll() {
  let v: number[] = [];
  try {
    if (!reduceMotion && bassBackdropOn()) v = Native.bassWindow(FRAMES);
  } catch {
    v = [];
  }
  ahead.value = { at: Date.now(), v };
}

/** Keeps `bass` live while mounted (the Now Playing sheet) and the app is on screen. */
export function useBass() {
  useEffect(() => {
    if (users++ === 0) stop = frameLoop(poll);
    return () => {
      if (--users === 0) {
        stop?.();
        stop = null;
        ahead.value = { at: 0, v: [] };
      }
    };
  }, []);
  useFrameCallback((f) => {
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    const w = ahead.value;
    const k = Math.max(0, Math.floor((Date.now() - w.at) / STEP));
    const b = bass.value;
    // Past the window (JS fell far behind) or past what's decoded: let it fall.
    let t = k < w.v.length ? w.v[k] : 0;
    if (t < 0) t = b * 0.9;
    // Attack in ~40 ms, release in ~260 ms.
    const a = t > b ? 1 - Math.exp(-dt / 0.04) : 1 - Math.exp(-dt / 0.26);
    bass.value = b + (t - b) * a;
  });
  return bass;
}
