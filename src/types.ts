import type { Draft } from 'immer';

export type Db<T = Record<string, any>> = T;

export type Id = string;
export type EventVector = [Id, ...any[]];
export type EventHandler<T = Record<string, any>> = (coeffects: CoEffects<T>, ...params: any[]) => Effects | void;

export type EffectHandler = (value: any) => void;

export type CoEffectHandler<T = Record<string, any>> = (coeffects: CoEffects<T>, value?: any) => CoEffects<T>;

export type ErrorHandler = (originalError: Error, reflexError: Error & { data: any }) => void;

export type SubVector = [Id, ...any[]];

export type SubHandler = (...values: any[]) => any;
export type SubDepsHandler = (...params: any[]) => SubVector[];

export interface SubConfig {
  equalityCheck?: EqualityCheckFn;
}

export type Effects = [string, any?][];

export interface DispatchLaterEffect {
  ms: number;
  dispatch: EventVector;
}

export interface CoEffects<T = Record<string, any>> {
  event: EventVector;
  draftDb: Draft<Db<T>>;
  [key: string]: any;
}

export interface Context<T = Record<string, any>> {
  coeffects: CoEffects<T>;
  effects: Effects;
  newDb: Db<T>;
  patches: any[];
  queue: Interceptor<T>[];
  stack: Interceptor<T>[];
  originalException: boolean;
}

export interface Interceptor<T = Record<string, any>> {
  id: string;
  before?: (context: Context<T>) => Context<T>;
  after?: (context: Context<T>) => Context<T>;
  comment?: string;
}

export type InterceptorDirection = 'before' | 'after';

export interface Watcher<T> {
  callback: (v: T) => void
  componentName: string
}

export type EqualityCheckFn = (a: any, b: any) => boolean;