import { generateAccessToken, generateRefreshToken, verifyToken } from '@/lib/jwt';
import { Role } from '@prisma/client';

describe('JWT utilities', () => {
    describe('generateAccessToken', () => {
        it('generates a valid access token', () => {
            const userId = 'test-user-123';
            const role: Role = 'USER';

            const token = generateAccessToken(userId, role);

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
        });

        it('includes userId and role in payload', () => {
            const userId = 'test-user-456';
            const role: Role = 'ADMIN';

            const token = generateAccessToken(userId, role);
            const payload = verifyToken(token);

            expect(payload).toBeDefined();
            expect(payload?.userId).toBe(userId);
            expect(payload?.role).toBe(role);
            expect(payload?.type).toBe('access');
        });
    });

    describe('generateRefreshToken', () => {
        it('generates a valid refresh token', () => {
            const userId = 'test-user-789';
            const role: Role = 'DEMO';

            const token = generateRefreshToken(userId, role);

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.split('.')).toHaveLength(3);
        });

        it('marks token type as refresh', () => {
            const userId = 'test-user-000';
            const role: Role = 'USER';

            const token = generateRefreshToken(userId, role);
            const payload = verifyToken(token);

            expect(payload).toBeDefined();
            expect(payload?.type).toBe('refresh');
        });
    });

    describe('verifyToken', () => {
        it('verifies valid access token', () => {
            const userId = 'test-user-111';
            const role: Role = 'USER';
            const token = generateAccessToken(userId, role);

            const payload = verifyToken(token);

            expect(payload).not.toBeNull();
            expect(payload?.userId).toBe(userId);
            expect(payload?.role).toBe(role);
        });

        it('verifies valid refresh token', () => {
            const userId = 'test-user-222';
            const role: Role = 'ADMIN';
            const token = generateRefreshToken(userId, role);

            const payload = verifyToken(token);

            expect(payload).not.toBeNull();
            expect(payload?.userId).toBe(userId);
            expect(payload?.type).toBe('refresh');
        });

        it('returns null for invalid token', () => {
            const invalidToken = 'invalid.token.here';

            const payload = verifyToken(invalidToken);

            expect(payload).toBeNull();
        });

        it('returns null for expired token', () => {
            // Create a token with 0 expiry (immediately expired)
            const jwt = require('jsonwebtoken');
            const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'fallback-dev-secret-change-in-production';
            const expiredToken = jwt.sign(
                { userId: 'test', role: 'USER', type: 'access' },
                JWT_SECRET,
                { expiresIn: '0s' }
            );

            // Wait a tiny bit to ensure expiration
            const payload = verifyToken(expiredToken);

            expect(payload).toBeNull();
        });

        it('returns null for tampered token', () => {
            const token = generateAccessToken('test-user', 'USER');
            const tamperedToken = token.slice(0, -5) + 'XXXXX'; // Tamper with signature

            const payload = verifyToken(tamperedToken);

            expect(payload).toBeNull();
        });
    });

    describe('token differentiation', () => {
        it('distinguishes between access and refresh tokens', () => {
            const userId = 'test-user-888';
            const role: Role = 'USER';

            const accessToken = generateAccessToken(userId, role);
            const refreshToken = generateRefreshToken(userId, role);

            const accessPayload = verifyToken(accessToken);
            const refreshPayload = verifyToken(refreshToken);

            expect(accessPayload?.type).toBe('access');
            expect(refreshPayload?.type).toBe('refresh');
        });
    });
});
