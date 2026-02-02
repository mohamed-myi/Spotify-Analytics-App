# MYI-V3: Architecture Document

> **Scope**: System topology, service boundaries, technology rationale, and system integrity.
>
> **Related**: [Data Models](data_models.md) (entity relationships, constraints, tuning) | [Data Flow](data_flow.md) (pipelines, transformations)

---

## 1. System Organization

### Architectural Pattern: Layered Monorepo with Asynchronous Job Processing

The system is a **single deployable backend unit** organized into discrete horizontal layers, augmented by a decoupled job queue for long-running operations.

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                        │
│   Next.js 16 (App Router) - Thin visualization.                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS (REST/JSON)
┌──────────────────────────────▼──────────────────────────────────┐
│                          API LAYER                               │
│   Fastify routes (auth, stats, users, settings, cron, health)    │
│   JWT validation, rate limiting, request serialization           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                        SERVICE LAYER                             │
│   Business logic: ingestion, aggregation, stats, import          │
│   Stateless functions operating on domain entities               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                     INFRASTRUCTURE LAYER                         │
│   Prisma ORM, Redis client, Spotify API wrapper, encryption      │
│   External service adapters and data access                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                      PERSISTENCE LAYER                           │
│   PostgreSQL 15 (AWS RDS) - Partitioned tables, TIMESTAMPTZ      │
│   AWS ElastiCache (Redis) - Cache, locks, rate limits            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   BACKGROUND WORKER PLANE                        │
│   BullMQ workers: sync, import, metadata, top-stats              │
│   Decoupled from request path - triggered by cron or queue       │
└─────────────────────────────────────────────────────────────────┘
```

**Layer Responsibilities**:

| Layer | Responsibility | Coupling |
|-------|----------------|----------|
| Presentation | Render pre-computed data, handle user input | Depends on API layer via HTTP |
| API | Route dispatch, auth, serialization, schema validation | Depends on Service layer |
| Service | Domain logic, orchestration, business rules | Depends on Infrastructure layer |
| Infrastructure | Data access, external API integration, crypto | Depends on Persistence layer |
| Persistence | Durable storage, caching, locking | External systems |
| Workers | Async processing outside request cycle | Shares Infrastructure/Persistence |

---

## 2. Service Boundaries

### Internal Services (Controlled)

| Component | Boundary | Deployment |
|-----------|----------|------------|
| **Fastify API Server** | Stateless HTTP endpoints | AWS EC2 (PM2 managed) |
| **BullMQ Workers** | Job processors (sync, import, metadata, top stats) | Same EC2 instance |
| **Next.js Frontend** | Static/SSR pages | AWS EC2 (Next.js) |
| **Prisma Schema** | Database schema definition | Embedded in backend |

### External Dependencies (Uncontrolled)

| Service | Purpose | Failure Mode | Mitigation |
|---------|---------|--------------|------------|
| **Spotify Web API** | OAuth, recently-played, top tracks/artists | 401/403/429 errors, outages | Circuit breaker, retry with backoff, token invalidation after 3 failures |
| **AWS RDS PostgreSQL** | Primary datastore | Connection limits, cost at scale | Connection pooling via Prisma, SSL enforcement |
| **AWS ElastiCache** | Cache, locks, job queue | Private VPC access only | Security Groups allow EC2 access |
| **AWS Lambda** | Cron triggers (EventBridge) | Implementation complexity | Decoupled from main app logic |

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                      TRUST BOUNDARY                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Internal: API + Workers + Prisma                          │  │
│  │  - AES-256-GCM encrypted tokens at rest                    │  │
│  │  - HTTP-only session cookies                               │  │
│  │  - Zod-validated environment variables                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   [Spotify API]        [AWS RDS Postgres]   [AWS ElastiCache]
   (OAuth tokens)       (Encrypted conn)     (Private VPC)
```

---

## 3. Architectural Rationale

### Technology Selection

| Decision | Alternative Considered | Rationale |
|----------|------------------------|-----------|
| **Fastify** over Express | Express | 2-3x throughput, TypeScript, schema validation |
| **Prisma** over Drizzle/Knex | Drizzle, raw SQL | Type-safe queries from schema, quick setup, migration management |
| **BullMQ** over Temporal/Celery | Temporal, node-cron | Redis-native, lightweight, sufficient for job complexity |
| **PostgreSQL partitioning** | Sharding, separate tables | Native range partitioning handles up to 1B rows without application changes |
| **AWS RDS** over self-managed | Self-managed Postgres | Managed service, automated backups, SSL enforcement |
| **HTTP-only cookies** over localStorage JWT | localStorage + Bearer | XSS-resistant, automatic inclusion, server-side revocation |
| **Monorepo (pnpm)** over multi-repo | Separate repositories | Solo development, easy changes across frontend/backend, organization |

### Pattern Selection

| Pattern | Problem Solved |
|---------|----------------|
| **Layered architecture** | Separation of concerns, testability, clear dependency direction |
| **Background workers** | Sub-100ms API responses by moving computation off request path |
| **Pre-aggregation** | O(1) dashboard queries instead of O(N) over raw events |
| **Circuit breaker** | Prevents cascading failures when Spotify API degrades |
| **Incremental aggregation** | Real-time stats without batch rebuilds |
| **Partitioning** | Index size management and efficient time-range queries at scale |

---

## 4. Analysis

### Coupled Worker Deployment

**Bottleneck**: Workers and API share the same EC2 instance (t3.small). Under high import volume, worker CPU consumption directly impacts API response latency.

**Failure Scenario**: A user uploads a 100MB extended history file. The import worker saturates CPU. Concurrent dashboard requests experience latency spikes because workers and API compete for the same vCPU credits.

**Impact**: Horizontal scaling requires upgrading the EC2 instance type or deploying to a fleet, which adds cost/complexity compared to the current single-instance setup which was avoided for obvious reasons (I'm a student).

---

### Comparison with Other Architectures

#### Substitute 1: Microservices Architecture

**Description**: Decompose into independent services (auth-service, ingestion-service, stats-service, import-service) with separate deployments and databases.

| Aspect | Comparison |
|--------|------------|
| **Scaling** | Independent scaling of each service | 
| **Complexity** | Significantly higher operational overhead; not reasonable for solo development |
| **Latency** | Increased network calls add latency |
| **Data Consistency** | Requires eventual consistency |
| **Development Velocity** | Slower iteration due to contract management |

**Verdict**: Microservices would solve the worker isolation problem but introduce disproportionate complexity for a solo project with low traffic. The current user base does not justify the work.

#### Substitute 2: Serverless Functions (Lambda/Cloud Functions)

**Description**: Deploy each route and worker as independent serverless functions with event-driven invocation.

| Aspect | Comparison |
|--------|------------|
| **Scaling** | Automatic, granular scaling per function |
| **Cold Start** | Significant latency penalty (100-500ms) for infrequent routes |
| **State Management** | Stateless by design; requires external state for workers |
| **Cost** | Potentially lower at low traffic, expensive at sustained load |
| **BullMQ Compatibility** | BullMQ requires persistent connections; incompatible with serverless |

**Verdict**: Serverless would eliminate the scaling coupling but fundamentally conflicts with BullMQ's connection model. Migrating to SQS/Cloud Tasks would require rewriting the entire worker subsystem. Cold starts would also reduce dashboard response efficiency.

---

### Why Current Architecture

The layered monolith with async workers is optimal for:

1. **Single developer project**: One deployment artifact, one schema, one test suite.
2. **Moderate scale**: Partitioned tables handle up to 1B rows without sharding complexity.
3. **Cost efficiency**: Single t3.medium EC2 instance + RDS db.t3.micro (Free Tier eligible).
4. **Acceptable risk**: Worker contention is mitigatable via concurrency limits and import throttling.

The architecture should be revisited if:
- Daily active users exceed 10,000.
- Import queue depth regularly exceeds 100 pending jobs.
- API p99 latency exceeds 200ms during peak worker activity.

---

## 5. System Constraints

### Authentication and Authorization

| Constraint | Enforcement |
|------------|-------------|
| All refresh tokens encrypted at rest | AES-256-GCM with random IV per encryption |
| Dual-mode authentication (cookies + JWT) | Auth middleware checks Bearer tokens first, falls back to session cookies |
| JWT tokens signed with HS256 | Access tokens (7-day expiry), refresh tokens (30-day expiry) |
| Session cookies HTTP-only and Secure | Fastify cookie configuration |
| Token invalidation after 3 consecutive failures | `SpotifyAuth.consecutiveFailures` counter |
| PKCE required for OAuth | Authorization code flow with code verifier |
| Role-based access control (RBAC) | 3 roles (ADMIN, USER, DEMO) with 7 granular permissions |

### Scalability

| Constraint | Enforcement |
|------------|-------------|
| Dashboard queries must be O(1) | Pre-aggregated stats in denormalized tables |
| Listening events partitioned by month | PostgreSQL declarative partitioning on `played_at` |

> Database details  → [Data Models § Key Constraints](data_models.md#3-key-constraints-and-indices)

### Error Handling

| Constraint | Enforcement |
|------------|-------------|
| Spotify API failures classified | Retryable (429, 5xx) vs. terminal (401, 403) |
| Workers implement fail-fast with retry | BullMQ job options with exponential backoff |
| Global rate limit enforced | 150 req/min sliding window in Redis |
| All errors logged with request ID | Pino logger with correlation ID |

### Data Integrity

| Constraint | Enforcement |
|------------|-------------|
| Listening events deduplicated | Unique index on `(userId, trackId, playedAt)` |
| Import data overwrites API estimates | Source priority logic in ingestion service |
| All timestamps stored as TIMESTAMPTZ | Prisma schema with `@db.Timestamptz` |
| msPlayed must be positive | CHECK constraint on `listening_events.ms_played` |
| Rank values bounded 1-50 | CHECK constraint on ranking tables |

### Development

| Constraint | Enforcement |
|------------|-------------|
| Environment validated at startup | Zod schema in `env.ts`; process exits on failure |
| Type safety from database to API | Prisma-generated types, Zod request validation |
| Minimum 85% test coverage | Jest with coverage thresholds |

---

### Credits

Written by Mohamed Ibrahim, formatted by Gemini.

