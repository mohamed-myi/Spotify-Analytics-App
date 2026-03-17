jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        publish: jest.fn(),
        subscribe: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        sadd: jest.fn(),
        spop: jest.fn(),
        quit: jest.fn(),
        duplicate: jest.fn().mockReturnThis(),
    }));
});

jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn(),
        close: jest.fn(),
    })),
    Worker: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        close: jest.fn(),
    })),
}));

// Re-export partition utilities from the shared library to ensure tests use the same hardened logic as production
export {
    ensurePartitionForDate,
    ensurePartitionsForDates,
    ensurePartitionsForRange
} from '../src/lib/partitions';

import { createMockPrisma, resetMockPrisma } from './mocks/prisma.mock';
import { prisma } from '../src/lib/prisma';

// Mock Prisma globally for integration tests to prevent accidental DB connections
jest.mock('../src/lib/prisma', () => {
    const { createMockPrisma } = jest.requireActual('./mocks/prisma.mock');
    return {
        prisma: createMockPrisma(),
    };
});

beforeEach(() => {
    resetMockPrisma(prisma as any);
});
