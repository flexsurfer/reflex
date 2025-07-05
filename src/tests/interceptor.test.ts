import {
    isInterceptor,
    execute
} from '../interceptor';
import { registerHandler, clearHandlers } from '../registrar';
import type { Interceptor, Context, EventVector } from '../types';

// Helper function to create a minimal context for testing
function createTestContext(overrides: Partial<Context> = {}): Context {
    return {
        coeffects: {
            event: ['test-event'],
            draftDb: {}
        },
        effects: [],
        newDb: {},
        patches: [],
        queue: [],
        stack: [],
        originalException: false,
        ...overrides
    };
}

// Helper function to create a test interceptor
function createTestInterceptor(
    id: string,
    options: {
        before?: (context: Context) => Context;
        after?: (context: Context) => Context;
        comment?: string;
    } = {}
): Interceptor {
    return {
        id,
        ...options
    };
}

describe('interceptor', () => {

    describe('isInterceptor', () => {
        it('should return false for null or undefined', () => {
            expect(isInterceptor(null)).toBe(false);
            expect(isInterceptor(undefined)).toBe(false);
        });

        it('should return false for non-objects', () => {
            expect(isInterceptor('string')).toBe(false);
            expect(isInterceptor(123)).toBe(false);
            expect(isInterceptor(true)).toBe(false);
            expect(isInterceptor([])).toBe(false);
        });

        it('should return false for objects without id', () => {
            expect(isInterceptor({ before: () => ({}) })).toBe(false);
            expect(isInterceptor({ after: () => ({}) })).toBe(false);
        });

        it('should return false for objects with id but no before/after', () => {
            expect(isInterceptor({ id: 'test' })).toBe(false);
            expect(isInterceptor({ id: 'test', comment: 'test' })).toBe(false);
        });

        it('should return true for valid interceptors with before only', () => {
            const interceptor = {
                id: 'test',
                before: (ctx: Context) => ctx
            };
            expect(isInterceptor(interceptor)).toBe(true);
        });

        it('should return true for valid interceptors with after only', () => {
            const interceptor = {
                id: 'test',
                after: (ctx: Context) => ctx
            };
            expect(isInterceptor(interceptor)).toBe(true);
        });

        it('should return true for valid interceptors with both before and after', () => {
            const interceptor = {
                id: 'test',
                before: (ctx: Context) => ctx,
                after: (ctx: Context) => ctx
            };
            expect(isInterceptor(interceptor)).toBe(true);
        });

        it('should return true for interceptors with additional properties', () => {
            const interceptor = {
                id: 'test',
                before: (ctx: Context) => ctx,
                comment: 'test interceptor',
                customProp: 'custom'
            };
            expect(isInterceptor(interceptor)).toBe(true);
        });
    });

    describe('execute', () => {
        beforeEach(() => {
            clearHandlers();
        });

        it('should execute interceptors with before and after phases', () => {
            const executionOrder: string[] = [];

            const interceptor1 = createTestInterceptor('interceptor1', {
                before: (ctx) => {
                    executionOrder.push('before-1');
                    return ctx;
                },
                after: (ctx) => {
                    executionOrder.push('after-1');
                    return ctx;
                }
            });

            const interceptor2 = createTestInterceptor('interceptor2', {
                before: (ctx) => {
                    executionOrder.push('before-2');
                    return ctx;
                },
                after: (ctx) => {
                    executionOrder.push('after-2');
                    return ctx;
                }
            });

            const eventV: EventVector = ['test-event', 'param1'];
            const result = execute(eventV, [interceptor1, interceptor2]);

            // Before phase: interceptor1, interceptor2
            // After phase: interceptor2, interceptor1 (reversed)
            expect(executionOrder).toEqual(['before-1', 'before-2', 'after-2', 'after-1']);

            expect(result.coeffects.event).toEqual(eventV);
            expect(result.coeffects.draftDb).toEqual({});
        });

        it('should handle interceptors with only before phase', () => {
            const executionOrder: string[] = [];

            const interceptor = createTestInterceptor('test', {
                before: (ctx) => {
                    executionOrder.push('before');
                    ctx.effects = [['testEffect', 'testValue']];
                    return ctx
                }
            });

            const result = execute(['test-event'], [interceptor]);

            expect(executionOrder).toEqual(['before']);
            expect(result.effects).toEqual([["testEffect", "testValue"]]);
        });

        it('should handle interceptors with only after phase', () => {
            const executionOrder: string[] = [];

            const interceptor = createTestInterceptor('test', {
                after: (ctx) => {
                    executionOrder.push('after');
                    ctx.effects.push(['afterEffect', 'afterValue']);
                    return ctx
                }
            });

            const result = execute(['test-event'], [interceptor]);

            expect(executionOrder).toEqual(['after']);
            expect(result.effects).toEqual([["afterEffect", "afterValue"]]);
        });

        it('should handle context modifications', () => {
            const interceptor = createTestInterceptor('test', {
                before: (ctx) => {
                    ctx.coeffects.customData = 'beforeValue';
                    ctx.effects.push(['beforeEffect', 'created']);
                    return ctx
                },
                after: (ctx) => {
                    const customData = ctx.coeffects.customData;
                    ctx.effects.push(['afterEffect', `processed-${customData}`]);
                    return ctx;
                }
            });

            const result = execute(['test-event'], [interceptor]);

            expect(result.coeffects.customData).toBe('beforeValue');
            expect(result.effects).toEqual([["beforeEffect", "created"], ["afterEffect", "processed-beforeValue"]]);
        });

        it('should handle error with custom error handler', () => {
            const errorHandler = jest.fn();
            registerHandler('error', 'event-handler', errorHandler);

            const faultyInterceptor = createTestInterceptor('faulty', {
                before: () => {
                    throw new Error('Test error');
                }
            });

            execute(['test-event'], [faultyInterceptor]);

            expect(errorHandler).toHaveBeenCalled();
            const [originalError, reFrameError] = errorHandler.mock.calls[0];

            expect(originalError.message).toBe('Test error');
            expect(reFrameError.message).toBe('Interceptor Exception: Test error');
            expect(reFrameError.data).toEqual({
                direction: 'before',
                interceptor: 'faulty',
                originalError: originalError,
                eventV: ['test-event']
            });
        });

        it('should handle error without custom error handler', () => {
            const faultyInterceptor = createTestInterceptor('faulty', {
                before: () => {
                    throw new Error('Test error');
                }
            });

            // Should still throw the error when no error handler is registered
            expect(() => {
                execute(['test-event'], [faultyInterceptor]);
            }).toThrow('Test error');
        });

        it('should handle error in after phase', () => {
            const errorHandler = jest.fn();
            registerHandler('error', 'event-handler', errorHandler);

            const faultyInterceptor = createTestInterceptor('faulty', {
                before: (ctx) => ctx,
                after: () => {
                    throw new Error('After error');
                }
            });

            execute(['test-event'], [faultyInterceptor]);

            expect(errorHandler).toHaveBeenCalled();
            const [, reFrameError] = errorHandler.mock.calls[0];
            expect(reFrameError.data.direction).toBe('after');
        });

        it('should create proper initial context', () => {
            const interceptor = createTestInterceptor('test', {
                before: (ctx) => {
                    // Verify initial context structure
                    expect(ctx.coeffects.event).toEqual(['test-event', 'param1', 'param2']);
                    expect(ctx.coeffects.draftDb).toEqual({});
                    expect(ctx.effects).toEqual([]);
                    expect(ctx.newDb).toEqual({});
                    expect(ctx.patches).toEqual([]);
                    expect(ctx.queue).toEqual([]);
                    expect(ctx.stack).toEqual([interceptor]);

                    return ctx;
                }
            });

            execute(['test-event', 'param1', 'param2'], [interceptor]);
        });

        it('should handle empty interceptor array', () => {
            const result = execute(['test-event'], []);

            expect(result.coeffects.event).toEqual(['test-event']);
            expect(result.coeffects.draftDb).toEqual({});
            expect(result.effects).toEqual([]);
            expect(result.queue).toEqual([]);
            expect(result.stack).toEqual([]);
        });
    });
}); 