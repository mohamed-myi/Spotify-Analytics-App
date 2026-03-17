import Fastify, { FastifyInstance } from 'fastify';
import { demoGuard } from '../../src/middleware/demo-guard';

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
    },
}));

const mockAuthMiddleware = async (req: any) => {
    const testUser = req.headers['x-test-user-id'];
    if (testUser) {
        req.userId = testUser;
        req.isDemo = testUser === 'demo-user-id';
    }
};

describe('Demo Guard integration', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        app.addHook('preHandler', mockAuthMiddleware);
        app.addHook('preHandler', demoGuard);

        app.post('/demo/write', async () => ({ ok: true }));
        app.post('/playlists/validate/shuffle', async () => ({ handled: true }));

        await app.ready();
    });

    afterAll(async () => {
        if (app) await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('blocks demo users from write paths', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/demo/write',
            headers: { 'x-test-user-id': 'demo-user-id' },
        });

        expect(response.statusCode).toBe(403);
        const body = response.json();
        expect(body.code).toBe('DEMO_MODE_RESTRICTED');
        expect(body.error).toBe('Demo Mode');
    });

    it('allows demo users onto allow-listed validation routes', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/playlists/validate/shuffle',
            headers: { 'x-test-user-id': 'demo-user-id' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ handled: true });
    });

    it('lets regular users reach write paths', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/demo/write',
            headers: { 'x-test-user-id': 'real-user' },
        });

        expect(response.statusCode).toBe(200);
    });
});
