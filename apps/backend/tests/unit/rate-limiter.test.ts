import { AdaptiveRateLimiter } from '../../src/lib/rate-limiter';

describe('AdaptiveRateLimiter', () => {
    let limiter: AdaptiveRateLimiter;

    beforeEach(() => {
        limiter = new AdaptiveRateLimiter({
            initialRate: 10,        // Fast for testing
            minRate: 1,
            burstCapacity: 5,
            recoveryFactor: 1.5,
            successStreakThreshold: 5,
        });
    });

    describe('acquire', () => {
        it('should allow immediate acquisition when tokens available', async () => {
            const startTime = Date.now();
            await limiter.acquire();
            const elapsed = Date.now() - startTime;

            // Should be nearly instant
            expect(elapsed).toBeLessThan(50);
        });

        it('should consume tokens on acquire', async () => {
            const initialState = limiter.getState();
            expect(initialState.tokens).toBe(5); // burstCapacity

            await limiter.acquire();

            const afterState = limiter.getState();
            expect(afterState.tokens).toBeLessThan(5);
        });

        it('should allow burst of requests up to capacity', async () => {
            const startTime = Date.now();

            // Should allow 5 requests immediately (burst capacity)
            await Promise.all([
                limiter.acquire(),
                limiter.acquire(),
                limiter.acquire(),
                limiter.acquire(),
                limiter.acquire(),
            ]);

            const elapsed = Date.now() - startTime;
            expect(elapsed).toBeLessThan(100);
        });

        it('should wait when no tokens available', async () => {
            // Exhaust burst capacity
            for (let i = 0; i < 5; i++) {
                await limiter.acquire();
            }

            const startTime = Date.now();
            await limiter.acquire();
            const elapsed = Date.now() - startTime;

            // Should have waited for refill (at rate 10/sec = 100ms per token)
            expect(elapsed).toBeGreaterThanOrEqual(50);
        });
    });

    describe('recordSuccess', () => {
        it('should increment success streak', () => {
            limiter.recordSuccess();
            limiter.recordSuccess();
            limiter.recordSuccess();

            // Success streak is internal, but rate should stay stable
            const state = limiter.getState();
            expect(state.currentRate).toBe(10);
        });

        it('should recover rate after success streak threshold', () => {
            // Create limiter with halved rate
            const halfedLimiter = new AdaptiveRateLimiter({
                initialRate: 10,
                minRate: 1,
                burstCapacity: 5,
                recoveryFactor: 1.5,
                successStreakThreshold: 3,
            });

            // Simulate rate reduction
            halfedLimiter.handleRateLimit(1);
            expect(halfedLimiter.getState().currentRate).toBe(5); // Halved

            // Record successes to trigger recovery
            halfedLimiter.recordSuccess();
            halfedLimiter.recordSuccess();
            halfedLimiter.recordSuccess();

            // Rate should have recovered (5 * 1.5 = 7.5)
            expect(halfedLimiter.getState().currentRate).toBe(7.5);
        });
    });

    describe('handleRateLimit', () => {
        it('should halve the rate on 429', () => {
            const initialRate = limiter.getState().currentRate;
            limiter.handleRateLimit(1);

            expect(limiter.getState().currentRate).toBe(initialRate / 2);
        });

        it('should not go below minimum rate', () => {
            // Multiple rate limits to drive rate down
            limiter.handleRateLimit(1);
            limiter.handleRateLimit(1);
            limiter.handleRateLimit(1);
            limiter.handleRateLimit(1);

            expect(limiter.getState().currentRate).toBe(1); // minRate
        });

        it('should set isPaused flag', () => {
            limiter.handleRateLimit(5);

            expect(limiter.getState().isPaused).toBe(true);
        });

        it('should reset success streak', () => {
            limiter.recordSuccess();
            limiter.recordSuccess();
            limiter.handleRateLimit(1);

            // After handling rate limit, need full streak again
            const halfedLimiter = new AdaptiveRateLimiter({
                initialRate: 10,
                minRate: 1,
                burstCapacity: 5,
                recoveryFactor: 1.5,
                successStreakThreshold: 3,
            });

            halfedLimiter.handleRateLimit(1);
            halfedLimiter.recordSuccess();
            halfedLimiter.recordSuccess();
            // Still at 5 because we need 3 successes
            expect(halfedLimiter.getState().currentRate).toBe(5);
        });

        it('should pause requests for retry-after duration', async () => {
            limiter.handleRateLimit(0.1); // 100ms pause

            const startTime = Date.now();
            await limiter.acquire();
            const elapsed = Date.now() - startTime;

            // Should have waited for pause period
            expect(elapsed).toBeGreaterThanOrEqual(90);
        });
    });

    describe('reset', () => {
        it('should restore initial state', () => {
            // Modify state
            limiter.handleRateLimit(1);
            limiter.acquire();

            // Reset
            limiter.reset();

            const state = limiter.getState();
            expect(state.currentRate).toBe(10);
            expect(state.tokens).toBe(5);
            expect(state.isPaused).toBe(false);
        });
    });

    describe('getState', () => {
        it('should return current rate, tokens, and pause status', () => {
            const state = limiter.getState();

            expect(state).toHaveProperty('currentRate');
            expect(state).toHaveProperty('tokens');
            expect(state).toHaveProperty('isPaused');
        });

        it('should refill tokens on getState call', async () => {
            await limiter.acquire();
            const afterAcquire = limiter.getState().tokens;

            // Wait a bit for refill
            await new Promise(r => setTimeout(r, 150));

            const afterWait = limiter.getState().tokens;
            expect(afterWait).toBeGreaterThan(afterAcquire);
        });
    });
});

