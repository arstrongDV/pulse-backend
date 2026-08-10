# Pulse Backend

> **Listen Together. Anywhere.**

Backend for **Pulse**, a cross-platform synchronized audio application built for Android and iOS.

Pulse allows multiple people to join the same room and listen to synchronized audio using their own devices and headphones.

---

# 1. What is Pulse?

Pulse is a social audio synchronization platform.

The core idea is simple:

> Multiple devices should be able to play the same audio at approximately the same playback position at the same time.

Pulse is designed to work across:

```text
Android ↔ Android
Android ↔ iPhone
iPhone ↔ iPhone
```

The mobile client is built with Flutter.

The backend is built with NestJS.

---

# 2. The Problem

Existing solutions have platform and ecosystem limitations.

Examples include:

* Apple SharePlay;
* Samsung Dual Audio;
* Spotify Jam;
* other platform-specific synchronization systems.

Pulse aims to provide a cross-platform experience where users can join the same room regardless of their phone ecosystem.

The user should not have to care about the underlying networking technology.

---

# 3. Core Product Experience

The primary flow:

```text
                 ┌─────────────┐
                 │    Pulse    │
                 └──────┬──────┘
                        │
                  Create Room
                        │
                        ▼
                ┌──────────────┐
                │     Room     │
                │    ABC123    │
                └──────┬───────┘
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
           User A    User B    User C
             │         │         │
             └─────────┼─────────┘
                       ▼
                Synchronized
                   Playback
```

A host creates a room.

The backend generates a room identifier/code.

Other users join through:

* QR code;
* invite link;
* room code.

The host selects audio.

The host starts playback.

Pulse distributes the playback command and timing information to participants.

Every participant plays the audio locally.

---

# 4. Core MVP Features

## Authentication

* Email/password registration
* Login
* JWT access token
* Refresh token
* Logout
* Argon2id password hashing

Future:

* Google
* Apple

---

## Users

Users have:

* ID
* username
* email
* avatar
* account timestamps

Future:

* friends;
* social profile;
* activity;
* recently joined rooms.

---

# 5. Rooms

A room represents one shared listening session.

Users can:

* create a room;
* join a room;
* leave a room;
* retrieve room information;
* see participants;
* delete a room when authorized.

A room has:

```text
Host
Members
Current Track
Playback State
Playback Position
Room Settings
```

---

# 6. Room Roles

Current roles:

```text
HOST
MEMBER
```

The host controls playback.

The server must enforce this authorization.

The client cannot decide who is the host.

---

# 7. Room Joining

A room can be joined using:

### Room Code

Example:

```text
AB72KF
```

### Deep Link

Example:

```text
pulse://room/AB72KF
```

### QR Code

The Flutter application can convert the room information into a QR code.

The backend is responsible for validating the room identifier and permissions.

---

# 8. Synchronized Playback

Playback synchronization is the core technical feature of Pulse.

The backend does not simply broadcast:

```json
{
  "event": "play"
}
```

Instead, playback commands should contain timing information.

Example conceptual event:

```json
{
  "type": "PLAY",
  "trackId": "track-uuid",
  "positionMs": 0,
  "serverTimestamp": 1720000000000,
  "scheduledStartTimestamp": 1720000002500
}
```

The client estimates server time and calculates when playback should begin.

Conceptually:

```text
delay =
scheduledStartTimestamp
-
estimatedServerTime
```

This allows different clients to compensate for network latency.

---

# 9. Playback State

A room maintains authoritative playback state.

Conceptual state:

```typescript
{
  trackId: string;
  state: "PLAYING" | "PAUSED" | "STOPPED";
  positionMs: number;
  playbackRate: number;
  updatedAt: Date;
  scheduledAt?: Date;
}
```

The exact implementation may evolve.

Do not write playback position to PostgreSQL continuously while audio is playing.

Use persistent storage for durable state and Redis/realtime infrastructure for ephemeral state where necessary.

---

# 10. Control Plane vs Media Plane

This distinction is extremely important.

## Control Plane

Pulse backend manages:

```text
PLAY
PAUSE
SEEK
TRACK_CHANGED
ROOM_JOINED
ROOM_LEFT
PRESENCE
CHAT
```

## Media Plane

The actual audio bytes are a separate concern.

```text
Audio file
    ↓
Object storage / streaming
    ↓
Flutter audio player
```

Do not turn the NestJS API into a high-bandwidth audio proxy without a deliberate architectural decision.

---

# 11. Audio MVP

The initial product should support audio that Pulse is legally allowed to distribute.

Examples:

* user-uploaded audio where the user has the required rights;
* properly licensed/royalty-free audio;
* other explicitly supported legal sources.

Do not:

* scrape Spotify;
* download YouTube audio;
* bypass DRM;
* redistribute copyrighted music without appropriate rights.

Future integrations can be designed separately.

---

# 12. Room Chat

Each room can contain a simple realtime chat.

Example:

```text
Alex:
This song is amazing 🔥

John:
YES

Maria:
😂
```

Chat messages belong to a room and sender.

Authorization must verify that the sender is currently allowed to interact with the room.

---

# 13. Participants

The room should expose participant information such as:

```text
Username
Avatar
Role
Online / Offline
Connection status
```

Future:

```text
Latency
Buffer state
Device information
```

Do not expose unnecessary technical information to other users.

---

# 14. Architecture

High-level architecture:

```text
                    ┌────────────────────┐
                    │   Flutter Clients  │
                    │    iOS / Android   │
                    └─────────┬──────────┘
                              │
                    HTTPS / Realtime
                              │
                              ▼
                    ┌────────────────────┐
                    │      NestJS        │
                    │                    │
                    │ Auth               │
                    │ Users              │
                    │ Rooms              │
                    │ Playback           │
                    │ Tracks              │
                    │ Chat               │
                    └──────┬─────┬───────┘
                           │     │
                 ┌─────────┘     └──────────┐
                 ▼                          ▼
          ┌─────────────┐             ┌──────────┐
          │ PostgreSQL  │             │  Redis   │
          │             │             │          │
          │ Persistent  │             │ Realtime │
          │ Data        │             │ State    │
          └─────────────┘             └──────────┘
                                           
                             
                    ┌────────────────────┐
                    │ Object Storage     │
                    │ S3 / Cloudflare R2 │
                    └────────────────────┘
```

---

# 15. Technology Stack

## Backend

* Node.js
* TypeScript
* NestJS

## Database

* PostgreSQL
* Prisma ORM

## Realtime

* WebSocket / Socket.IO

A managed realtime service such as Ably may be introduced if it provides a clear operational advantage.

The application should not tightly couple domain logic to the realtime provider.

## Cache

* Redis

## Storage

* AWS S3
* Cloudflare R2

## Authentication

* JWT
* Refresh tokens
* Argon2id

## Security

* Helmet
* Rate limiting
* DTO validation
* CORS
* Arcjet where appropriate

## Documentation

* Swagger / OpenAPI

## Testing

* Jest
* NestJS testing utilities
* E2E tests

## Infrastructure

* Docker
* Docker Compose
* GitHub Actions
* Nginx

---

# 16. Backend Domain Modules

Recommended modules:

```text
src/
├── auth/
├── users/
├── rooms/
├── playback/
├── tracks/
├── messages/
├── realtime/
├── storage/
├── health/
├── config/
├── common/
└── prisma/
```

---

# 17. Database

The main domain entities are:

```text
User
UserDevice
Room
RoomMember
Track
RoomPlaylist
PlaybackEvent
Message
RefreshToken
Notification
WebSocketSession
RTCConnection
AnalyticsEvent
```

The schema should evolve through Prisma migrations.

PostgreSQL is the persistent source of truth.

Redis is not a replacement for PostgreSQL.

---

# 18. API

Initial API surface:

```http
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

GET    /users/me
PATCH  /users/me

POST   /rooms
GET    /rooms/:roomId
POST   /rooms/:roomId/join
POST   /rooms/:roomId/leave
DELETE /rooms/:roomId

GET    /rooms/:roomId/participants

POST   /rooms/:roomId/playback/play
POST   /rooms/:roomId/playback/pause
POST   /rooms/:roomId/playback/seek

GET    /rooms/:roomId/messages
POST   /rooms/:roomId/messages
```

This API is a starting point, not a rigid contract.

---

# 19. Security Requirements

Security must be implemented from the beginning.

Required:

* Argon2id;
* JWT;
* refresh token rotation/revocation;
* HTTPS in production;
* DTO validation;
* authorization guards;
* rate limiting;
* Helmet;
* secure CORS;
* input sanitization where required;
* secure secret management;
* database constraints;
* safe error responses.

Never log:

```text
password
access token
refresh token
JWT secret
database password
private storage credentials
```

---

# 20. Development Principles

Pulse should be built as:

> Production-quality architecture + MVP-level scope.

This means:

### Do

* write maintainable code;
* test business logic;
* use strong typing;
* validate input;
* enforce authorization;
* document decisions;
* keep modules independent;
* use migrations;
* consider concurrency.

### Don't

* overengineer;
* build microservices prematurely;
* add unnecessary dependencies;
* duplicate business logic;
* put everything in one service;
* expose database models directly through API;
* trust client-side authorization;
* store large audio files in PostgreSQL.

---

# 21. Development Order

Recommended implementation order:

```text
Phase 1
Project Bootstrap
    ↓
Phase 2
Configuration + Environment
    ↓
Phase 3
PostgreSQL + Prisma
    ↓
Phase 4
Authentication
    ↓
Phase 5
Users
    ↓
Phase 6
Rooms
    ↓
Phase 7
Room Membership
    ↓
Phase 8
Realtime Layer
    ↓
Phase 9
Playback State
    ↓
Phase 10
Audio / Storage
    ↓
Phase 11
Chat
    ↓
Phase 12
Security Hardening
    ↓
Phase 13
Testing
    ↓
Phase 14
Docker
    ↓
Phase 15
CI/CD
```

Do not implement all phases simultaneously.

---

# 22. MVP Success Criteria

The MVP should allow:

* users to register and authenticate;
* users to create rooms;
* users to join rooms;
* users to invite participants;
* users to see room participants;
* the host to control playback;
* participants to receive synchronized playback commands;
* users to communicate through room chat;
* audio to be retrieved from legitimate sources;
* Android and iOS clients to use the same backend.

Target:

> Average playback drift below approximately 100 ms under normal network conditions.

Target initial room size:

> At least 20 concurrent participants.

These are engineering goals, not guarantees across all devices and network conditions.

---

# 23. Future Product Features

Do not implement these in the MVP unless explicitly requested:

* voice chat;
* video synchronization;
* desktop applications;
* Apple TV;
* Android TV;
* Apple Watch;
* Wear OS;
* AI DJ;
* collaborative queue voting;
* offline LAN mode;
* enterprise workspaces;
* subscriptions.

The architecture should allow these features later without forcing the MVP to implement them now.

---

# 24. Product Vision

Pulse should eventually become a universal platform for shared real-time audio experiences.

Potential future use cases:

```text
Music
Podcasts
Audiobooks
Movies
Live events
Education
Museums
Guided tours
Gaming
Enterprise collaboration
```

The long-term product should not depend on one specific music provider.

The fundamental abstraction is:

> **Synchronized shared media experiences.**

---

# 25. Backend Definition of Done

The backend is not considered complete merely because:

```text
npm run start
```

works.

A feature is complete when:

* implementation works;
* database changes are migrated;
* input is validated;
* authorization is enforced;
* errors are handled;
* tests exist;
* lint passes;
* type checking passes;
* API documentation is updated;
* security implications have been considered.

---

# 26. First Task

Start by creating the NestJS backend foundation.

Do not implement rooms, playback, chat, or audio yet.

First establish:

```text
NestJS
TypeScript
Configuration
Environment validation
Global validation pipe
Global exception handling
Structured logging
Prisma
PostgreSQL
Health check
Swagger
Basic project structure
ESLint
Prettier
Jest
```

Then verify:

```bash
npm run build
npm run lint
npm run test
```

Only after the foundation is stable should authentication be implemented.
