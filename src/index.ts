type Revision = number;

interface Signal<T> {
  get(): T;
}

interface SignalOptions<T> {
  // The signal is passed in as the this value for context.
  equals?: (this: Signal<T>, t: T, t2: T) => boolean;
  // Callback called when isWatched becomes true, if it was previously false
  [$WATCHED]?: (this: Signal<T>) => void;
  // Callback called whenever isWatched becomes false, if it was previously true
  [$UNWATCHED]?: (this: Signal<T>) => void;
}

interface Trackable {
  [$COMPUTED_REFS]: Set<Computed<unknown>>;
  [$LAST_REVISION]: Revision;
  [$LATEST_REVISION]: Revision;
}

interface Watchable extends Trackable {
  [$WATCHED](): void;
  [$UNWATCHED](): void;
}

const $WATCHED = Symbol('watched');
const $UNWATCHED = Symbol('unwatched');
const $WATCHER_NOTIFY = Symbol('watcher notify');
const $LAST_REVISION = Symbol('last revision');
const $LATEST_REVISION = Symbol('latest revision');
const $COMPUTED_REFS = Symbol('computed references');

let consumptionEnabled: boolean = true;
let currentRevision: Revision = 0;
let currentComputation: Set<Trackable> | null = null;
let currentComputedRef: Computed<unknown> | null = null;
let watchers = new Set<Watcher>();
let computeds = new Set<Computed<unknown>>();

function consumeTracked(tracked: Trackable): void {
  if (consumptionEnabled) tracked[$LAST_REVISION] = tracked[$LATEST_REVISION];
  if (currentComputation) currentComputation.add(tracked);
}

function dirtyTracked(tracked: Trackable): void {
  tracked[$LATEST_REVISION] = ++currentRevision;
  notifyWatchers();
}

function isTrackedDirty(tracked: Trackable): boolean {
  return tracked[$LATEST_REVISION] > tracked[$LAST_REVISION];
}

function getMaxRevision(trackables: Trackable[]): Revision {
  return Math.max(0, ...trackables.map((tracked) => tracked[$LATEST_REVISION]));
}

function notifyWatchers(): void {
  for (let watcher of watchers) watcher[$WATCHER_NOTIFY].call(watcher);
}

class State<T> implements Signal<T>, Trackable, Watchable {
  [$COMPUTED_REFS] = new Set<Computed<unknown>>();
  [$LATEST_REVISION] = ++currentRevision;
  [$LAST_REVISION] = 0;
  [$WATCHED]() {}
  [$UNWATCHED]() {}

  constructor(private value: T, options: SignalOptions<T> = {}) {
    if (options.equals) this.equals = options.equals;
    if (options[$WATCHED]) this[$WATCHED] = options[$WATCHED];
    if (options[$UNWATCHED]) this[$UNWATCHED] = options[$UNWATCHED];
  }

  set(value: T): void {
    if (this.equals(this.value, value)) return;
    this.value = value;
    dirtyTracked(this);
  }

  get(): T {
    consumeTracked(this);
    return this.value;
  }

  private equals(t: T, t2: T): boolean {
    return t === t2;
  }
}

class Computed<T> implements Signal<T>, Trackable, Watchable {
  private declare lastValue: T;
  lastTracked: Trackable[] = [];
  [$COMPUTED_REFS] = new Set<Computed<unknown>>();
  [$LATEST_REVISION] = ++currentRevision;
  [$LAST_REVISION] = 0;
  [$WATCHED]() {}
  [$UNWATCHED]() {}

  constructor(private getValue: () => T, options: SignalOptions<T> = {}) {
    if (options[$WATCHED]) this[$WATCHED] = options[$WATCHED];
    if (options[$UNWATCHED]) this[$UNWATCHED] = options[$UNWATCHED];
  }

  getPending(): Trackable[] {
    return this.lastTracked.filter(isTrackedDirty);
  }

  get(): T {
    if (
      this.lastTracked.length > 0
      && this[$LATEST_REVISION] >= getMaxRevision(this.lastTracked)
    ) {
      if (currentComputation && this.lastTracked.length > 0)
        for (let tracked of this.lastTracked) currentComputation.add(tracked);
      consumeTracked(this);
      return this.lastValue;
    }

    let previousComputation = currentComputation;
    currentComputation = new Set<Trackable>();
    currentComputedRef = this;

    for (let tracked of this.lastTracked) tracked[$COMPUTED_REFS].delete(this);

    try {
      this.lastValue = this.getValue.call(this);
    } finally {
      this.lastTracked = Array.from(currentComputation ?? []);
      dirtyTracked(this);
      consumeTracked(this);

      if (previousComputation)
        for (let tracked of currentComputation)
          previousComputation.add(tracked);

      for (let tracked of this.lastTracked) tracked[$COMPUTED_REFS].add(this);

      currentComputation = previousComputation;
      currentComputedRef = null;
    }

    return this.lastValue;
  }
}

// This namespace includes "advanced" features that are better to
// leave for framework authors rather than application developers.
// Analogous to `crypto.subtle`
function untrack<T>(cb: () => T): T {
  consumptionEnabled = false;
  try {
    return cb();
  } finally {
    consumptionEnabled = true;
  }
}

// Get the current computed signal which is tracking any signal reads, if any
function currentComputed(): Computed<unknown> | undefined {
  return currentComputedRef ?? undefined;
}

// Returns ordered list of all signals which this one referenced
// during the last time it was evaluated.
// For a Watcher, lists the set of signals which it is watching.
function introspectSources(sink: Computed<unknown> | Watcher): Trackable[] {
  if (sink instanceof Computed) return sink.lastTracked;
  if (sink instanceof Watcher) return Array.from(sink.watched);
  return [];
}

// Returns the Watchers that this signal is contained in, plus any
// Computed signals which read this signal last time they were evaluated,
// if that computed signal is (recursively) watched.
function introspectSinks(
  source: State<unknown> | Computed<unknown>
): (Computed<unknown> | Watcher)[] {
  return Array.from(new Set([
    ...Array.from(watchers).filter((watcher) => watcher.watched.has(source)),
    ...source[$COMPUTED_REFS],
  ]));
}

// True if this signal is "live", in that it is watched by a Watcher,
// or it is read by a Computed signal which is (recursively) live.
function hasSinks(source: State<unknown> | Computed<unknown>): boolean {
  if (source[$COMPUTED_REFS].size > 0) return true;
  for (let watcher of watchers) if (watcher.watched.has(source)) return true;
  return false;
}

// True if this element is "reactive", in that it depends
// on some other signal. A Computed where hasSources is false
// will always return the same constant.
function hasSources(sink: Computed<unknown> | Watcher): boolean {
  if (sink instanceof Computed) return sink.lastTracked.length > 0;
  if (sink instanceof Watcher) return sink.watched.size > 0;
  return false;
}

class Watcher {
  watched = new Set<Watchable>();
  [$WATCHER_NOTIFY]: (this: Watcher) => void;

  // When a (recursive) source of Watcher is written to, call this callback,
  // if it hasn't already been called since the last `watch` call.
  // No signals may be read or written during the notify.
  constructor(notify: (this: Watcher) => void) {
    this[$WATCHER_NOTIFY] = notify;
  }

  // Add these signals to the Watcher's set, and set the watcher to run its
  // notify callback next time any signal in the set (or one of its dependencies) changes.
  // Can be called with no arguments just to reset the "notified" state, so that
  // the notify callback will be invoked again.
  watch(...watchables: Watchable[]): void {
    for (let watchable of watchables) {
      this.watched.add(watchable);
      watchable[$WATCHED]();
    }
    if (this.watched.size > 0) watchers.add(this);
  }

  // Remove these signals from the watched set (e.g., for an effect which is disposed)
  unwatch(...watchables: Watchable[]): void {
    for (let watchable of watchables) {
      this.watched.delete(watchable);
      watchable[$UNWATCHED]();
    }
    if (this.watched.size === 0) watchers.delete(this);
  }

  // Returns the set of sources in the Watcher's set which are still dirty, or is a computed signal
  // with a source which is dirty or pending and hasn't yet been re-evaluated
  getPending(): Trackable[] {
    return Array.from(this.watched).filter(isTrackedDirty);
  }
}

export const Signal = {
  State,
  Computed,
  subtle: {
    Watcher,
    currentComputed,
    introspectSinks,
    introspectSources,
    hasSources,
    hasSinks,
    untrack,
    watched: $WATCHED,
    unwatched: $UNWATCHED,
  },
};
