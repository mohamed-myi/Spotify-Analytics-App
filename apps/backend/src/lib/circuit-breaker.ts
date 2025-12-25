import { SpotifyDownError } from './spotify-errors';
import { env } from '../env';
import { logger } from './logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeout: number;
    windowDuration: number;
}

export class CircuitBreakerOpenError extends Error {
    constructor(message = 'Circuit breaker is open') {
        super(message);
        this.name = 'CircuitBreakerOpenError';
    }
}

// Determines if an error should count toward tripping the circuit.
// Only 5xx server errors and network failures qualify.
export function shouldCountAsFailure(error: unknown): boolean {
    if (error instanceof SpotifyDownError) return true;
    if (error instanceof Error && error.message.includes('fetch failed')) return true;
    return false;
}

export class CircuitBreaker {
    private state: CircuitState = 'CLOSED';
    private failureTimestamps: number[] = [];
    private lastFailureTime = 0;

    private readonly failureThreshold: number;
    private readonly resetTimeout: number;
    private readonly windowDuration: number;

    constructor(options: CircuitBreakerOptions) {
        this.failureThreshold = options.failureThreshold;
        this.resetTimeout = options.resetTimeout;
        this.windowDuration = options.windowDuration;
    }

    // Execute an action with circuit breaker protection and error classification.
    // Only errors that pass the shouldCount predicate increment the failure counter.
    // Uses atomic guard pattern: state is checked once at entry, and the HALF_OPEN
    // flag is captured to avoid race conditions during async execution.
    async execute<T>(
        action: () => Promise<T>,
        shouldCount: (error: unknown) => boolean = () => true
    ): Promise<T> {
        this.updateState();

        if (this.state === 'OPEN') {
            throw new CircuitBreakerOpenError();
        }

        const isHalfOpen = this.state === 'HALF_OPEN';

        try {
            const result = await action();

            // Success: close circuit if we were probing
            if (isHalfOpen) {
                this.state = 'CLOSED';
                this.failureTimestamps = [];
                logger.info('Circuit breaker closing after successful probe');
            }

            return result;
        } catch (error) {
            if (shouldCount(error)) {
                this.recordFailure(isHalfOpen);
            }
            throw error;
        }
    }

    private updateState(): void {
        if (this.state === 'OPEN') {
            const now = Date.now();
            if (now - this.lastFailureTime >= this.resetTimeout) {
                this.state = 'HALF_OPEN';
                logger.info('Circuit breaker entering HALF_OPEN state');
            }
        }
    }

    private recordFailure(wasHalfOpen: boolean): void {
        const now = Date.now();
        this.lastFailureTime = now;
        this.failureTimestamps.push(now);

        // Remove failures outside the sliding window
        const windowStart = now - this.windowDuration;
        this.failureTimestamps = this.failureTimestamps.filter(t => t > windowStart);

        // Trip to OPEN if threshold exceeded or any failure during HALF_OPEN
        if (wasHalfOpen || this.failureTimestamps.length >= this.failureThreshold) {
            this.state = 'OPEN';
            logger.warn(
                {
                    failuresInWindow: this.failureTimestamps.length,
                    windowMs: this.windowDuration
                },
                'Circuit breaker opened'
            );
        }
    }



    getState(): CircuitState {
        return this.state;
    }

    // Reset state for testing
    reset(): void {
        this.state = 'CLOSED';
        this.failureTimestamps = [];
        this.lastFailureTime = 0;
    }
}

const breakerRegistry = new Map<string, CircuitBreaker>();

// Get or create a circuit breaker for the given service key.
// Enables independent failure domains.
export function getBreaker(serviceKey: string): CircuitBreaker {
    if (!breakerRegistry.has(serviceKey)) {
        breakerRegistry.set(serviceKey, new CircuitBreaker({
            failureThreshold: env.SPOTIFY_CB_THRESHOLD,
            resetTimeout: env.SPOTIFY_CB_RESET_TIMEOUT,
            windowDuration: env.SPOTIFY_CB_WINDOW_DURATION,
        }));
    }
    return breakerRegistry.get(serviceKey)!;
}

export function resetAllBreakers(): void {
    breakerRegistry.clear();
}

export function getBreakerKeys(): string[] {
    return Array.from(breakerRegistry.keys());
}