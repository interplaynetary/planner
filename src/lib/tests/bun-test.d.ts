/**
 * Type declarations for bun:test so svelte-check doesn't flag the imports.
 * Bun's own runtime provides these at execution time.
 */
declare module 'bun:test' {
    type Done = (err?: unknown) => void;
    type TestFn = (() => void | Promise<void>) | ((done: Done) => void);

    export function describe(name: string, fn: () => void): void;
    export function test(name: string, fn: TestFn, timeout?: number): void;
    export const it: typeof test;
    export function expect(value: unknown): jest.Matchers<unknown>;
    export namespace expect {
        function objectContaining(obj: Record<string, unknown>): unknown;
        function arrayContaining(arr: unknown[]): unknown;
        function stringContaining(str: string): unknown;
        function stringMatching(pattern: string | RegExp): unknown;
        function any(constructor: unknown): unknown;
    }
    export function beforeAll(fn: TestFn): void;
    export function afterAll(fn: TestFn): void;
    export function beforeEach(fn: TestFn): void;
    export function afterEach(fn: TestFn): void;
    export function mock<T extends (...args: unknown[]) => unknown>(fn?: T): T & { mock: { calls: unknown[][] } };
    export function spyOn<T, K extends keyof T>(obj: T, method: K): jest.SpyInstance;

    // Re-export jest namespace so expect().toX() resolves
    namespace jest {
        interface Matchers<R> {
            toBe(expected: unknown): R;
            toEqual(expected: unknown): R;
            toStrictEqual(expected: unknown): R;
            toBeTruthy(): R;
            toBeFalsy(): R;
            toBeNull(): R;
            toBeUndefined(): R;
            toBeDefined(): R;
            toBeGreaterThan(n: number): R;
            toBeGreaterThanOrEqual(n: number): R;
            toBeLessThan(n: number): R;
            toBeLessThanOrEqual(n: number): R;
            toBeCloseTo(n: number, digits?: number): R;
            toContain(item: unknown): R;
            toHaveLength(n: number): R;
            toThrow(msg?: string | RegExp | Error): R;
            toThrowError(msg?: string | RegExp | Error): R;
            not: Matchers<R>;
            resolves: Matchers<R>;
            rejects: Matchers<R>;
            toMatchObject(obj: unknown): R;
            toBeInstanceOf(cls: unknown): R;
            toMatchSnapshot(): R;
            toMatch(pattern: string | RegExp): R;
            toContainEqual(item: unknown): R;
            toHaveProperty(keyPath: string | string[], value?: unknown): R;
            [key: string]: unknown;
        }
        interface SpyInstance {
            mock: { calls: unknown[][] };
        }
    }
}
