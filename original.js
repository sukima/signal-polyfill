/**
 * Proof of Concept for a polyfill to the Signals API Proposal
 *
 * @example
 * ```js
 * import { Signal } from 'singal-polyfill';
 *
 * const counter = Singal.State(0);
 * const renderer = Signal.Computed(() => {
 *   document.getElementById('count').textContent = counter.get();
 * });
 * renderer.watch(counter);
 * document.getElementById('inc').addEventListener('click', () => {
 *   counter.set(counter.get() + 1);
 * });
 * ```
 * @module signal-polyfill
 */

/** @typedef {number} Revision */

/** @type {Revision} */
let CURRENT_REVISION = 0;
/** @type {null | Set<Tag>} */
let currentComputation = null;
/** @type {Symbol} */
const REVISION = Symbol('revision');
/** @type {Symbol} */
const WATCHER_CALLBACK = Symbol('watcher callback');
/** @type {Set<Watcher>} */
const WATCHERS = new Set();

/**
 * @template [T=unknown]
 * @callback ComputableGetter
 * @returns {T}
 */

/**
 * @template [TComputableValue=unknown]
 * @typedef {object} Computable
 * @prop {ComputableGetter<TComputableValue>} get
 */

/**
 * @param {Tag} tag
 * @returns {void}
 */
function dirtyTag(tag) {
  if (currentComputation?.has(tag))
    throw new Error('cannot dirty tag that has been used during a computation');
  tag[REVISION] = ++CURRENT_REVISION;
  notifyWatchers();
}

/**
 * @param {Tag} tag
 * @returns {void}
 */
function consumeTag(tag) {
  if (currentComputation !== null) {
    currentComputation.add(tag);
  }
}

/** @returns {void} */
function notifyWatchers() {
  for (let watcher of WATCHERS) watcher[WATCHER_CALLBACK]();
}

/**
 * @param {Tag[]} tags
 * @returns {Revision}
 */
function getMax(tags) {
  return Math.max(...tags.map((tag) => tag[REVISION]));
}

class Tag {
  /** @type {Revision} */
  [REVISION] = CURRENT_REVISION;
}

/**
 * @template [TStateValue=unknown]
 * @implements {Computable<TStateValue>}
 */
class State {
  /** @type {TStateValue} */
  #value;
  #tag = new Tag();

  /** @param {TStateValue} initialValue */
  constructor(initialValue) {
    this.#value = initialValue;
  }

  /** @returns {TStateValue} */
  get() {
    consumeTag(this.#tag);
    return this.#value;
  }

  /**
   * @param {TStateValue} value
   * @returns {void}
   */
  set(value) {
    this.#value = value;
    dirtyTag(this.#tag);
  }
}

/**
 * @template [TComputedValue=unknown]
 * @callback ComputeCallback
 * @returns {TComputedValue}
 */

/**
 * @template [TComputedValue=unknown]
 * @implements {Computable<TComputedValue>}
 */
class Computed {
  /** @type {ComputeCallback} */
  #compute;
  /** @type {Tag[] | undefined} */
  #lastTags;
  /** @type {Revision | undefined} */
  #lastRevision;
  /** @type {TComputedValue | undefined} */
  #lastValue;

  /** @param {ComputeCallback} */
  constructor(computeCallback) {
    this.#compute = computeCallback;
  }

  /** @returns {TComputedValue} */
  get() {
    if (this.#lastTags && getMax(this.#lastTags) === this.#lastRevision) {
      if (currentComputation && this.#lastTags.length > 0)
        for (let tag of this.#lastTags) currentComputation.add(tag);
      return this.#lastValue;
    }

    let previousComputation = currentComputation;
    currentComputation = new Set();

    try {
      this.#lastValue = this.#compute();
    } finally {
      let tags = Array.from(currentComputation);
      this.#lastTags = tags;
      this.#lastRevision = getMax(tags);

      if (previousComputation && tags.length > 0)
        for (let tag of tags) previousComputation.add(tag);

      currentComputation = previousComputation;
    }

    return this.#lastValue;
  }
}

/**
 * @callback WatcherCallback
 * @this {Watcher}
 * @returns {void}
 */
class Watcher {
  /** @type {Set<Computable>} */
  #signals = new Set();
  /** @type {WatcherCallback} */
  [WATCHER_CALLBACK];

  /** @param {WatcherCallback} callback */
  constructor(callback) {
    this[WATCHER_CALLBACK] = () => callback.call(this);
  }

  /**
   * @param {Computable | undefined} [signal]
   * @returns {void}
   */
  watch(signal) {
    if (signal) this.#signals.add(signal);
    WATCHERS.add(this);
  }

  /**
   * @param {Computable} signal
   * @returns {void}
   */
  unwatch(signal) {
    this.#signals.delete(signal);
    if (this.#signals.size === 0) WATCHERS.delete(this);
  }

  /** @returns {Computable[]} */
  getPending() {
    return Array.from(this.#signals);
  }
}

const subtle = Object.freeze({ Watcher });
export const Signal = Object.freeze({ State, Computed, subtle });
