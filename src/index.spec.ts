/*
 ** Copyright 2024 Devin Weaver
 **
 ** Licensed under the Apache License, Version 2.0 (the "License");
 ** you may not use this file except in compliance with the License.
 ** You may obtain a copy of the License at
 **
 **     http://www.apache.org/licenses/LICENSE-2.0
 **
 ** Unless required by applicable law or agreed to in writing, software
 ** distributed under the License is distributed on an "AS IS" BASIS,
 ** WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 ** See the License for the specific language governing permissions and
 ** limitations under the License.
 */

/* eslint-disable @typescript-eslint/no-this-alias */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Signal } from './index.js';

describe("Signal.State", () => {
  it("should work", () => {
    const stateSignal = new Signal.State(0);
    expect(stateSignal.get()).toEqual(0);

    stateSignal.set(10);

    expect(stateSignal.get()).toEqual(10);
  });
});

describe("Computed", () => {
  it("should work", () => {
    const stateSignal = new Signal.State(1);

    const computedSignal = new Signal.Computed(() => {
      const f = stateSignal.get() * 2;
      return f;
    });

    expect(computedSignal.get()).toEqual(2);

    stateSignal.set(5);

    expect(stateSignal.get()).toEqual(5);
    expect(computedSignal.get()).toEqual(10);
  });
});

describe("Watcher", () => {
  type Destructor = () => void;
  const notifySpy = vi.fn();

  const watcher = new Signal.subtle.Watcher(() => {
    notifySpy();
  });

  function effect(cb: () => Destructor | undefined): () => void {
    let destructor: Destructor | undefined;
    const c = new Signal.Computed(() => (destructor = cb()));
    watcher.watch(c);
    c.get();
    return () => {
      destructor?.();
      watcher.unwatch(c);
    };
  }

  function flushPending() {
    for (const signal of watcher.getPending()) {
      signal.get();
    }
    expect(watcher.getPending()).toStrictEqual([]);
  }

  it("should work", () => {
    const watchedSpy = vi.fn();
    const unwatchedSpy = vi.fn();
    const stateSignal = new Signal.State(1);

    stateSignal.set(100);
    stateSignal.set(5);

    const computedSignal = new Signal.Computed(() => stateSignal.get() * 2);

    let calls = 0;
    let output = 0;
    let computedOutput = 0;

    const destructor = effect(() => {
      output = stateSignal.get();
      computedOutput = computedSignal.get();
      calls++;
      return () => {};
    });

    // It should not have notified yet
    expect(notifySpy).not.toHaveBeenCalled();

    stateSignal.set(10);

    // After a signal has been set, it should notify
    expect(notifySpy).toHaveBeenCalled();

    // Initially, the effect should not have run
    expect(calls).toEqual(1);
    expect(output).toEqual(5);
    expect(computedOutput).toEqual(10);

    flushPending();

    // The effect should run, and thus increment the value
    expect(calls).toEqual(2);
    expect(output).toEqual(10);
    expect(computedOutput).toEqual(20);

    // Kicking it off again, the effect should run again
    watcher.watch();
    stateSignal.set(20);
    expect(watcher.getPending()).toHaveLength(1);
    flushPending();

    // After a signal has been set, it should notify again
    expect(notifySpy).toHaveBeenCalledTimes(2);

    expect(calls).toEqual(3);
    expect(output).toEqual(20);
    expect(computedOutput).toEqual(40);

    Signal.subtle.untrack(() => {
      // Untrack doesn't affect set, only get
      stateSignal.set(999);
      expect(calls).toEqual(3);
      flushPending();
      expect(calls).toEqual(4);
    });

    // Destroy and un-subscribe
    destructor();

    // Since now it is un-subscribed, this should have no effect now
    stateSignal.set(200);
    flushPending();

    // Make sure that effect is no longer running
    // Everything should stay the same
    expect(calls).toEqual(4);
    expect(output).toEqual(999);
    expect(computedOutput).toEqual(1998);

    expect(watcher.getPending()).toHaveLength(0);

    // Adding any other effect after an unwatch should work as expected
    const destructor2 = effect(() => {
      output = stateSignal.get();
      return () => {};
    });

    stateSignal.set(300);
    flushPending();

  });

  it("provides `this` to notify as normal function", () => {
    const mockGetPending = vi.fn();

    const watcher = new Signal.subtle.Watcher(function() {
      this.getPending();
    });
    watcher.getPending = mockGetPending;

    const signal = new Signal.State<number>(0);
    watcher.watch(signal);

    signal.set(1);
    expect(mockGetPending).toBeCalled();
  });

  it("can be closed in if needed in notify as an arrow function", () => {
    const mockGetPending = vi.fn();

    const watcher = new Signal.subtle.Watcher(() => {
      watcher.getPending();
    });
    watcher.getPending = mockGetPending;

    const signal = new Signal.State<number>(0);
    watcher.watch(signal);

    signal.set(1);
    expect(mockGetPending).toBeCalled();
  });
});

describe("Expected class shape", () => {
  it("should be on the prototype", () => {
    expect(typeof Signal.State.prototype.get).toBe("function");
    expect(typeof Signal.State.prototype.set).toBe("function");
    expect(typeof Signal.Computed.prototype.get).toBe("function");
    expect(typeof Signal.subtle.Watcher.prototype.watch).toBe("function");
    expect(typeof Signal.subtle.Watcher.prototype.unwatch).toBe("function");
    expect(typeof Signal.subtle.Watcher.prototype.getPending).toBe("function");
  });
});

describe("Untrack", () => {
  it("works", () => {
    const state = new Signal.State(1);
    const computed = new Signal.Computed(() =>
      Signal.subtle.untrack(() => state.get()),
    );
    expect(computed.get()).toBe(1);
    state.set(2);
    expect(computed.get()).toBe(1);
  });
  it("works differently without untrack", () => {
    const state = new Signal.State(1);
    const computed = new Signal.Computed(() => state.get());
    expect(computed.get()).toBe(1);
    state.set(2);
    expect(computed.get()).toBe(2);
  });
});

// Some things which we're comfortable with not hitting in code coverage:
// - The code for the callbacks (for reading signals and running watches)
// - Paths around writes being prohibited during computed/effect
// - Setters for various hooks
// - ngDevMode
// - Some predicates/getters for convenience, e.g., isReactive
