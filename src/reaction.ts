import isEqual from 'fast-deep-equal'
import { consoleLog } from './loggers'
import type { Id, SubVector, Watcher, EqualityCheckFn } from './types'
import { withTrace, mergeTrace } from './trace'

// Monotonic id per refreshIfStale entry point. Shared dependencies in diamond
// graphs are validated once per pass instead of once per path.
let refreshPassCounter = 0

export class Reaction<T> {
  private id: Id = ''
  private computeFn: (...depValues: any[]) => T
  private deps: Reaction<any>[] | undefined
  private dependents = new Set<Reaction<any>>()
  private watchers: Array<Watcher<T>> = []
  private invalidated = false
  private scheduled = false
  private value: T | undefined = undefined
  private hasValue = false
  private version = 0
  private depsVersions: number[] = []
  private subVector: SubVector | undefined
  private equalityCheck: EqualityCheckFn
  private lastRefreshPass = 0
  private onDispose?: () => void
  private onRevive?: () => void
  private resolveDeps?: () => Reaction<any>[]

  constructor(computeFn: (...depValues: any[]) => T, deps?: Reaction<any>[], equalityCheck?: EqualityCheckFn) {
    this.computeFn = computeFn
    this.deps = deps
    this.equalityCheck = equalityCheck || isEqual
  }

  static create<R>(fn: (...values: any[]) => R, deps?: Reaction<any>[], equalityCheck?: EqualityCheckFn): Reaction<R> {
    return new Reaction(fn, deps, equalityCheck)
  }

  computeValue(): T {
    this.refreshIfStale()
    return this.value as T
  }

  getValue(): T {
    return this.value as T
  }

  getDepValue(notifyWatchers: boolean = true): [T, number] {
    this.recomputeIfNeeded(notifyWatchers)
    return [this.value as T, this.version]
  }

  /**
   * Read the current value with external-store snapshot semantics:
   * while the reaction is alive its cached value only advances together
   * with watcher notifications (required by useSyncExternalStore to avoid
   * tearing); while not alive markDirty propagation doesn't reach it, so
   * validate freshness against the dependency chain before returning.
   */
  getSnapshot(): T {
    if (!this.isAlive || !this.hasValue) {
      this.refreshIfStale()
    }
    return this.value as T
  }

  /**
   * Bring the cached value up to date only if something underneath actually
   * changed, without recomputing a chain that is already fresh. Roots verify
   * with a cheap identity check against their source; computed reactions
   * compare dependency versions. Each entry starts a refresh pass, so shared
   * dependencies reached through several paths validate only once.
   */
  refreshIfStale(pass: number = ++refreshPassCounter): void {
    if (this.lastRefreshPass === pass) {
      return
    }
    this.lastRefreshPass = pass

    if (this.isRoot) {
      if (!this.invalidated && this.hasValue && Object.is(this.computeFn(), this.value)) {
        return
      }
      this.invalidated = true
      this.recomputeIfNeeded(false)
      return
    }

    if (this.deps) {
      for (const d of this.deps) d.refreshIfStale(pass)
    }
    const currentVersions = this.deps?.map(d => d.getVersion()) ?? []
    if (this.invalidated || !this.hasValue || !isEqual(currentVersions, this.depsVersions)) {
      this.invalidated = true
      this.recomputeIfNeeded(false)
    }
  }

  watch(callback: (val: T) => void, componentName: string = "react component") {
    const idx = this.watchers.findIndex(w => w.callback === callback)
    if (idx === -1) {
      const wasAlive = this.isAlive
      this.watchers.push({ callback, componentName })
      if (!wasAlive) {
        this.goLive()
      }
      if (this.deps) {
        for (const d of this.deps) d.ensureAliveWith(this)
      }
      if (!wasAlive && this.hasValue) {
        // The reaction was not receiving markDirty propagation until now, so
        // its cached value may predate events dispatched since it was last
        // read (e.g. between a component's render and its subscription).
        // Refresh so the post-subscribe snapshot check sees current data.
        // Never-computed reactions stay lazy: the first read computes anyway.
        this.refreshIfStale()
      }
    }
  }

  /**
   * Called on the not-alive -> alive transition. Dependencies cached from
   * creation time may have been disposed and replaced in the registry while
   * this reaction was dormant; re-resolve them so live reactions always link
   * to the registered instances (the only ones the db wake-up path can find),
   * and re-register this reaction itself.
   */
  private goLive() {
    if (this.resolveDeps && !this.isRoot) {
      const newDeps = this.resolveDeps()
      const changed = !this.deps
        || newDeps.length !== this.deps.length
        || newDeps.some((d, i) => d !== this.deps![i])
      if (changed) {
        this.deps = newDeps
        // Fresh dep instances restart version counters; invalidate recorded
        // versions so the next refresh recomputes instead of trusting a
        // coincidental version match against different objects.
        this.depsVersions = []
      }
    }
    this.onRevive?.()
  }

  unwatch(fn: (v: T) => void) {
    const idx = this.watchers.findIndex(w => w.callback === fn)
    if (idx !== -1) {
      this.watchers.splice(idx, 1)
      if (this.watchers.length === 0) {
        this.disposeIfUnused()
      }
    }
  }

  markDirty() {
    this.invalidated = true
    for (const c of this.dependents) c.markDirty()
    if (!this.isAlive) { return }
    this.scheduleRecompute()
  }

  private scheduleRecompute() {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.recomputeIfNeeded()
    })
  }

  private recomputeIfNeeded(notifyWatchers: boolean = true) {
    if (!this.invalidated) return

    try {
      let changed = false;

      withTrace({ operation: this.subVector?.[0] ?? '', opType: 'sub/run', tags: { queryV: this.subVector, reaction: this.id, deps: this.deps?.map(d => d.getId()) ?? [] }, },
        () => {
          if (this.isRoot) {
            // Roots read their source by identity (a top-level db key), so a
            // reference check is exact: only bump the version — and cascade
            // recomputes into dependents — when the slice actually changed.
            const newVal = this.computeFn()
            changed = !this.hasValue || !Object.is(newVal, this.value)
            if (changed) {
              this.value = newVal
            }
            this.hasValue = true
          }
          else {
            const depValues = this.deps?.map(d => d.getDepValue(notifyWatchers)) ?? []
            // Extract values and versions
            const values = depValues.map(([value]) => value)
            const currentVersions = depValues.map(([, version]) => version)

            // Check if dependency versions have changed
            const versionsChanged = !isEqual(currentVersions, this.depsVersions)

            if (!this.hasValue || versionsChanged) {
              let newVal = this.computeFn(...values)
              changed = !this.hasValue || !this.equalityCheck(newVal, this.value)
              if (changed) {
                this.value = newVal
              }
              this.hasValue = true
              this.depsVersions = currentVersions
            }
          }
          mergeTrace({ tags: { 'cached?': !changed, 'version': this.version } });
        }
      );

      this.invalidated = false

      // Increment version if value changed
      if (changed) {
        this.version++
      }
      
      if (notifyWatchers && changed && this.watchers.length > 0) {
        for (const w of this.watchers) {
          try {
            withTrace(
              {
                opType: 'render',
                operation: w.componentName,
                tags: { reaction: this.id}
              },
              () => {
                w.callback(this.value as T)
              }
            );
          } catch (error) {
            consoleLog('error', '[reflex] Error in reaction watcher:', error)
          }
        }
      }
    } catch (error) {
      consoleLog('error', `[reflex] Error in reaction computation ${this.id}:`, error)
      throw error
    }
  }

  /**
   * Synchronously recompute this reaction and its alive dependents, notifying
   * watchers along the way. Used by the dispatchSync flush path; the microtask
   * recomputes that markDirty scheduled become no-ops afterwards. Order is
   * irrelevant: recomputes pull their dependencies, and revisits through
   * diamond graphs are no-ops once clean.
   */
  recomputeTreeSync(): void {
    if (!this.isAlive) {
      return
    }
    this.recomputeIfNeeded(true)
    for (const d of this.dependents) d.recomputeTreeSync()
  }

  private ensureAliveWith(child: Reaction<any>) {
    const wasAlive = this.isAlive
    if (!this.hasValue) {
      this.invalidated = true
    }
    this.dependents.add(child)
    if (!wasAlive) {
      this.goLive()
    }
    if (this.deps) {
      for (const d of this.deps) d.ensureAliveWith(this)
    }
  }

  private disposeIfUnused() {
    if (this.isAlive) return
    
    this.depsVersions = []
    this.invalidated = false
    this.scheduled = false

    withTrace(
      {
        operation: this.subVector?.[0] ?? '',
        opType: 'sub/dispose',
        tags: {
          queryV: this.subVector,
          reaction: this.id,
        },
      },
      () => {
        if (this.deps) {
          for (const d of this.deps) {
            d.dependents.delete(this)
            d.disposeIfUnused()
          }
        }
      }
    );

    this.onDispose?.()
  }

  setOnDispose(callback: () => void) {
    this.onDispose = callback
  }

  setOnRevive(callback: () => void) {
    this.onRevive = callback
  }

  setDepsResolver(resolver: () => Reaction<any>[]) {
    this.resolveDeps = resolver
  }

  setId(id: Id) {
    this.id = id
  }

  getId(): Id {
    return this.id
  }
  
  getVersion(): number {
    return this.version
  }

  getSubVector(): SubVector | undefined {
    return this.subVector
  }

  setSubVector(subVector: SubVector) {
    this.subVector = subVector
  }

  get hasWatchers(): boolean {
    return this.watchers.length > 0
  }

  get hasDependents(): boolean {
    return this.dependents.size > 0
  }

  get isAlive(): boolean {
    return this.hasWatchers || this.hasDependents
  }

  get isDirty(): boolean {
    return this.invalidated
  }

  get isInvalidated(): boolean {
    return this.invalidated
  }

  get isRoot(): boolean {
    return this.deps === undefined || this.deps.length === 0
  }
}
