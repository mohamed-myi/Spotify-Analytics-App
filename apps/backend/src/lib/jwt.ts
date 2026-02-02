import * as jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

export interface JWTPayload {
    userId: string;
    role: Role;
    type: 'access' | 'refresh';
}

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'fallback-dev-secret-change-in-production';
const ACCESS_TOKEN_EXPIRY = process.env.JWT_EXPIRES_IN || '7d';
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

export function generateAccessToken(userId: string, role: Role): string {
    const payload: JWTPayload = { userId, role, type: 'access' };
    return jwt.sign(payload, JWT_SECRET as jwt.Secret, { expiresIn: ACCESS_TOKEN_EXPIRY } as jwt.SignOptions);
}

export function generateRefreshToken(userId: string, role: Role): string {
    const payload: JWTPayload = { userId, role, type: 'refresh' };
    return jwt.sign(payload, JWT_SECRET as jwt.Secret, { expiresIn: REFRESH_TOKEN_EXPIRY } as jwt.SignOptions);
}

export function verifyToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET as jwt.Secret) as JWTPayload;
    } catch (error) {
        return null;
    }
}
