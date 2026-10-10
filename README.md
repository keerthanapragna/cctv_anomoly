# Hazard Response Platform

**AI-Based, Tamper-Resilient Multi-Hazard Campus Safety and Incident Accountability System**

---

## Architecture Overview

The system consists of two segregated layers:
- **`client/`**: React 19 + Vite dashboard styled with Tailwind CSS v4 and Lucide React.
- **`server/`**: Express.js application (Node.js ES Modules) with MongoDB (Mongoose ODM), Zod environment validation, Bcrypt password hashing, and JWT token rotation.

---

## Prerequisites

- **Node.js**: v20 or higher (v24 recommended)
- **MongoDB**: v6 or higher running locally or accessible via network URI

---

## Environment Setup

1. Copy the server environment template to create your local `.env`:
   ```bash
   cp server/.env.example server/.env
   ```
2. Configure your environment variables in `server/.env`:
   - `PORT`: Server port (default: `5000`)
   - `NODE_ENV`: `development` or `production`
   - `CLIENT_URL`: Client origin for CORS (e.g., `http://localhost:5173`)
   - `MONGODB_URI`: MongoDB connection string (e.g., `mongodb://127.0.0.1:27017/hazard_response`)
   - `JWT_SECRET`: High-entropy secret for access tokens
   - `JWT_EXPIRES_IN`: Access token lifetime (default: `15m`)
   - `REFRESH_TOKEN_SECRET`: High-entropy secret for refresh tokens
   - `REFRESH_TOKEN_EXPIRES_IN`: Refresh token lifetime (default: `7d`)
   - `INGEST_API_KEY`: Secret key for AI/Sensor webhook ingestion

> **Important:** Never commit `server/.env` or credentials to version control. The repository `.gitignore` automatically excludes environment files.

---

## Available Commands

Run these commands from the repository root (`D:\cctvproject\cctv_anomoly`):

### Development
```bash
# Start the frontend dashboard (Vite)
npm run dev

# Start the Express backend with live watcher
npm run dev:server
```

### Initial Administrator Provisioning
The system does not expose unrestricted public administrator registration. Provision the first admin using the CLI seed script:
```bash
npm run seed:admin
```
Alternatively, before any admin exists, you can call the one-time bootstrap endpoint `POST /api/v1/auth/bootstrap-admin`. Once an admin exists, this endpoint is permanently disabled.

### Automated Testing
Run the backend authentication and RBAC automated test suite:
```bash
npm run test:server
```

### Code Quality & Production Build
```bash
# Run ESLint on the frontend codebase
npm run lint:client

# Create production build of the frontend
npm run build:client
```

---

## Role-Based Access Control (RBAC)

The system enforces 5 institutional roles across all API endpoints:

| Role | Key Permissions |
| :--- | :--- |
| **Administrator (`ADMIN`)** | Full system configuration, user provisioning, policy definition, global audit access. |
| **Security Officer (`SECURITY_OFFICER`)** | Incident triage, field dispatch, status updates, camera/zone monitoring. |
| **Faculty / Assigned Staff (`FACULTY_STAFF`)** | Incident assignment acknowledgement, field resolution notes. |
| **Department Head (`DEPT_HEAD`)** | Department incident review, escalation handling, resolution sign-off. |
| **Higher Authority (`HIGHER_AUTHORITY`)** | High-level escalation interventions, campus-wide safety audits, emergency policies. |

---

## Authentication Endpoints

- `POST /api/v1/auth/login`: Authenticates credentials, returns short-lived access token, sets `httpOnly` refresh cookie.
- `POST /api/v1/auth/refresh`: Rotates refresh token and issues new access token.
- `POST /api/v1/auth/logout`: Clears session cookie and invalidates stored refresh token hash.
- `GET /api/v1/auth/me`: Retrieves authenticated user profile and permissions (requires `Bearer` token).
- `POST /api/v1/auth/register`: Admin-only endpoint for provisioning authorized staff.
- `GET /api/v1/users`: Lists authorized personnel filtered by role/department (`ADMIN`, `SECURITY_OFFICER`, `DEPT_HEAD`).

---

## Incident Management Endpoints

All endpoints require `Authorization: Bearer <token>` and enforce server-side resource scoping:

- `GET /api/v1/incidents`: Lists incidents scoped to authenticated principal's role and department.
- `POST /api/v1/incidents`: Creates a new incident with server-validated payload and server-assigned ID/timestamps.
- `GET /api/v1/incidents/:id`: Retrieves incident detail with cross-department access checks.
- `PATCH /api/v1/incidents/:id/status`: Updates incident status with strict state machine validation (`New` -> `Investigating` -> `Assigned` -> `Resolved` -> `Closed`).
- `PATCH /api/v1/incidents/:id/assign`: Assigns or reassigns incident with departmental authorization checks.
- `PATCH /api/v1/incidents/:id/acknowledge`: Records incident acknowledgement timestamp and assignee label.
- `PATCH /api/v1/incidents/:id/resolve`: Records resolution notes and timestamp.
- `POST /api/v1/incidents/:id/escalate`: Escalates incident across organizational tiers (`Tier 1 - Dept Head`, `Tier 2 - Security Chief`, `Tier 3 - Executive Board`).