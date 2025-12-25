/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    projects: [
        {
            displayName: 'unit',
            preset: 'ts-jest',
            testEnvironment: 'node',
            rootDir: '.',
            testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
            setupFilesAfterEnv: ['<rootDir>/tests/setup-unit.ts'],
            moduleNameMapper: {
                '^@/(.*)$': '<rootDir>/src/$1',
            },
            transform: {
                '^.+\\.tsx?$': [
                    'ts-jest',
                    {
                        useESM: true,
                    },
                ],
                '^.+\\.js$': 'babel-jest',
            },
            transformIgnorePatterns: [
                'node_modules/(?!(p-retry|is-network-error)/)',
            ],
        },
        {
            displayName: 'integration',
            preset: 'ts-jest',
            testEnvironment: 'node',
            rootDir: '.',
            testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
            setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
            testTimeout: 60000,
            moduleNameMapper: {
                '^@/(.*)$': '<rootDir>/src/$1',
            },
            transform: {
                '^.+\\.tsx?$': [
                    'ts-jest',
                    {
                        useESM: true,
                    },
                ],
                '^.+\\.js$': 'babel-jest',
            },
            transformIgnorePatterns: [
                'node_modules/(?!(p-retry|is-network-error)/)',
            ],
        },
    ],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/index.ts',
        // Workers have module-level Worker instantiation that cannot be unit tested
        '!src/workers/sync-worker.ts',
        '!src/workers/import-worker.ts',
        // Streaming JSON parser in import service is difficult to unit test - covered by integration tests
        '!src/services/import.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 84,
            functions: 85,
            lines: 85,
            statements: 85,
        },
    },
};
