import { toJSON, toBigInt } from '../../../src/lib/serialization';

describe('serialization', () => {
    describe('toJSON', () => {
        it('should convert BigInt to string', () => {
            expect(toJSON({ value: BigInt(1234567890123456789n) })).toEqual({
                value: '1234567890123456789',
            });
        });

        it('should handle nested objects with BigInt', () => {
            const input = {
                user: { totalMs: BigInt(3600000) },
                stats: [{ ms: BigInt(1000) }, { ms: BigInt(2000) }],
            };
            expect(toJSON(input)).toEqual({
                user: { totalMs: '3600000' },
                stats: [{ ms: '1000' }, { ms: '2000' }],
            });
        });

        it('should convert Date to ISO string', () => {
            const date = new Date('2025-01-01T00:00:00Z');
            expect(toJSON({ date })).toEqual({ date: '2025-01-01T00:00:00.000Z' });
        });

        it('should handle null and undefined', () => {
            expect(toJSON(null)).toBeNull();
            expect(toJSON(undefined)).toBeUndefined();
            expect(toJSON({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
        });

        it('should pass through primitives', () => {
            expect(toJSON('hello')).toBe('hello');
            expect(toJSON(42)).toBe(42);
            expect(toJSON(true)).toBe(true);
        });
    });

    describe('toBigInt', () => {
        it('should convert number to BigInt', () => {
            expect(toBigInt(12345)).toBe(12345n);
            expect(toBigInt(0)).toBe(0n);
            expect(toBigInt(-100)).toBe(-100n);
        });

        it('should convert string to BigInt', () => {
            expect(toBigInt('12345')).toBe(12345n);
            expect(toBigInt('  12345  ')).toBe(12345n);
            expect(toBigInt('-100')).toBe(-100n);
        });

        it('should handle BigInt string literal format', () => {
            expect(toBigInt('12345n')).toBe(12345n);
        });

        it('should pass through BigInt values', () => {
            expect(toBigInt(12345n)).toBe(12345n);
        });

        it('should return default for null/undefined', () => {
            expect(toBigInt(null)).toBe(0n);
            expect(toBigInt(undefined)).toBe(0n);
            expect(toBigInt(null, 100n)).toBe(100n);
            expect(toBigInt(undefined, 100n)).toBe(100n);
        });

        it('should return default for empty string', () => {
            expect(toBigInt('')).toBe(0n);
            expect(toBigInt('   ')).toBe(0n);
            expect(toBigInt('', 50n)).toBe(50n);
        });

        it('should throw for non-finite numbers', () => {
            expect(() => toBigInt(Infinity)).toThrow('not finite');
            expect(() => toBigInt(-Infinity)).toThrow('not finite');
            expect(() => toBigInt(NaN)).toThrow('not finite');
        });

        it('should throw for non-integer numbers', () => {
            expect(() => toBigInt(3.14)).toThrow('not an integer');
            expect(() => toBigInt(0.5)).toThrow('not an integer');
        });

        it('should throw for invalid string format', () => {
            expect(() => toBigInt('abc')).toThrow('invalid format');
            expect(() => toBigInt('12.34')).toThrow('invalid format');
        });
    });
});
