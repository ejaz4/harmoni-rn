import * as Haptics from "expo-haptics";
import { AndroidHaptics, ImpactFeedbackStyle, NotificationFeedbackType } from "expo-haptics";
import { Platform } from "react-native";

import { kv } from "./storage";

let enabled = kv.get("settings.haptics", true);
const api = typeof Platform.Version === "number" ? Platform.Version : 0;
const ios = Platform.OS === "ios";

export function setHapticsEnabled(on: boolean) {
  enabled = on;
  kv.set("settings.haptics", on);
}

export function hapticsEnabled() {
  return enabled;
}

/** What iOS plays instead: its generators are selection, impact (by weight) and notification. */
type IosHaptic = "selection" | ImpactFeedbackStyle | NotificationFeedbackType;

function playIos(kind: IosHaptic) {
  if (kind === "selection") Haptics.selectionAsync().catch(() => {});
  else if (Object.values(NotificationFeedbackType).includes(kind as NotificationFeedbackType)) Haptics.notificationAsync(kind as NotificationFeedbackType).catch(() => {});
  else Haptics.impactAsync(kind as ImpactFeedbackStyle).catch(() => {});
}

/** Plays an Android haptic constant if this Android has it, else a close fallback; on iOS, the nearest iOS feedback. */
function play(type: AndroidHaptics, minApi: number, fallback: AndroidHaptics | ImpactFeedbackStyle, onIos: IosHaptic) {
  if (!enabled) return;
  if (ios) {
    playIos(onIos);
    return;
  }
  if (api >= minApi) {
    Haptics.performAndroidHapticsAsync(type).catch(() => {});
    return;
  }
  if (Object.values(ImpactFeedbackStyle).includes(fallback as ImpactFeedbackStyle)) Haptics.impactAsync(fallback as ImpactFeedbackStyle).catch(() => {});
  else Haptics.performAndroidHapticsAsync(fallback as AndroidHaptics).catch(() => {});
}

/** Android's own haptic vocabulary, named for what the app is doing (with iOS's closest match). */
export const haptic = {
  tap: () => play(AndroidHaptics.Virtual_Key, 0, AndroidHaptics.Virtual_Key, ImpactFeedbackStyle.Light),
  select: () => play(AndroidHaptics.Segment_Tick, 34, AndroidHaptics.Clock_Tick, "selection"),
  tick: () => play(AndroidHaptics.Clock_Tick, 0, AndroidHaptics.Clock_Tick, "selection"),
  frequentTick: () => play(AndroidHaptics.Segment_Frequent_Tick, 34, AndroidHaptics.Clock_Tick, "selection"),
  longPress: () => play(AndroidHaptics.Long_Press, 0, AndroidHaptics.Long_Press, ImpactFeedbackStyle.Medium),
  toggleOn: () => play(AndroidHaptics.Toggle_On, 34, AndroidHaptics.Virtual_Key, ImpactFeedbackStyle.Rigid),
  toggleOff: () => play(AndroidHaptics.Toggle_Off, 34, AndroidHaptics.Virtual_Key, ImpactFeedbackStyle.Soft),
  confirm: () => play(AndroidHaptics.Confirm, 30, ImpactFeedbackStyle.Medium, NotificationFeedbackType.Success),
  reject: () => play(AndroidHaptics.Reject, 30, ImpactFeedbackStyle.Heavy, NotificationFeedbackType.Error),
  dragStart: () => play(AndroidHaptics.Drag_Start, 34, AndroidHaptics.Long_Press, ImpactFeedbackStyle.Medium),
  gestureStart: () => play(AndroidHaptics.Gesture_Start, 30, AndroidHaptics.Clock_Tick, ImpactFeedbackStyle.Soft),
  gestureEnd: () => play(AndroidHaptics.Gesture_End, 30, AndroidHaptics.Virtual_Key, ImpactFeedbackStyle.Light),
  contextClick: () => play(AndroidHaptics.Context_Click, 0, AndroidHaptics.Context_Click, ImpactFeedbackStyle.Light),
};
