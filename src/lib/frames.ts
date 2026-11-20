import { AppState } from "react-native";

/**
 * Calls `fn` every frame while the app is on screen, and not at all in the background.
 * Returns a function that stops it.
 *
 * React Native's requestAnimationFrame is a 1 ms timer. On iOS, JS timers keep running in
 * the background while audio plays, and there a frame loop spins as fast as the CPU allows:
 * iOS kills the app for it after about a minute. (Android stops JS timers in the
 * background, so loops there pause by themselves.)
 */
export function frameLoop(fn: (t: number) => void): () => void {
  let raf = 0;
  let stopped = false;
  const tick = (t: number) => {
    raf = 0;
    if (stopped || AppState.currentState !== "active") return;
    fn(t);
    if (!stopped) raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (!stopped && !raf && AppState.currentState === "active") raf = requestAnimationFrame(tick);
  };
  const sub = AppState.addEventListener("change", (s) => {
    if (s === "active") start();
  });
  start();
  return () => {
    stopped = true;
    sub.remove();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}
