# Roadmap: AI-Development Must-Haves

Prioritized improvements for [reflex](https://github.com/flexsurfer/reflex) and [reflex-devtools](https://github.com/flexsurfer/reflex-devtools), ordered by impact. Items marked **(pairs with …)** need coordinated changes across both repos.

Context: reflex's architecture (ID-indexed events/subs, pure handlers, effects isolation) already lets an AI agent work on a large app with minimal context — the `*-ids.ts` files act as an index, exact-match grep gives retrieval, and pure handlers bound verification to a single function. The items below close the remaining gaps: React-binding correctness, runtime performance at scale, compiler feedback, a closed observe→act→verify loop against the running app, and token-frugal runtime inspection.

---

## Reflex (lib)

### P0 — Correctness (React binding & memory)

- [x] **Rewrite `useSubscription` on `useSyncExternalStore`.** *(done — hook keyed on serialized subVector; `Reaction.getSnapshot()` with external-store semantics; `watch()` refreshes stale caches on the not-alive→alive transition; react peer dep bumped to >=18)*
  The current `useState` + `useEffect` binding (`src/hook.ts`) has three defects, all fixed by one rewrite keyed on the serialized subVector:
  1. *Parameter changes are ignored* — `useEffect(..., [])` captures the subVector on first mount forever; `useSubscription([SUB_IDS.TODO_BY_ID, props.id])` keeps returning data for the original `id` after the prop changes. Silent stale data; only workaround is `key`-forced remount.
  2. *Missed updates between render and subscribe* — the initial value is read during render but `watch()` happens in the effect, and `watch` neither pushes the current value nor re-checks versions. Events landing in that window leave the component stale until the next change.
  3. *Tearing exposure* under React 18 concurrent rendering.

- [x] **Prune the reaction registry on dispose.** *(done — reactions deregister on dispose; on revival they re-resolve deps through the registry and re-register, so live reactions are always the registered instances the db wake-up path can find. Also covers aborted renders: reactions created during a render that never commits are marked provisional and swept after a self-scheduled grace cycle — the sweep schedules itself from `markProvisionalReaction`, independent of db updates, so idle apps clean up too; sweeping is safe because a late subscriber recreates through `getOrCreateReaction`. Non-JSON-serializable subscription params (at any nesting depth) warn once per sub id in dev, validated before the cache lookup so colliding keys can't dodge the warning.)*

- [x] **Cross-subscription render consistency.** *(done — folded into the P1 flush rework as planned: the db now keeps two references, `appDb` (live, what events read and commit to) and `renderDb` (last flushed generation, what root subscription handlers read). Between an event's commit and the flush, alive caches and newly mounting components all serve the same flushed generation — the mixed-version window is gone by construction, not self-healed. The flush promotes `renderDb = appDb` before marking dirty roots, so recomputes read the new generation. `getSubscriptionValue`/`computeValue` share these semantics; only `getAppDb()` (event handlers, effects) sees the live db.)*
  Between an event's commit and the rAF flush, alive reactions serve pre-event values while a newly mounting component's dormant reaction refreshes against the post-event db — a one-frame mixed-version window that self-heals at flush (pre-existing property, not introduced by the uSES rewrite; the old hook read fresh at mount too). Real fix is a db generation counter serving all snapshots from the last flushed generation — do it together with the flush-scheduling rework (see background-tab item in P1).

- [ ] **Collapse `invalidated` into the version/probe model (known, deferred).**
  After the P1 cache rework, staleness is effectively version/identity-based and the `invalidated` flag survives mostly as the microtask gate plus bridge-writes in `refreshIfStale` (set right before `recomputeIfNeeded` just to pass its gate). It also hides one narrow hazard: if an alive, flush-marked reaction is pulled through `refreshIfStale` (notify=false) before its scheduled microtask runs — e.g. a watcher callback reading a shared sub during the flush — the recompute clears the flag and the later microtask no-ops, swallowing that watcher notification. Fix belongs to the same refactor: staleness pull-only (probe/versions), `markDirty` reduced to schedule+notify, and a `lastNotifiedVersion` so pending notifications survive whoever recomputes first. Touches the raw `Reaction` contract (`isDirty`, stay-dirty-until-watched tests) — do deliberately, not in passing.

### P0 — DX & AI feedback loop

- [x] **Typed event/sub payload maps.** *(done — augmentable `EventPayloads` (id → params tuple), `SubPayloads` (id → `{ params; result }`), `EffectPayloads` (id → payload), and `AppDb` (db shape) interfaces in `src/types.ts`; apps opt in via `declare module '@flexsurfer/reflex'`. Once augmented, `dispatch`/`debounceAndDispatch`/`throttleAndDispatch` accept only declared ids with matching payloads; effect tuples returned from handlers are checked against `EffectPayloads`, with the built-in `dispatch`/`dispatch-later` effects always included, reserved against accidental `EffectPayloads` overrides, and their event vectors checked against `EventPayloads` — closing the indirect-dispatch hole (a partial "check only dispatch effects, leave others loose" design is unsound: the loose union member `[string, any?]` subsumes the strict one, so strict effects require declaring them all); `regEffect` infers the handler value param; `regEvent` infers handler params for declared ids, gets a typed `draftDb` from `AppDb` with no generics (the explicit db generic `regEvent<MyDb>(...)` suppresses param inference — augmenting `AppDb` removes the need for it; inline coeffects annotation also works), and stays permissive for undeclared ids; `useSubscription`/`getSubscriptionValue` check params and infer results; `regSub` checks the computeFn return type; `initAppDb` checks the initial state (via a `NoInfer` guard so the argument doesn't defeat the default) and `getAppDb` returns the augmented shape. Unaugmented maps keep the API exactly as before — verified by the untouched jest suite compiling with type-check on. Compile-time contract locked in by two tsc fixtures: `tests/types/` against src (`npm run test:types`) and `tests/types/dist/` against the built `dist/index.d.ts` resolved as `@flexsurfer/reflex` (`npm run test:types:dist`, runs after build in `prepublishOnly`) — the dist fixture guards that tsup's dts rollup keeps the interfaces declared in the entry module, which is what makes package-name augmentation merge. Docs: llms.txt §12.)*
  The one real architectural weakness vs Redux Toolkit: `dispatch([EVENT_IDS.X, payload])` payloads aren't checked against handler signatures. Let apps declare a payload map and type `dispatch`, `regEvent`, and `useSubscription` against it:

  ```ts
  interface EventPayloads {
    'todos/add': [title: string];
    'todos/toggle': [id: TodoId];
  }
  ```

  Gives humans autocomplete, gives AI compile-error feedback loops (the cheapest verification signal there is), and doubles as a machine-readable API manifest. Must be opt-in — the current untyped API keeps working.

- [x] **Route handler errors into the trace pipeline.** *(done — `interceptor.execute` merges a JSON-serializable `tags.error` into the event's trace on both error paths (with and without a registered error handler), so any custom error handler still gets traced failures; dispatching an unregistered event id now also emits a trace with `tags.error` instead of vanishing; effect handlers that throw are collected into `tags.effectErrors` on the event's trace from `doFxInterceptor`. All entries share one normalized schema (exported as `TraceErrorTag`): `{ phase: 'missing-handler' | 'handler' | 'effect', message, stack?, interceptor?, direction?, effect?, eventV? }` — `tags.error` means the event failed, `tags.effectErrors` means the event committed but effects failed, so devtools P0 (dispatch outcome) can derive the outcome from the tags alone. Queue purges are loudly reported: the router logs which event threw plus the ids of every pending event dropped.)*
  Today `defaultErrorHandler` (`src/events.ts`) logs and rethrows; the trace for a failed event carries no error info. Attach the error (event vector, interceptor id, message, stack) to trace tags so devtools/MCP can surface failures. Without this, nothing downstream can report why an event didn't do what was expected. Related: an event exception currently purges the entire pending queue (`src/router.ts`) — at minimum this should be loudly reported.

### P1 — Performance at scale

- [x] **Make patch generation conditional; use a shallow top-level diff for root wake-up.** *(done — events run plain `produce` unless tracing is enabled; `produceWithPatches` only feeds the trace pipeline (patches/reversePatches land exclusively in trace tags, and `context.patches` is populated only while tracing — custom `after` interceptors can no longer rely on it in prod). The wake-up path reads no patches at all: `updateAppDb(newDb)` just commits and schedules one flush; at flush time `db.ts` shallow-diffs the previous flushed generation against the live db over the union of top-level keys and marks the changed keys' root reactions dirty. Bonus: consecutive events between two flushes now coalesce into a single diff/recompute pass instead of one queue entry per event. autoFreeze stays on, preserving the out-of-event mutation guard the ref diff depends on.)*
  `enablePatches()` runs at module load and every event uses `produceWithPatches` (`src/events.ts`) — patch generation and auto-freeze run in production with tracing off. Patches are only needed by devtools; the root-key wake-up (`src/db.ts`) can be a near-free shallow ref diff of top-level keys (`old[k] !== new[k]`). Use plain `produce` when tracing is disabled.
  *Why the ref diff is sound:* handlers mutate the Immer **draft**, never `appDb` — `produce` returns a structurally-shared new tree with fresh object references along every changed path (copy-on-write), while untouched keys keep their old references. So `old[k] !== new[k]` is exactly "the subtree under `k` changed" — the same guarantee react-redux selectors build on. It holds as long as all writes go through events; note this interacts with any future decision to disable `autoFreeze` in prod, since autoFreeze is what catches out-of-event mutations that neither refs nor patches would see.

- [x] **Fix mount recompute cascades.** *(done — `ensureDirty` is gone; `computeValue` validates through `refreshIfStale`, the same freshness check `getSnapshot` uses, so mounting subscribers reuse clean cached parents instead of re-dirtying the ancestor chain. Root reactions bump their version only when the slice identity actually changed (`Object.is` on the fresh read), so nothing cascades when a root is merely probed. Refresh passes carry an id and each reaction validates once per pass, so diamond graphs don't re-probe shared roots per path. Semantics change for raw `Reaction` users: mutating a dep's value in place and calling `markDirty` no longer forces dependent recomputes — roots gate on identity, which is exactly the db contract (immer always produces fresh refs for changed slices). Regression test: mounting 50 by-id row subs over a shared sorted list runs the sort exactly once, and a data change re-sorts once per flush regardless of subscriber count.)*
  Every `computeValue` calls `ensureDirty`, re-dirtying the whole ancestor chain, and root reactions report `changed = true` unconditionally with a version bump (`src/reaction.ts`). Result: each newly mounting subscriber re-runs shared parent subs — mounting 100 rows with by-id subs over a sorted list costs ~100 sorts + 100 deep-equals of the list. By-id row subs are the *recommended* pattern, so this is a hot path. Roots should only bump versions when their slice actually changed; mounts should reuse clean cached values.

- [x] **Revisit the default equality check.** *(resolved: default stays `fast-deep-equal`, cost documented, `shallowEqual` exported. Flipping the default to shallow/`Object.is` would be a regression, not a win: computed subs typically return fresh structures (`map`/`filter`/`sort`), which a shallow default would report as "changed" on every recompute — cascading re-renders that cost far more than the deep compare they save. Deep-equal is also no longer hot after the two items above: it only runs when a dependency version actually bumped, and root versions only bump on real slice changes, so the O(result) compare happens roughly once per genuinely-changed flush rather than per mount per touched key. For large derived collections the escape hatches are `regSub(id, fn, deps, { equalityCheck: shallowEqual })` — sound because immer's structural sharing keeps unchanged elements identical — or `setGlobalEqualityCheck(shallowEqual)`. Documented in llms.txt §5 and docs/p1-runtime-cache-model.md.)*
  Every computed sub gates with `fast-deep-equal` by default (`src/reaction.ts`, `src/settings.ts`) — O(result size) per node per touched root key. This is the part of re-frame that doesn't port: CLJS persistent-structure equality is cheap, JS deep-equal is not. Consider a cheaper default (shallow / `Object.is`) with opt-in deep, or at minimum document the cost prominently and recommend per-sub `equalityCheck` config for large derived collections.

- [x] **Add `dispatchSync`.** *(done — `dispatchSync(event)` handles the event immediately (bypassing the queue) and then flushes subscriptions synchronously: the flush promotes the render generation and recomputes + notifies the affected alive subgraphs before returning, which is what controlled inputs actually need — commit and watcher notification inside the `onChange` task, not at the next rAF. Guards: throws if called while an event is being handled (including from effect handlers, which run inside the event's interceptor chain) with a pointer to the `['dispatch', ...]` effect; handler errors propagate synchronously to the caller after the registered error handler runs, unlike queued dispatch. A pending rAF flush that fires afterwards finds `renderDb === appDb` and no-ops. Typed via `DispatchVector` exactly like `dispatch`, covered in both tsc fixtures.)*
  Dispatch is always async (next-tick queue), so controlled inputs bound to db state are structurally impossible — the "keep input drafts in local `useState`" best practice is actually a hard constraint. re-frame ships `dispatch-sync` for exactly this (a reflex test even references it, but it doesn't exist in the API).

- [x] **Background-tab flush fallback + flush-scheduling rework.** *(done — `scheduleAfterRender` now races rAF against a 100ms timeout fallback (each cancels the other; a run-once guard covers the pathological both-fired interleave), and skips straight to a 16ms timeout when `document.hidden` — hidden tabs flush with bounded delay instead of stalling until visible, and the same fallback covers backgrounded React Native. The flush-scheduling rework landed with it: the per-event `reactionsQueue` in db.ts is gone, replaced by a single scheduled flush that shallow-diffs the flushed generation against the live db (P1 item 1) and promotes the render generation before waking roots (P0 consistency note). The rework also gave dispatchSync its synchronous flush entry point, `flushSubscriptions(sync)`.)*
  Subscription flushes go through `requestAnimationFrame` (`src/schedule.ts`), which doesn't fire in hidden tabs — db state keeps updating but subscriptions stall until the tab is visible. Add a visibility-aware fallback (e.g. `setTimeout` when `document.hidden`). Fold in the cross-subscription render-consistency fix (db generation counter — see P0 correctness note): both are properties of the same rAF-deferred flush design.

### P1 — Dev-mode strictness & navigation

- [x] **Warn on `dispatch` called from inside an event handler (dev).** *(done — the handler's execution window is tracked separately from the full interceptor chain (`getRunningHandlerEventId` vs `getHandlingEventId`), so the built-in `'dispatch'` effect — which calls `dispatch()` while the chain is still executing — stays warning-free while a direct `dispatch()` from the pure handler logs a dev warning naming both events and pointing to the `['dispatch', ...]` effect. Warn, not throw: unlike `dispatchSync` reentrancy (which would corrupt the in-flight commit and throws), a queued dispatch from a handler is behavior-preserving — it's a purity violation, not a runtime hazard. Zero prod cost beyond one `IS_DEV` check.)*

- [ ] **Capture registration source location in dev mode.** *(pairs with devtools P2: handler locations)*
  At `regEvent`/`regSub`/`regEffect` time, capture file:line (synthetic `Error().stack`, dev-only, zero prod cost) and store it in the registrar. This is the last hop from runtime observation back to source code.

- [ ] **Fail loud on unregistered IDs in dev.**
  Dispatching a typo'd event or subscribing to a missing sub currently `console.error`s and continues. In dev mode, throw — and include a nearest-match suggestion ("did you mean `todos/add`?"). String IDs are only safe if mistakes surface immediately; this matters double for AI-generated code.

### P2

- [ ] **Static manifest generator.**
  A small CLI (`npx reflex-map`) that scans `regEvent`/`regSub`/`regEffect` calls and emits `APP_MAP.md`: id → file:line → params → effects emitted → sub dependency graph. Zero-drift documentation and the ideal first read for any agent session. If typed payload maps land, it can read signatures from the type map too.

- [ ] **Fix the `regEvent` overload heuristic.**
  `isCofxArray` (`src/events.ts`) distinguishes cofx from interceptors by inspecting `arr[0]`; an empty array is silently ambiguous and does nothing. A quiet failure mode worth eliminating.

- [ ] **Document positioning and constraints.**
  State openly in the README: client-rendered SPAs and React Native are the target; module-level singletons mean no SSR/RSC (cross-request leakage in Node), no multi-store; events are processed async; heavy reads over Immer drafts pay proxy overhead (use `current()` first). Zustand/Redux users will otherwise assume parity.

---

## Reflex DevTools + MCP (tools)

### P0

- [ ] **Make `dispatch_event` return its outcome.** *(pairs with lib P0: error tracing)*
  Currently `POST /api/dispatch` reports success before the handler runs — a typo'd event ID or a throwing handler both come back as "dispatched successfully." Have the client SDK report the resulting trace back over the WebSocket, and return patches + emitted effects (or the error) in the MCP tool response. This single change converts the MCP from "can poke the app" into a true REPL: action in, observed state-diff out, one round trip.

- [ ] **Two-tier trace access.**
  `get_traces` returns full tags — `patches`, `reversePatches`, and `effects` per event — up to 50 traces at a time: a context bomb on any real app. Make the list call return compact rows (id, operation, opType, duration, event args) and add a `get_trace(id)` detail tool. Drop `reversePatches` from MCP output entirely — agents never time-travel.

### P1

- [ ] **`find_state_changes(path)` tool.**
  The server already stores Immer patches per trace (`server/storage.ts`); index them by path and answer "which events wrote `todos.3.done`, in order?" server-side, returning `[{event, timestamp, patch}]`. This is *the* debugging question — answering it in one cheap call instead of having an agent scan fat traces is the biggest context-efficiency win available in the stack.

- [ ] **`sinceId` cursor on `get_traces`.**
  The dispatch→verify loop needs "everything that happened after my action." Limit-from-the-end is ambiguous under concurrent activity. Cheap to add; also the fallback verify mechanism until dispatch-returns-outcome ships.

### P2

- [ ] **Shape mode for `get_app_state`.**
  Add `depth` or `shape: true` returning keys + types + collection sizes — the runtime equivalent of reading `db.ts`, and the right first call on an unfamiliar large app. The current full dump is unusable there.

- [ ] **Source locations in `get_handlers`.** *(depends on lib P1: source capture)*
  Return file:line per handler id, so the agent goes from runtime observation to the exact source line with zero greps.

- [ ] **Security caveat in the README.**
  `/api/dispatch` mutates app state with no auth while `--host 0.0.0.0` is a documented option. One line: dev only, never expose beyond localhost/trusted networks.

---

## Feature parity: what to adopt from Redux (RTK) and Zustand

Legend: ✅ has it · ⚠️ partial / community · ❌ missing.

| Feature | Redux Toolkit | Zustand | Reflex today | Adopt? |
|---|---|---|---|---|
| Concurrent-safe React binding (`useSyncExternalStore`) | ✅ react-redux v8+ | ✅ built on it | ✅ `useSyncExternalStore` | **Done** — stale params, missed render→subscribe updates, and per-sub tearing fixed; cross-sub render consistency done too (subscriptions read the last flushed db generation) |
| Typed action/event payloads | ✅ `PayloadAction<T>` | ✅ typed store API | ✅ opt-in `EventPayloads`/`SubPayloads` maps | **Done** — typed dispatch/regEvent/useSubscription via module augmentation |
| Sync dispatch escape hatch | ✅ dispatch is sync | ✅ `set` is sync | ✅ `dispatchSync` (sync commit + sync subscription flush) | **Done** — re-frame parity; unblocks controlled inputs |
| Undo / time-travel | ✅ DevTools time-travel | ⚠️ community (zundo) | ⚠️ patches + reversePatches already captured, unused | **P1** — built-in undo/redo effect is nearly free and a headline feature |
| Persistence + versioned migrations | ✅ redux-persist | ✅ `persist` middleware | ❌ hand-rolled storage effects | **P1** — official persist effect/interceptor with version migrations |
| Dev-mode invariant checks | ✅ serializability/immutability middleware, typo errors | ⚠️ | ⚠️ console warnings only, non-fatal | **P1** — fail-loud dev mode |
| Async data fetching & caching | ✅ RTK Query (dedup, invalidation, cache) | ❌ pair with TanStack Query | ❌ hand-rolled effects | **P1** standard `http` effect (retry/dedup); document TanStack Query pairing — a full RTK-Query-alike is not worth building yet |
| Per-call-site selector equality | ✅ `useSelector(sel, equalityFn)` | ✅ `shallow` / custom | ⚠️ per-sub config only (`shallowEqual` now exported) | **P2** — options arg on `useSubscription` |
| Non-React (vanilla) subscriptions | ✅ `store.subscribe` | ✅ vanilla store | ⚠️ `Reaction.watch` internal only | **P2** — export a public `watchSubscription` for non-React consumers (services, headless logic) |
| Entity/normalization helpers | ✅ `createEntityAdapter` | ❌ | ❌ | **P2** — small helper package for id-keyed CRUD in `draftDb` |
| SSR / per-request stores | ✅ | ✅ | ❌ module-level singletons | **Decide** — either explicit non-goal (SPA/RN focus, document it) or a long-term instance-scoped rework |
| Code-split / lazy registration | ✅ `injectSlice` | ⚠️ manual | ✅ side-effect imports are naturally lazy | — already good |

Worth remembering the reverse direction too: the semantic event log, memoized subscription dependency graph, effects/coeffects isolation, first-class tracing, and the devtools MCP have no equivalent in either library — that's the moat these adoptions protect.

---

## If you only do four things

1. **`useSyncExternalStore` hook rewrite** (lib P0) — three correctness bugs, one fix; everything else assumes the binding can be trusted.
2. **`dispatch_event` returns outcome** (tools P0 + lib error tracing) — completes the agent loop.
3. **Typed payload maps** (lib P0) — closes the gap vs Redux Toolkit and adds the compiler to the agent's feedback loop.
4. **Two-tier traces** (tools P0) — makes runtime inspection affordable in tokens on a real-sized app.

Together these make the pitch airtight: indexed architecture (already there), a trustworthy React binding, compiler-checked wiring, and a runtime the agent can query and act on for less context than reading a single Redux slice.
