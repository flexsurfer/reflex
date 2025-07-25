import isEqual from 'fast-deep-equal'
import { consoleLog } from './loggers'
import type { Id, SubVector } from './types'
import { withTrace, mergeTrace } from './trace'

export class Reaction<T> {
  private id: Id = ''
  private computeFn: (...depValues: any[]) => T
  private deps: Reaction<any>[] | undefined
  private dependents = new Set<Reaction<any>>()
  private watchers: Array<(v: T) => void> = []
  private dirty = false
  private scheduled = false
  private value: T | undefined = undefined
  private version = 0
  private depsVersions: number[] = []
  private subVector: SubVector | undefined
  private componentName: string | undefined

  constructor(computeFn: (...depValues: any[]) => T, deps?: Reaction<any>[]) {
    this.computeFn = computeFn
    this.deps = deps
  }

  static create<R>(fn: (...values: any[]) => R, deps?: Reaction<any>[]): Reaction<R> {
    return new Reaction(fn, deps)
  }

  getValue(): T {
    this.ensureDirty()
    this.recomputeIfNeeded(false)
    return this.value as T
  }

  getDepValue(notifyWatchers: boolean = true): [T, number] {
    this.recomputeIfNeeded(notifyWatchers)
    return [this.value as T, this.version]
  }

  watch(callback: (val: T) => void) {
    const idx = this.watchers.indexOf(callback)
    if (idx === -1) {
      this.watchers.push(callback)
      if (this.deps) {
        for (const d of this.deps) d.ensureAliveWith(this)
      }
    }
  }

  unwatch(fn: (v: T) => void) {
    const idx = this.watchers.indexOf(fn)
    if (idx !== -1) {
      this.watchers.splice(idx, 1)
      if (this.watchers.length === 0) {
        this.disposeIfUnused()
      }
    }
  }

  markDirty() {
    this.dirty = true
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
    if (!this.dirty) return

    try {
      let changed = false;

      withTrace({ operation: this.subVector?.[0] ?? '', opType: 'sub/run', tags: { queryV: this.subVector, reaction: this.id }, },
        () => {
          if (this.isRoot) {
            changed = true
            this.value = this.computeFn()
          }
          else {
            const depValues = this.deps?.map(d => d.getDepValue(notifyWatchers)) ?? []
            // Extract values and versions
            const values = depValues.map(([value]) => value)
            const currentVersions = depValues.map(([, version]) => version)

            // Check if dependency versions have changed
            const versionsChanged = !isEqual(currentVersions, this.depsVersions)

            if (this.value === undefined || versionsChanged) {
              let newVal = this.computeFn(...values)
              changed = !isEqual(newVal, this.value)
              if (changed) {
                this.value = newVal
              }
              this.depsVersions = currentVersions
            }
          }
          mergeTrace({ tags: { 'cached?': !changed, 'version': this.version } });
        }
      );

      this.dirty = false

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
                operation: this.componentName ?? 'component',
                tags: this.componentName ? { componentName: this.componentName } : {},
              },
              () => {
                w(this.value as T)
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

  private ensureDirty() {
    this.dirty = true
    if (this.deps) {
      for (const d of this.deps) d.ensureDirty()
    }
  }

  private ensureAliveWith(child: Reaction<any>) {
    if (this.value === undefined) {
      this.dirty = true
    }
    this.dependents.add(child)
    if (this.deps) {
      for (const d of this.deps) d.ensureAliveWith(this)
    }
  }

  private disposeIfUnused() {
    if (this.isAlive) return

    this.value = undefined
    this.version = 0
    this.depsVersions = []
    this.dirty = false
    this.scheduled = false

    withTrace(
      {
        operation: this.subVector?.[0] ?? '',
        opType: 'sub/dispose',
        tags: {
          subVector: this.subVector,
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
  }

  setId(id: Id) {
    this.id = id
  }

  getId(): Id {
    return this.id
  }

  getSubVector(): SubVector | undefined {
    return this.subVector
  }

  setSubVector(subVector: SubVector) {
    this.subVector = subVector
  }

  private get isAlive(): boolean {
    return this.hasWatchers || this.hasDependents
  }

  private get hasWatchers(): boolean {
    return this.watchers.length > 0
  }

  private get hasDependents(): boolean {
    return this.dependents.size > 0
  }

  get isDirty(): boolean {
    return this.dirty
  }

  get isRoot(): boolean {
    return this.deps === undefined || this.deps.length === 0
  }

  setComponentName(componentName: string) {
    this.componentName = componentName
  }
}

