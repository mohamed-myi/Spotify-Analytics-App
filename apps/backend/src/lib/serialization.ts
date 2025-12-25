// Helper to serialize objects containing BigInts to JSON-safe objects.
// BigInts are converted to strings to preserve precision.
export const toJSON = (data: any): any => {
    if (data === null || data === undefined) {
        return data;
    }

    if (typeof data === 'bigint') {
        return data.toString();
    }

    if (Array.isArray(data)) {
        return data.map(toJSON);
    }

    if (typeof data === 'object') {
        // Handle Date objects explicitly if needed, or let JSON.stringify handle them
        if (data instanceof Date) {
            return data.toISOString();
        }

        const out: any = {};
        for (const key of Object.keys(data)) {
            out[key] = toJSON(data[key]);
        }
        return out;
    }

    return data;
};

// Safely convert incoming data (number, string, or BigInt) to BigInt.
// Use this for API request bodies where msPlayed or totalMs values arrive as numbers.
export const toBigInt = (
    value: number | string | bigint | null | undefined,
    defaultValue: bigint = 0n
): bigint => {
    if (value === null || value === undefined) {
        return defaultValue;
    }

    if (typeof value === 'bigint') {
        return value;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error(`Cannot convert ${value} to BigInt: value is not finite`);
        }
        if (!Number.isInteger(value)) {
            throw new Error(`Cannot convert ${value} to BigInt: value is not an integer`);
        }
        return BigInt(value);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') {
            return defaultValue;
        }
        // Remove any trailing 'n' if someone passed a bigint string literal
        const normalized = trimmed.endsWith('n') ? trimmed.slice(0, -1) : trimmed;
        try {
            return BigInt(normalized);
        } catch {
            throw new Error(`Cannot convert "${value}" to BigInt: invalid format`);
        }
    }

    throw new Error(`Cannot convert ${typeof value} to BigInt`);
};
