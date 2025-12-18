// Mock for Prisma client to test database-dependent code without real DB

export interface MockPrismaClient {
    user: MockModel;
    spotifyAuth: MockModel;
    track: MockModel;
    artist: MockModel;
    album: MockModel;
    listeningEvent: MockModel;
    $disconnect: () => Promise<void>;
}

export interface MockModel {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    upsert: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
}

function createMockModel(): MockModel {
    return {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn(),
    };
}

export function createMockPrisma(): MockPrismaClient {
    return {
        user: createMockModel(),
        spotifyAuth: createMockModel(),
        track: createMockModel(),
        artist: createMockModel(),
        album: createMockModel(),
        listeningEvent: createMockModel(),
        $disconnect: jest.fn().mockResolvedValue(undefined),
    };
}

// Reset all mocks
export function resetMockPrisma(mock: MockPrismaClient): void {
    Object.values(mock).forEach((model) => {
        if (typeof model === 'object' && model !== null) {
            Object.values(model).forEach((fn) => {
                if (typeof fn === 'function' && 'mockReset' in fn) {
                    (fn as jest.Mock).mockReset();
                }
            });
        }
    });
}
