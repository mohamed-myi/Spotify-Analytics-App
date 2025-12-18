// Mock for global.fetch to test Spotify API calls without network

export interface MockResponse {
    ok: boolean;
    status: number;
    headers: Map<string, string>;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
}

type FetchMockHandler = (url: string, options?: RequestInit) => Promise<MockResponse>;

let mockHandler: FetchMockHandler | null = null;
const originalFetch = global.fetch;

export function mockFetch(handler: FetchMockHandler): void {
    mockHandler = handler;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.toString();
        const mockResponse = await handler(url, init);
        return {
            ok: mockResponse.ok,
            status: mockResponse.status,
            headers: {
                get: (key: string) => mockResponse.headers.get(key) || null,
            },
            json: mockResponse.json,
            text: mockResponse.text,
        } as Response;
    };
}

export function restoreFetch(): void {
    mockHandler = null;
    global.fetch = originalFetch;
}

// Helper to create mock responses
export function createMockResponse(
    status: number,
    body: unknown,
    headers: Record<string, string> = {}
): MockResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Map(Object.entries(headers)),
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}
