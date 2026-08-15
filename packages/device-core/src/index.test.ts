import { describe, expect, it } from "vitest";
import {
  buttonPressed,
  debouncedEdge,
  initialButtonInputState,
  initialButtonState,
  playbackCompleted,
  queueUpdated,
  sampleButtonInput,
  tick,
  waitingLampOn
} from "./index.js";

describe("button state machine", () => {
  it("starts, enforces three seconds, then stops a recording", () => {
    const started = buttonPressed(initialButtonState(), 1_000);
    expect(started.effect.type).toBe("recording.start");
    const tooShort = buttonPressed(started.state, 2_500);
    expect(tooShort.effect).toEqual({ type: "recording.too_short", remainingMs: 1_500 });
    const stopped = buttonPressed(tooShort.state, 4_100);
    expect(stopped.effect).toEqual({ type: "recording.stop_upload", durationMs: 3_100 });
  });

  it("auto-stops at thirty seconds", () => {
    const started = buttonPressed(initialButtonState(), 0);
    expect(tick(started.state, 29_999).effect.type).toBe("none");
    expect(tick(started.state, 30_000).effect).toEqual({ type: "recording.auto_stop_upload", durationMs: 30_000 });
  });

  it("plays waiting audio before starting a new recording", () => {
    const state = { ...initialButtonState(), mode: "waiting" as const, waitingCount: 2 };
    expect(buttonPressed(state, 100).effect.type).toBe("playback.start_oldest");
  });

  it("rejects switch bounce inside 45 ms", () => {
    expect(debouncedEdge(100, 144)).toBe(false);
    expect(debouncedEdge(100, 145)).toBe(true);
  });

  it("emits one press edge for a held button after it is stable", () => {
    let input = initialButtonInputState();
    let sample = sampleButtonInput(input, true, 100);
    input = sample.state;
    expect(sample.pressedEdge).toBe(false);

    sample = sampleButtonInput(input, false, 120);
    input = sample.state;
    sample = sampleButtonInput(input, true, 130);
    input = sample.state;
    expect(sample.pressedEdge).toBe(false);

    sample = sampleButtonInput(input, true, 175);
    input = sample.state;
    expect(sample.pressedEdge).toBe(true);
    expect(sampleButtonInput(input, true, 3_500).pressedEdge).toBe(false);
  });

  it("keeps the waiting lamp active until the final message is cleared", () => {
    const twoWaiting = queueUpdated(initialButtonState(), 2);
    expect(twoWaiting.mode).toBe("waiting");
    expect(waitingLampOn(twoWaiting, 0)).toBe(true);
    expect(waitingLampOn(twoWaiting, 650)).toBe(false);

    const oneWaiting = queueUpdated(twoWaiting, 1);
    expect(oneWaiting.mode).toBe("waiting");
    expect(waitingLampOn(oneWaiting, 1_300)).toBe(true);

    const cleared = queueUpdated(oneWaiting, 0);
    expect(cleared.mode).toBe("idle");
    expect(waitingLampOn(cleared, 1_300)).toBe(false);
  });

  it("does not interrupt playback when a queue update arrives", () => {
    const waiting = queueUpdated(initialButtonState(), 1);
    const playing = buttonPressed(waiting, 100).state;
    const updated = queueUpdated(playing, 2);
    expect(updated.mode).toBe("playing");
    expect(playbackCompleted(updated).mode).toBe("waiting");
  });
});
