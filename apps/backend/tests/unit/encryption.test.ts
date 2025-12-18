import { encrypt, decrypt, generateEncryptionKey } from '../../src/lib/encryption';

// Set a test encryption key before running tests
beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

describe('encrypt', () => {
    test('returns colon-separated string', () => {
        const result = encrypt('test');
        const parts = result.split(':');
        expect(parts).toHaveLength(3);
    });

    test('returns different ciphertext for same plaintext (due to random IV)', () => {
        const plaintext = 'same input';
        const result1 = encrypt(plaintext);
        const result2 = encrypt(plaintext);
        expect(result1).not.toBe(result2);
    });

    test('handles empty string', () => {
        const result = encrypt('');
        expect(result).toBeTruthy();
        expect(result.split(':')).toHaveLength(3);
    });

    test('handles long strings', () => {
        const longString = 'a'.repeat(10000);
        const result = encrypt(longString);
        expect(result).toBeTruthy();
    });

    test('handles unicode characters', () => {
        const unicode = '你好世界 🎵 مرحبا';
        const result = encrypt(unicode);
        expect(result).toBeTruthy();
    });
});

describe('decrypt', () => {
    test('roundtrip: encrypt then decrypt returns original', () => {
        const original = 'my secret refresh token';
        const encrypted = encrypt(original);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(original);
    });

    test('roundtrip with unicode', () => {
        const original = 'refresh_token_with_emoji_🎵';
        const encrypted = encrypt(original);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(original);
    });

    test('roundtrip with empty string', () => {
        const original = '';
        const encrypted = encrypt(original);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(original);
    });

    test('throws on invalid format (missing parts)', () => {
        expect(() => decrypt('invalid')).toThrow('Invalid ciphertext format');
        expect(() => decrypt('part1:part2')).toThrow('Invalid ciphertext format');
    });

    test('throws on tampered ciphertext', () => {
        const encrypted = encrypt('test');
        const parts = encrypted.split(':');
        // Tamper with the encrypted data
        parts[2] = 'ff' + parts[2].slice(2);
        const tampered = parts.join(':');
        expect(() => decrypt(tampered)).toThrow();
    });

    test('throws on tampered auth tag', () => {
        const encrypted = encrypt('test');
        const parts = encrypted.split(':');
        // Tamper with the auth tag
        parts[1] = 'ff' + parts[1].slice(2);
        const tampered = parts.join(':');
        expect(() => decrypt(tampered)).toThrow();
    });
});

describe('generateEncryptionKey', () => {
    test('returns 64-character hex string', () => {
        const key = generateEncryptionKey();
        expect(key).toHaveLength(64);
        expect(/^[0-9a-f]+$/.test(key)).toBe(true);
    });

    test('generates unique keys', () => {
        const key1 = generateEncryptionKey();
        const key2 = generateEncryptionKey();
        expect(key1).not.toBe(key2);
    });
});

describe('encryption key validation', () => {
    const originalKey = process.env.ENCRYPTION_KEY;

    afterEach(() => {
        process.env.ENCRYPTION_KEY = originalKey;
    });

    test('throws when ENCRYPTION_KEY is missing', () => {
        delete process.env.ENCRYPTION_KEY;
        expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY environment variable is required');
    });

    test('throws when ENCRYPTION_KEY is wrong length', () => {
        process.env.ENCRYPTION_KEY = 'tooshort';
        expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be 64 hex characters');
    });
});
