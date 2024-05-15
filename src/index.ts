type Revision = number;
type Taggable = State | Computed | Watcher;

interface Signal<T> {
  get(): T;
}

const $WATCHED = Symbol('watched');
const $UNWATCHED = Symbol('unwatched');
const $REVISION = Symbol('revision');
const $WATCHER_NOTIFY = Symbol('watcher notify');

const TAGGED = new WeakMap<Tag, Taggable>();
const WATCHERS = new Set<Watcher>();

let consumeTags: boolean = true;
let currentRevision: Revision = 0;
let currentComputation: Set<Tag> | null = null;
let currentComputed: Computed | null = null;

class Tag {
  [$REVISION]: Revision = CURRENT_REVISION;
  constructor(context: Taggable) {
    TAGGED.add(this, context);
  }
}

function dirtyTag(tag: Tag): void {
  if (currentComputation?.has(tag))
    throw new Error('cannot dirty tag that has been used during a computation');
  tag[$REVISION] = ++currentRevision;
  notifyWatchers();
}

function consumeTag(tag: Tag): void {
  if (consumeTag) currentComputation?.add(tag);
}

function notifyWatchers(): void {
  for (let watcher of WATCHERS) watcher[$WATCHER_NOTIFY]();
}

function getMax(tags: Tag[]): Revision {
  return Math.max(...tags.map((t) => t[$REVISION]));
}

export namespace Signal {
  class State<T> implements Signal<T> {
    private tag = new Tag(this);
    private equals = (a: T, b: T): boolean => a === b;
    private [$WATCHED] = (): void => {};
    private [$UNWATCHED] = (): void => {};

    constructor(private value: T, options: SignalOptions<T> = {}) {
      this.equals = options.equals ?? this.equals;
      this[$WATCHED] = options[$WATCHED] ?? this[$WATCHED];
      this[$UNWATCHED] = options[$UNWATCHED] ?? this[$UNWATCHED];
    }

    get(): T {
      consumeTag(this.tag);
      return this.value;
    }

    set(value: T): void {
      if (this.equals(this.value, value)) return;
      this.value = value;
      dirtyTag(this.tag);
    }
  }

  class Computed<T = unknown> implements Signal<T> {
    private lastTags: Tag[] | undefined;
    private lastRevision: Revision | undefined;
    private lastValue: T | undefined;
    private tag = new Tag(this);
    private equals = (a: T, b: T): boolean => a === b;
    private [$WATCHED] = (): void => {};
    private [$UNWATCHED] = (): void => {};

    constructor(private cb: (this: Computed<T>) => T, options: SignalOptions<T> = {}) {
      this.equals = options.equals ?? this.equals;
      this[$WATCHED] = options[$WATCHED] ?? this[$WATCHED];
      this[$UNWATCHED] = options[$UNWATCHED] ?? this[$UNWATCHED];
    }

    get(): T {
      currentComputed = this;

      if (this.lastTags && getMax(this.lastTags) === this.lastRevision) {
        if (currentComputation && this.lastTags.length > 0)
          for (let tag of this.lastTags) currentComputation.add(tag);
        currentComputed = null;
        return this.lastValue;
      }

      let previousComputation = currentComputation;
      currentComputation = new Set<Tag>();

      try {
        this.lastValue = this.cb.call(this);
      } finally {
        let tags = Array.from(currentComputation);
        this.lastTags = tags;
        this.lastRevision = getMax(tags);

        if (previousComputation && tags.length > 0)
          for (let tag of tags) previousComputation.add(tag);

        currentComputation = previousComputation;
        currentComputed = null;
      }

      return this.lastValue;
    }
  }

  // This namespace includes "advanced" features that are better to
  // leave for framework authors rather than application developers.
  // Analogous to `crypto.subtle`
  namespace subtle {
    function untrack<T>(cb: () => T): T {
      try {
        consumeTags = false;
        return cb();
      } finally {
        consumeTags = true;
      }
    }

    // Get the current computed signal which is tracking any signal reads, if any
    function currentComputed(): Computed | null {
      return currentComputed;
    }

    // Returns ordered list of all signals which this one referenced
    // during the last time it was evaluated.
    // For a Watcher, lists the set of signals which it is watching.
    // function introspectSources(s: Computed | Watcher): (State | Computed)[];

    // Returns the Watchers that this signal is contained in, plus any
    // Computed signals which read this signal last time they were evaluated,
    // if that computed signal is (recursively) watched.
    // function introspectSinks(s: State | Computed): (Computed | Watcher)[];

    // True if this signal is "live", in that it is watched by a Watcher,
    // or it is read by a Computed signal which is (recursively) live.
    // function hasSinks(s: State | Computed): boolean;

    // True if this element is "reactive", in that it depends
    // on some other signal. A Computed where hasSources is false
    // will always return the same constant.
    // function hasSources(s: Computed | Watcher): boolean;

    class Watcher {
      private signals = new Set<Signal>();

      // When a (recursive) source of Watcher is written to, call this callback,
      // if it hasn't already been called since the last `watch` call.
      // No signals may be read or written during the notify.
      constructor(readonly notify: (this: Watcher) => void) {}

      // Add these signals to the Watcher's set, and set the watcher to run its
      // notify callback next time any signal in the set (or one of its dependencies) changes.
      // Can be called with no arguments just to reset the "notified" state, so that
      // the notify callback will be invoked again.
      watch(...signals: Signal[]): void {
        for (let signal of signals) {
          this.signals.add(signal);
          signal[$WATCHED].call(signal);
        }
        if (this.signals.size > 0) WATCHERS.add(this);
      }

      // Remove these signals from the watched set (e.g., for an effect which is disposed)
      unwatch(...signals: Signal[]): void {
        for (let signal of signals) {
          this.signals.delete(signal);
          signal[$UNWATCHED].call(signal);
        }
        if (this.signals.size === 0) WATCHERS.delete(this);
      }

      // Returns the set of sources in the Watcher's set which are still dirty, or is a computed signal
      // with a source which is dirty or pending and hasn't yet been re-evaluated
      getPending(): Signal[] {
        return Array.from(this.signals);
      }
    }

    // Hooks to observe being watched or no longer watched
    const watched = $WATCHED;
    const unwatched = $UNWATCHED;
  }

  interface SignalOptions<T> {
    // Custom comparison function between old and new value. Default: Object.is.
    // The signal is passed in as the this value for context.
    equals?: (this: Signal<T>, t: T, t2: T) => boolean;

    // Callback called when isWatched becomes true, if it was previously false
    [Signal.subtle.watched]?: (this: Signal<T>) => void;

    // Callback called whenever isWatched becomes false, if it was previously true
    [Signal.subtle.unwatched]?: (this: Signal<T>) => void;
  }
}
