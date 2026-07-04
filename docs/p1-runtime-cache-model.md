# P1 Runtime Cache Model

This note documents the risky part of P1: replacing the old
`computeValue() -> ensureDirty() -> recomputeIfNeeded()` safety net with a
version/identity based freshness check.

The change is primarily about mount-time performance. The old model was
conservative, but every read could dirty the whole ancestor chain and make
shared parent subscriptions recompute for each newly mounting child. The new
model makes reads validate the cache instead of invalidating it.

## Terms

- `appDb`: the live db generation. Event handlers read it and commit to it.
- `renderDb`: the last flushed db generation. Root subscriptions read it.
- Root reaction: a subscription with no deps, normally one top-level db key.
- Computed reaction: a subscription whose value is derived from dependency
  reactions.
- `hasValue`: whether the reaction has computed at least once. This is
  separate from `value`, because `undefined` is a valid subscription result.
- `version`: monotonic counter on a reaction, bumped only when its cached value
  actually changes.
- `invalidated`: "this node must be checked before it can notify or satisfy a
  dependency read". The public `isDirty` getter is kept as a compatibility
  alias for this internal state.

## Old Read Model

The old `computeValue()` treated every read as suspicious and recursively
marked the whole dependency chain dirty.

```mermaid
flowchart TD
  A["getSubscriptionValue / computeValue"] --> B["ensureDirty()"]
  B --> C["mark this reaction dirty"]
  B --> D["recursively mark deps dirty"]
  C --> E["recomputeIfNeeded(false)"]
  D --> E
  E --> F{"is root?"}
  F -->|yes| G["read source"]
  G --> H["changed = true"]
  H --> I["version++ even when identity is unchanged"]
  F -->|no| J["read deps"]
  J --> K["recompute if dep versions changed"]
```

### Consequence

Mounting many child subscriptions over one shared parent could re-run the
parent once per child.

```mermaid
flowchart LR
  R["root: items"] --> S["computed: sorted items"]
  S --> A["row by id: 1"]
  S --> B["row by id: 2"]
  S --> C["row by id: ..."]
  S --> D["row by id: 50"]

  A -. "mount read dirties S and R" .-> S
  B -. "mount read dirties S and R again" .-> S
  C -. "..." .-> S
  D -. "mount read dirties S and R again" .-> S
```

That was safe, but it turned the recommended "by-id row subscription over a
shared derived list" pattern into repeated sorts and repeated equality checks.

## New Read Model

`computeValue()` now calls `refreshIfStale()`. The read path validates cache
freshness instead of forcing invalidation.

```mermaid
flowchart TD
  A["getSubscriptionValue / computeValue"] --> B["refreshIfStale(pass)"]
  B --> C{"root reaction?"}

  C -->|yes| D["read source"]
  D --> E{"Object.is(source, cached)?"}
  E -->|yes| F["return cached value"]
  E -->|no| G["invalidated = true"]
  G --> H["recompute root"]
  H --> I["version++ only if identity changed"]

  C -->|no| J["refresh deps with same pass id"]
  J --> K["read dep versions"]
  K --> L{"invalidated, no cached value, or dep versions changed?"}
  L -->|no| F
  L -->|yes| M["recompute computed value"]
  M --> N{"equalityCheck(new, cached)"}
  N -->|equal| O["keep cached value and version"]
  N -->|different| P["cache new value; version++"]
```

The `pass` id prevents shared dependencies in a diamond graph from being
validated once per path during a freshness walk.

```mermaid
flowchart TD
  Root["root"] --> Left["left computed"]
  Root --> Right["right computed"]
  Left --> Top["top computed"]
  Right --> Top

  Top -. "refresh pass #12" .-> Left
  Top -. "same refresh pass #12" .-> Right
  Left -. "validates root once" .-> Root
  Right -. "root already validated in pass #12" .-> Root
```

## Flush Model

Events still dirty the graph from the root downward. The difference is that
the root wake-up no longer depends on Immer patches. The db flush shallow-diffs
the previous render generation against the live generation.

```mermaid
sequenceDiagram
  participant Event as event handler
  participant AppDb as appDb
  participant RenderDb as renderDb
  participant Flush as flushSubscriptions
  participant Root as root reaction
  participant Child as computed/watchers

  Event->>AppDb: produce new immutable generation
  Event->>Flush: schedule one flush
  Note over RenderDb,AppDb: subscriptions still read renderDb until flush
  Flush->>RenderDb: promote renderDb = appDb
  Flush->>Flush: shallow diff old renderDb vs appDb
  Flush->>Root: markDirty changed top-level roots
  Root->>Child: propagate dirty through alive graph
  Child->>Child: recompute if dep versions changed
  Child->>Child: notify watchers only if value changed
```

## Safety Contract

The new model is safe under a stricter, explicit contract:

1. `undefined` is a legitimate cached subscription value; `hasValue` tracks
   whether the cache exists.
2. Db writes go through event handlers and Immer drafts.
3. Changed top-level db keys get new object identities from Immer structural
   sharing.
4. Root reaction versions only bump when root value identity changes.
5. Computed reactions trust dependency versions.
6. Equality checks gate propagation after a dependency version bump.
7. Mutable external roots are not a supported invalidation mechanism. If a raw
   `Reaction` returns the same object reference after in-place mutation,
   `markDirty()` does not force dependents to recompute.

The last point is the main semantic change compared with the old safety net.
It is correct for Reflex db subscriptions, because db roots are immutable
snapshots, but it is not the same behavior for arbitrary mutable `Reaction`
usage.

## Regression Coverage

The cache contract is covered by these focused tests:

| Contract | Test |
|---|---|
| Dormant cached subscription refreshes after the db flush | `reaction-cache-contract.test.ts` |
| Before flush, subscriptions still serve the last flushed generation | `reaction-cache-contract.test.ts` and `db-flush.test.ts` |
| Alive child updates through an unwatched shared parent | `reaction-cache-contract.test.ts` |
| Disposed/revived reactions re-resolve dependencies and refresh stale values | `reaction-cache-contract.test.ts` |
| Diamond graph stays correct after a shared root identity change | `reaction-cache-contract.test.ts` |
| Deep equality stops downstream propagation after equal recompute | `reaction-cache-contract.test.ts` |
| `undefined` computed results are cached and can notify on real changes | `reaction-cache-contract.test.ts` |
| Mutable same-reference root mutation is not treated as a change | `reaction-cache-contract.test.ts` |
| Mounting many by-id subscribers computes the shared parent once | `mount-cascade.test.ts` |

## Simplification Options

If this still feels too much for the library's risk budget, the parts can be
separated:

1. Keep conditional patch generation and shallow top-level diff. These are
   performance wins with little public semantic weight.
2. Keep the mount cascade fix, but keep the raw `Reaction` mutable-root semantic
   by adding a root config flag. Db roots could use identity gating; generic
   roots could keep "dirty means changed".
3. Defer `renderDb` if cross-subscription generation consistency is not worth
   the extra mental model right now.
4. Defer `dispatchSync` if the public API timing surface feels too broad for
   the same release.
