import { logger } from './logger';

export interface RateLimiterConfig {
    initialRate: number;      // Requests per second
    minRate: number;          // Minimum rate after backoff
    burstCapacity: number;    // Max tokens in bucket
    recoveryFactor: number;   // Rate increase factor after success streak
    successStreakThreshold: number; // Successes before rate recovery
}

const DEFAULT_CONFIG: RateLimiterConfig = {
    initialRate: 2,           // 2 requests/second (conservative)
    minRate: 0.5,             // 1 request every 2 seconds minimum
    burstCapacity: 5,         // Allow small bursts
    recoveryFactor: 1.25,     // 25% rate increase on recovery
    successStreakThreshold: 20, // 20 successes before recovering rate
};

export class AdaptiveRateLimiter {
    private tokens: number;
    private lastRefill: number;
    private currentRate: number;
    private successStreak: number;
    private isPaused: boolean;
    private pauseUntil: number;
    private config: RateLimiterConfig;

    constructor(config: Partial<RateLimiterConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.tokens = this.config.burstCapacity;
        this.lastRefill = Date.now();
        this.currentRate = this.config.initialRate;
        this.successStreak = 0;
        this.isPaused = false;
        this.pauseUntil = 0;
    }

    private refillTokens(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000; // Convert to seconds
        const newTokens = elapsed * this.currentRate;
        this.tokens = Math.min(this.config.burstCapacity, this.tokens + newTokens);
        this.lastRefill = now;
    }

    async acquire(): Promise<void> {
        if (this.isPaused) {
            const now = Date.now();
            if (now < this.pauseUntil) {
                const waitTime = this.pauseUntil - now;
                logger.info({ waitTime }, 'Rate limiter paused, waiting...');
                await this.sleep(waitTime);
            }
            this.isPaused = false;
        }

        this.refillTokens();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        const tokensNeeded = 1 - this.tokens;
        const waitTime = (tokensNeeded / this.currentRate) * 1000;

        logger.debug({ waitTime, currentRate: this.currentRate }, 'Rate limiter waiting for token');
        await this.sleep(waitTime);

        this.refillTokens();
        this.tokens -= 1;
    }

    recordSuccess(): void {
        this.successStreak++;

        if (this.successStreak >= this.config.successStreakThreshold) {
            const newRate = Math.min(
                this.config.initialRate,
                this.currentRate * this.config.recoveryFactor
            );
            if (newRate > this.currentRate) {
                logger.info(
                    { oldRate: this.currentRate, newRate },
                    'Rate limiter recovering rate after success streak'
                );
                this.currentRate = newRate;
            }
            this.successStreak = 0;
        }
    }

    handleRateLimit(retryAfterSeconds: number): void {
        this.successStreak = 0;

        this.isPaused = true;
        this.pauseUntil = Date.now() + (retryAfterSeconds * 1000);

        const newRate = Math.max(this.config.minRate, this.currentRate / 2);

        logger.warn(
            {
                retryAfterSeconds,
                oldRate: this.currentRate,
                newRate,
                pauseUntil: new Date(this.pauseUntil).toISOString()
            },
            'Rate limiter backing off after 429'
        );

        this.currentRate = newRate;
    }

    getState(): { currentRate: number; tokens: number; isPaused: boolean } {
        this.refillTokens();
        return {
            currentRate: this.currentRate,
            tokens: this.tokens,
            isPaused: this.isPaused,
        };
    }

    reset(): void {
        this.tokens = this.config.burstCapacity;
        this.lastRefill = Date.now();
        this.currentRate = this.config.initialRate;
        this.successStreak = 0;
        this.isPaused = false;
        this.pauseUntil = 0;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

let importRateLimiter: AdaptiveRateLimiter | null = null;

export function getImportRateLimiter(): AdaptiveRateLimiter {
    if (!importRateLimiter) {
        importRateLimiter = new AdaptiveRateLimiter();
    }
    return importRateLimiter;
}

export function resetImportRateLimiter(): void {
    if (importRateLimiter) {
        importRateLimiter.reset();
    }
}

