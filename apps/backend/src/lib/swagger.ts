import { FastifySwaggerOptions } from '@fastify/swagger';
import { FastifySwaggerUiOptions } from '@fastify/swagger-ui';

export const swaggerOptions = {
    openapi: {
        info: {
            title: 'MYI-V3 API',
            description: 'API documentation for MYI-V3 Music Analytics',
            version: '0.1.0',
        },
        servers: [
            {
                url: process.env.NODE_ENV === 'production' ? 'https://api.myi.xyz' : 'http://localhost:3001',
                description: process.env.NODE_ENV === 'production' ? 'Production' : 'Development'
            }
        ],
        tags: [
            { name: 'Auth', description: 'Authentication endpoints' },
            { name: 'Users', description: 'User management endpoints' },
            { name: 'Stats', description: 'Statistics and analytics endpoints' },
            { name: 'Import', description: 'Data import endpoints' },
            { name: 'Compare', description: 'Friend comparison endpoints' },
            { name: 'Health', description: 'Health check endpoints' },
        ],
        components: {
            securitySchemes: {
                cookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'session'
                }
            }
        }
    },
};

export const swaggerUiOptions: FastifySwaggerUiOptions = {
    routePrefix: '/documentation',
    uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
    },
    uiHooks: {
        onRequest: function (request, reply, next) { next() },
        preHandler: function (request, reply, next) { next() }
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
};
