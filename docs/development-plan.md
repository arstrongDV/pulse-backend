# Pulse Backend — Development Plan

## Purpose

This document defines the implementation sequence for the Pulse backend.

Claude Code must follow this sequence unless there is a technically justified reason to change it.

The goal is to build Pulse incrementally and keep the repository working after every phase.

---

# Phase 0 — Repository Inspection

Before writing code:

1. Inspect the repository.
2. Determine whether a NestJS project already exists.
3. Inspect `package.json`.
4. Inspect existing source files.
5. Inspect Git configuration.
6. Check available environment files.
7. Check whether PostgreSQL/Redis/Docker already exist.
8. Identify existing conventions.

Do not overwrite existing work without understanding it.

---

# Phase 1 — Backend Foundation

Create:

```text
NestJS
TypeScript
ESLint
Prettier
Jest
ConfigModule
Environment validation
Global ValidationPipe
Exception handling
Logging
Swagger
Health endpoint
```

Expected result:

```http
GET /health
```

returns a healthy response.

Verify:

```bash
npm run build
npm run lint
npm run test
```

---

# Phase 2 — Database

Introduce:

```text
PostgreSQL
Prisma
```

Create the initial schema.

Start with the minimum required domain:

```text
User
RefreshToken
Room
RoomMember
```

Do not create every future entity immediately.

Create a migration.

Run:

```bash
npx prisma migrate dev
npx prisma generate
```

Add seed data only if useful for development.

---

# Phase 3 — Authentication

Implement:

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET /users/me
```

Requirements:

* Argon2id;
* JWT;
* refresh tokens;
* validation;
* authentication guard;
* authorization foundation.

Tests:

```text
register succeeds
duplicate email fails
invalid password fails
login succeeds
login fails
access token works
refresh works
revoked refresh token fails
```

---

# Phase 4 — Rooms

Implement:

```text
POST /rooms
GET /rooms/:id
POST /rooms/:id/join
POST /rooms/:id/leave
DELETE /rooms/:id
```

Requirements:

* authenticated users only;
* host assignment;
* unique room code;
* membership validation;
* room capacity;
* correct authorization.

Test:

```text
user creates room
user joins room
duplicate membership fails
unauthorized user cannot modify room
host can delete room
member cannot delete room
```

---

# Phase 5 — Realtime

Introduce the realtime architecture.

Requirements:

* room channels;
* authenticated connections;
* room membership authorization;
* join event;
* leave event;
* presence;
* disconnect handling.

Do not implement playback yet.

First prove:

```text
User A connects
User B connects
User A joins room
User B receives event
User A disconnects
User B receives event
```

---

# Phase 6 — Playback Engine

This is the most important engineering phase.

Design an explicit playback state machine.

Example:

```text
STOPPED
   │
   ▼
PLAYING
   │
   ▼
PAUSED
   │
   ▼
PLAYING
```

Implement:

```text
PLAY
PAUSE
SEEK
TRACK_CHANGED
```

The server must maintain authoritative state.

Playback events should include timing information.

Do not rely on immediate client execution.

---

# Phase 7 — Audio Storage

Introduce object storage.

Possible providers:

```text
AWS S3
Cloudflare R2
```

Implement:

```text
upload initialization
upload completion
track metadata
track retrieval
```

Do not stream large audio files through NestJS unless explicitly required.

Use signed URLs where appropriate.

---

# Phase 8 — Room Chat

Implement:

```text
GET /rooms/:id/messages
POST /rooms/:id/messages
```

and realtime message delivery.

Requirements:

* room membership;
* message validation;
* message length limits;
* rate limiting;
* authorization.

---

# Phase 9 — Security

Review the entire backend.

Check:

```text
Authentication
Authorization
Rate limiting
CORS
Helmet
Validation
Error handling
Logging
Secrets
Database permissions
Storage URLs
```

Add Arcjet if appropriate.

Perform abuse-case analysis:

```text
Can an attacker join arbitrary rooms?

Can a member control playback?

Can a user impersonate another user?

Can a user access another user's private track?

Can a user spam a room?

Can a user brute-force room codes?

Can a user brute-force login?

Can a revoked token still access the API?
```

---

# Phase 10 — Testing

Create a complete test suite for critical business logic.

Prioritize:

```text
Auth
Rooms
Membership
Authorization
Playback state
Realtime authorization
Storage permissions
Chat
```

Then add E2E flows.

---

# Phase 11 — Docker

Create:

```text
Dockerfile
docker-compose.yml
```

Local services:

```text
PostgreSQL
Redis
NestJS
```

The application should start consistently from a clean environment.

---

# Phase 12 — CI

GitHub Actions should run:

```text
Install
Lint
Typecheck
Unit tests
Build
```

Later:

```text
E2E tests
Docker build
Deployment
```

---

# Phase 13 — Production Hardening

Before public beta:

* production environment configuration;
* HTTPS;
* secure cookies/tokens where applicable;
* database backups;
* monitoring;
* error tracking;
* structured logs;
* rate limits;
* health checks;
* graceful shutdown;
* database connection handling;
* Redis failure handling.

---

# Engineering Rule

After every phase:

```text
Build
↓
Lint
↓
Test
↓
Review
↓
Commit
↓
Next phase
```

Never continue through multiple broken phases.

---

# AI Agent Rule

Claude must not implement the entire roadmap in one response or one uncontrolled operation.

For each phase:

1. Explain what will be changed.
2. Inspect existing code.
3. Implement the phase.
4. Run tests.
5. Fix failures.
6. Review the implementation.
7. Summarize the result.
8. Wait for the next instruction if the phase is complete.

The goal is controlled engineering, not maximum code generation.
