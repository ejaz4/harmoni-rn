import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import { AppState, Platform } from "react-native";
import { create } from "zustand";

import { serverOrigin } from "@/api/client";
import type { DeviceKind, LinkCommand, LinkDevice, LinkEvent, LinkState, QueueSong } from "@/api/types";
import { after, onTick } from "@/lib/heartbeat";
import { kv } from "@/lib/storage";
import { readLines } from "@/lib/stream";
import Native from "harmoni-player";

// Harmoni Link transport: the event stream, reports, commands and transfers.
// The player (src/player) decides what to do with them.

export const deviceId: string = (() => {
  let id = kv.get<string | null>("link.device", null);
  if (!id) {
    id = Crypto.randomUUID();
    kv.set("link.device", id);
  }
  return id;
})();

export const deviceKind: DeviceKind = Device.deviceType === Device.DeviceType.TABLET ? "tablet" : "phone";

/** The phone's own name (Settings › About), else its model, else "Android phone" (or "iPhone"). */
export function deviceName(): string {
  const custom = kv.get<string | null>("link.name", null);
  if (custom) return custom;
  const own = Device.deviceName?.trim();
  if (own && !/^sdk_|^generic|_/.test(own)) return own.slice(0, 60);
  const model = Device.modelName?.trim();
  if (model && !/^sdk_|^generic|_/.test(model)) return model.slice(0, 60);
  if (Platform.OS === "ios") return deviceKind === "tablet" ? "iPad" : "iPhone";
  return deviceKind === "tablet" ? "Android tablet" : "Android phone";
}

export function setDeviceName(name: string) {
  kv.set("link.name", name.trim().slice(0, 60) || null);
  link.reconnect();
}

/** Whether this device joins Harmoni Link (Settings). */
export const useLinkPref = create<{ on: boolean }>(() => ({ on: kv.get("link.on", true) }));
export function setLinkPref(on: boolean) {
  kv.set("link.on", on);
  useLinkPref.setState({ on });
}

interface LinkStore {
  enabled: boolean;
  connected: boolean;
  devices: LinkDevice[];
  active: string | null;
  /** The account's playback as the server last told us (remotes show this). */
  state: LinkState | null;
  offset: number;
  rev: number;
}

export const useLink = create<LinkStore>(() => ({
  enabled: false,
  connected: false,
  devices: [],
  active: null,
  state: null,
  offset: 0,
  rev: 0,
}));

export const serverNow = () => Date.now() + useLink.getState().offset;

/** Where the playhead is now, from a LinkState. */
export function positionNow(s: Pick<LinkState, "positionMs" | "playing" | "at" | "durationMs">): number {
  const p = s.positionMs + (s.playing ? Math.max(0, serverNow() - s.at) : 0);
  return s.durationMs ? Math.min(p, s.durationMs) : p;
}

export function onlineDevices(): LinkDevice[] {
  const now = serverNow();
  return useLink.getState().devices.filter((d) => (untilById.get(d.id) ?? d.until) > now);
}

type Handler = (e: LinkEvent) => void;
let handler: Handler = () => {};
export function setLinkHandler(h: Handler) {
  handler = h;
}

const BACKOFF = [1000, 2000, 5000, 10000, 30000];

/** The newest expiry time per device; kept out of state so pings don't re-render. */
const untilById = new Map<string, number>();
function noteUntil(list: LinkDevice[]) {
  for (const d of list) untilById.set(d.id, d.until);
}

/** Same devices (ignoring their expiry times, which move on every ping)? */
function sameDevices(a: LinkDevice[], b: LinkDevice[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id || a[i].name !== b[i].name || a[i].kind !== b[i].kind) return false;
  return true;
}

/** The clock offset, kept steady unless it really moved (network jitter otherwise re-renders everything). */
function steadyOffset(prev: number, serverNow: number) {
  const next = serverNow - Date.now();
  return Math.abs(next - prev) > 250 ? next : prev;
}

class LinkClient {
  private abort: AbortController | null = null;
  private attempt = 0;
  private lastEventAt = 0;
  private cancelRetry: (() => void) | null = null;
  private generation = 0;
  private revCheck: (() => void) | null = null;
  private lastSeq = kv.get<number>("link.seq", 0);
  private reporting: Promise<unknown> = Promise.resolve();

  constructor() {
    onTick(() => {
      if (!useLink.getState().enabled || !this.abort) return;
      // 40 s of silence means the stream is dead, whatever the socket says.
      if (this.lastEventAt && Date.now() - this.lastEventAt > 40_000) this.reconnect();
    });
    AppState.addEventListener("change", (s) => {
      if (s === "active" && useLink.getState().enabled && Date.now() - this.lastEventAt > 20_000) this.reconnect();
    });
  }

  setEnabled(on: boolean) {
    if (useLink.getState().enabled === on) return;
    useLink.setState({ enabled: on });
    if (on) this.connect();
    else this.disconnect();
  }

  disconnect() {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.cancelRetry?.();
    this.cancelRetry = null;
    useLink.setState({ connected: false, devices: [], active: null });
  }

  reconnect() {
    if (!useLink.getState().enabled) return;
    this.abort?.abort();
    this.abort = null;
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.connect();
  }

  private scheduleRetry() {
    if (!useLink.getState().enabled) return;
    const wait = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt++;
    this.cancelRetry?.();
    this.cancelRetry = after(wait, () => {
      this.cancelRetry = null;
      this.connect();
    });
  }

  private async connect() {
    const origin = serverOrigin();
    if (!origin || this.abort) return;
    const gen = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.lastEventAt = Date.now();
    try {
      const token = await Native.getAccessToken(); // checked only when the stream opens, so refresh first
      const qs = new URLSearchParams({ device: deviceId, name: deviceName(), kind: deviceKind });
      const res = await fetch(`${origin}/api/link?${qs}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        signal: abort.signal,
      });
      if (res.status === 403) {
        useLink.setState({ enabled: false, connected: false });
        return;
      }
      if (res.status === 401) await Native.refreshAccessToken(token);
      if (!res.ok) throw new Error(`link ${res.status}`);
      await readLines(
        res,
        (line) => {
          if (gen !== this.generation || !line.startsWith("data:")) {
            if (line.startsWith(":") || line.startsWith("retry:")) this.lastEventAt = Date.now();
            return;
          }
          this.lastEventAt = Date.now();
          let event: LinkEvent;
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            return;
          }
          this.attempt = 0;
          this.receive(event);
        },
        abort.signal,
      );
    } catch {
      // fall through to a retry
    }
    if (gen !== this.generation) return;
    this.abort = null;
    useLink.setState({ connected: false });
    this.scheduleRetry();
  }

  private noteRev(rev: number | undefined) {
    if (typeof rev === "number" && rev > useLink.getState().rev) useLink.setState({ rev });
  }

  private receive(e: LinkEvent) {
    const s = useLink.getState();
    if ("devices" in e && Array.isArray(e.devices)) noteUntil(e.devices);
    switch (e.type) {
      case "hello":
        useLink.setState({
          connected: true,
          devices: e.devices,
          active: e.active,
          state: e.state,
          offset: e.now - Date.now(),
          rev: e.state?.rev ?? 0,
        });
        break;
      case "devices":
        useLink.setState({ devices: sameDevices(s.devices, e.devices) ? s.devices : e.devices, active: e.active, offset: steadyOffset(s.offset, e.now) });
        break;
      case "ping": {
        if (!sameDevices(s.devices, e.devices) || s.active !== e.active || Math.abs(s.offset - (e.now - Date.now())) > 250)
          useLink.setState({ devices: sameDevices(s.devices, e.devices) ? s.devices : e.devices, active: e.active, offset: steadyOffset(s.offset, e.now) });
        const iAmActive = e.active === deviceId;
        if (!iAmActive && typeof e.rev === "number" && e.rev > s.rev && !this.revCheck) {
          // Maybe a state event is on its way; give it 3 s, then resync.
          const target = e.rev;
          this.revCheck = after(3000, () => {
            this.revCheck = null;
            if (useLink.getState().rev < target) this.reconnect();
          });
        }
        break;
      }
      case "state": {
        const iAmActive = s.active === deviceId;
        if (!iAmActive && typeof e.state.rev === "number" && s.rev && e.state.rev > s.rev + 1) {
          this.reconnect(); // missed a change: our queue can't be trusted
          return;
        }
        if (!s.state && !e.state.queue) break;
        const merged = { ...(s.state ?? ({} as LinkState)), ...e.state } as LinkState;
        useLink.setState({ state: merged });
        this.noteRev(e.state.rev);
        break;
      }
      case "transfer":
        if (e.state) useLink.setState({ state: e.state, active: deviceId });
        this.noteRev(e.state?.rev);
        break;
      case "release":
      case "command":
        break;
    }
    handler(e);
  }

  private async post(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
    const origin = serverOrigin();
    if (!origin) return { status: 0, json: {} };
    let token = await Native.getAccessToken();
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(`${origin}/api/link`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ device: deviceId, ...body }),
        });
        if (res.status === 401 && i === 0) {
          token = await Native.refreshAccessToken(token);
          continue;
        }
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json };
      } catch {
        return { status: 0, json: {} };
      }
    }
    return { status: 401, json: {} };
  }

  /** Reports our playback (one at a time, increasing seq). Resolves with the result. */
  report(patch: ReportPatch, claim: boolean): Promise<"ok" | "stale" | "not-playing" | "gone" | "error"> {
    const run = async () => {
      const seq = Math.max(this.lastSeq + 1, Date.now());
      this.lastSeq = seq;
      kv.set("link.seq", seq);
      const { status, json } = await this.post({ action: "state", seq, claim, patch });
      if (status === 409) return "gone" as const;
      if (status !== 200) return "error" as const;
      const result = json.result as string;
      if (result === "ok") {
        this.noteRev(json.rev as number);
        if (useLink.getState().active !== deviceId) useLink.setState({ active: deviceId });
        return "ok" as const;
      }
      if (result === "stale" || result === "not-playing") return result;
      return "error" as const;
    };
    const p = this.reporting.then(run, run);
    this.reporting = p.catch(() => {});
    return p;
  }

  async command(command: LinkCommand): Promise<boolean> {
    const { status, json } = await this.post({ action: "command", command });
    return status === 200 && json.sent === true;
  }

  async transfer(to: string): Promise<boolean> {
    const { status, json } = await this.post({ action: "transfer", to });
    if (status === 200 && json.moved) {
      if (to === deviceId) useLink.setState({ active: deviceId });
      return true;
    }
    return false;
  }
}

export interface ReportPatch {
  index: number;
  playing: boolean;
  positionMs: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  buffering: boolean;
  error: string | null;
  volume: number;
  muted: boolean;
  durationMs: number | null;
  queue?: QueueSong[];
  unshuffled?: QueueSong[] | null;
}

export const link = new LinkClient();
