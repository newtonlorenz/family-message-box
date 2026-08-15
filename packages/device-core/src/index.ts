export type ButtonMode = "idle" | "recording" | "waiting" | "playing" | "error";
export type ButtonEffect =
  | { type: "recording.start" }
  | { type: "recording.too_short"; remainingMs: number }
  | { type: "recording.stop_upload"; durationMs: number }
  | { type: "recording.auto_stop_upload"; durationMs: number }
  | { type: "playback.start_oldest" }
  | { type: "none" };

export interface ButtonState {
  mode: ButtonMode;
  pressedAt: number | null;
  recordingStartedAt: number | null;
  waitingCount: number;
}

export interface ButtonInputState {
  rawPressed: boolean;
  stablePressed: boolean;
  rawChangedAt: number;
}

export const initialButtonInputState = (pressed = false, nowMs = 0): ButtonInputState => ({
  rawPressed: pressed,
  stablePressed: pressed,
  rawChangedAt: nowMs
});

export function sampleButtonInput(
  state: ButtonInputState,
  rawPressed: boolean,
  nowMs: number,
  debounceMs = 45
): { state: ButtonInputState; pressedEdge: boolean; releasedEdge: boolean } {
  if (rawPressed !== state.rawPressed) {
    return {
      state: { ...state, rawPressed, rawChangedAt: nowMs },
      pressedEdge: false,
      releasedEdge: false
    };
  }
  if (rawPressed === state.stablePressed || nowMs - state.rawChangedAt < debounceMs) {
    return { state, pressedEdge: false, releasedEdge: false };
  }
  return {
    state: { ...state, stablePressed: rawPressed },
    pressedEdge: rawPressed,
    releasedEdge: !rawPressed
  };
}

export const initialButtonState = (): ButtonState => ({
  mode: "idle", pressedAt: null, recordingStartedAt: null, waitingCount: 0
});

export function buttonPressed(
  state: ButtonState, nowMs: number, minimumMs = 3_000, maximumMs = 30_000
): { state: ButtonState; effect: ButtonEffect } {
  if (state.mode === "waiting" && state.waitingCount > 0) {
    return { state: { ...state, mode: "playing", pressedAt: nowMs }, effect: { type: "playback.start_oldest" } };
  }
  if (state.mode === "idle") {
    return { state: { ...state, mode: "recording", recordingStartedAt: nowMs, pressedAt: nowMs }, effect: { type: "recording.start" } };
  }
  if (state.mode === "recording" && state.recordingStartedAt !== null) {
    const durationMs = nowMs - state.recordingStartedAt;
    if (durationMs < minimumMs) return { state, effect: { type: "recording.too_short", remainingMs: minimumMs - durationMs } };
    return {
      state: { ...state, mode: "idle", recordingStartedAt: null, pressedAt: nowMs },
      effect: { type: "recording.stop_upload", durationMs: Math.min(durationMs, maximumMs) }
    };
  }
  return { state, effect: { type: "none" } };
}

export function tick(state: ButtonState, nowMs: number, maximumMs = 30_000): { state: ButtonState; effect: ButtonEffect } {
  if (state.mode === "recording" && state.recordingStartedAt !== null && nowMs - state.recordingStartedAt >= maximumMs) {
    return {
      state: { ...state, mode: "idle", recordingStartedAt: null },
      effect: { type: "recording.auto_stop_upload", durationMs: maximumMs }
    };
  }
  return { state, effect: { type: "none" } };
}

export function debouncedEdge(lastAcceptedAt: number, nowMs: number, debounceMs = 45): boolean {
  return nowMs - lastAcceptedAt >= debounceMs;
}

export function queueUpdated(state: ButtonState, waitingCount: number): ButtonState {
  const safeCount = Math.max(0, Math.floor(waitingCount));
  if (state.mode === "recording" || state.mode === "playing") {
    return { ...state, waitingCount: safeCount };
  }
  return { ...state, waitingCount: safeCount, mode: safeCount > 0 ? "waiting" : "idle" };
}

export function playbackCompleted(state: ButtonState): ButtonState {
  if (state.mode !== "playing") return state;
  return { ...state, mode: state.waitingCount > 0 ? "waiting" : "idle" };
}

export function waitingLampOn(state: ButtonState, nowMs: number, intervalMs = 650): boolean {
  return state.waitingCount > 0 && Math.floor(nowMs / intervalMs) % 2 === 0;
}
