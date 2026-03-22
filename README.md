# Spotify Analytics Platform / Self-Hosted Spotify Data Warehouse

> **Spotify App Status**: Development Mode
>
> **Spotify Developer Policy**: As of May 15, 2025, Spotify only accepts applications from organizations. This application cannot be verified for public use. To self-host, you must create your own Spotify Developer App using the steps in the setup section.

> **Discotinued Features**: Due to this restriction, I decided not to continue with adding features such as being able to add friends, share music, get recommendations or create playlists. Given the limitation, I decided to just treat this project as a learning experience for data warehousing as opposed to a full-featured app.

## 1. Project Evolution

### V1
My first full-stack project was essentially an API wrapper. It relied on a 2,000 line monolithic file that handled authentication, API logic, and data processing in a single thread. It lacked modularity and testing, which made it incapable of handling significant loads. UI rendering was slow because API calls were triggered on-demand, leading to frequent rate-limiting. The cyclomatic complexity made it impossible to maintain.

### V2
This version introduced background polling and exponential backoff to manage rate limits. I added 3-tier caching and session persistence to avoid redundant authentication. While the code was more modular and included initial test cases, it still relied on in-memory caching. This meant data was lost on server restarts and heavy processing risked blocking the Node.js event loop.

### V3
After a few months interning, I realized that the planning and testing phases were more important than the actual coding. I shifted my focus to architecture and resilience. V3 was designed to solve three persistent issues:

*   **Memory Management**: Moving data processing out of the main event loop to prevent crashes.
*   **Path Decoupling**: Separating the processing and serving paths so ingestion never blocks the API.
*   **Persistence**: Moving from in-memory caching to a robust, partitioned PostgreSQL warehouse.

## 2. Engineering Challenges

> For implementation details, refer to the [Architecture](docs/architecture.md), [Data Models](docs/data_models.md), and [Data Flow](docs/data_flow.md) documents.

### 2.1 Declarative Partitioning for 900M+ Scale
A single table for listening events would eventually exceed manageable index size, slowing down queries. Monthly range partitioning keeps index depth shallow and allows for efficient data management without expensive delete operations.

→ Implementation: [Partitioning Strategy](docs/data_models.md#3-key-constraints-and-indices)

### 2.2 Compute Off-Path Architecture
Complex aggregations are too expensive to calculate during a user's HTTP request. Decoupling the write/compute path from the read path via async workers ensures the API is never blocked by heavy data processing.

→ Implementation: [Async Processing Rationale](docs/data_flow.md#42-synchronous-vs-asynchronous-processing) | [Architectural Pattern](docs/architecture.md#3-architectural-rationale)

### 2.3 State-Locked Metadata Ingestion
Repeated tracks in history would normally trigger Spotify's rate limits if metadata was fetched for every play. A 24-hour distributed lock using Redis ensures only one worker fetches metadata while others skip the call.

→ Implementation: [Metadata Lock Trade-offs](docs/data_flow.md#32-metadata-worker-stale-lock)

### 2.4 Stream-Based Memory Management
Importing large history files into Node.js memory causes heap overflows. Processing files chunk-by-chunk keeps memory usage constant regardless of the file size.

→ Implementation: [Import Pipeline](docs/data_flow.md#23-legacy-history-import)

## 3. Learnings

### System Design > Syntax
My biggest takeaway from V3 was that coding is the easy part. Spending weeks on system design and schema planning saved months of debugging. I learned to value a "plan-first" approach, where I break the system into small, decoupled services before writing any logic.

### Don't build for the happy path
In previous versions, a single API failure could crash the sync engine. In this version, I learned to implement circuit breakers and idempotent workers. If a job fails, the system recovers gracefully without duplicating data or losing state.

### Separation of Concerns
I used to rely heavily on application logic to handle data. This project taught me to lean on the database. Using native PostgreSQL features like declarative partitioning and composite unique indexes is a lot more efficient than trying to manage data integrity in Node.js.

## 4. Technology Stack

| Layer | Technologies |
|-------|--------------|
| **Backend** | Node.js, TypeScript, Fastify, BullMQ, EC2-hosted cron runner |
| **Data** | PostgreSQL 17, Prisma 7, AWS ElastiCache (Redis) |
| **Frontend** | Next.js 16, TailwindCSS, Framer Motion |
| **Infrastructure** | AWS EC2 (t3.small), Neon DB |

→ Rationale: [Technology Selection](docs/architecture.md#3-architectural-rationale)

## 5. Technical Documentation

| Document | Focus Area |
|----------|------------|
| [Architecture](docs/architecture.md) | System design, Alternative Considerations |
| [Data Models](docs/data_models.md) | Entity relationships, constraints, self-critique |
| [Data Flow](docs/data_flow.md) | Data pipelines, transformation logic |
| [Operations](docs/operations.md) | Runtime pinning, EC2 scheduler, recovery checks |

## 6. Setup and Installation

### Spotify Developer Setup
Because this app runs in Development Mode, you must use your own credentials:

1.  Log in to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2.  Create a new App and set the Redirect URI to `http://127.0.0.1:3001/auth/callback`.
3.  In User Management, manually add the email of your Spotify account.
4.  Copy the Client ID and Client Secret into your environment file.

### Installation

1.  **Install dependencies**:
    ```bash
    pnpm install
    ```

2.  **Run database migrations**:
    ```bash
    npx prisma migrate dev
    ```

3.  **Start development servers**:
    ```bash
    pnpm run dev
    ```
## 7. Demo Mode

I added a demo mode to the app, because you can only authenticate if I manually add you as a user due to Spotify's policies. The demo mode is simply a read-only version supplemented with some static data so you can get a feel for the app.

### For Developers
- A separate demo user (`demo_user_fixed_id`) is created with `isDemo: true`
- Data is copied from your account at a point in time and remains frozen
- Write operations (import, playlist creation, settings) are blocked with a user-friendly message
- The demo user has no Spotify tokens, so no sync workers will update the data

### Setting Up Demo Mode

1. **Seed the demo user with your data**:
    ```bash
    SOURCE_USER_ID=your_user_id npm run seed:demo
    ```
    To find your user ID, check `prisma studio` or query the users table.

2. **Seed without source data** (empty demo user):
    ```bash
    npm run seed:demo
    ```

### What Gets Copied
- Top tracks and artists (150 each)
- Track and artist stats
- Time bucket and hour stats
- Sample listening events (up to 1000)
- A completed import job example

### Refreshing Demo Data
Run the seed command again to update demo data with your latest stats:
```bash
SOURCE_USER_ID=your_user_id npm run seed:demo
```

### Credits

Written by Mohamed Ibrahim, formatted by Gemini.
