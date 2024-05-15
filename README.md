# Signal Polyfill

## ⚠️  This polyfill is a preview of an in-progress proposal and could change at any time. Do not use this in production. ⚠️

This is a rewrite of the [original polyfill](https://github.com/proposal-signals/signal-polyfill) which uses a monotonic counter under the hood to track dirty revisions and uses auto-tracking of consumptions during computation to memoize the state values.

It implements the following APIs:

* `Signal.State`
* `Signal.Computed`
* `Signal.subtle.Watcher`
