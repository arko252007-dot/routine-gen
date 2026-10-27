# Routine Gen: Backend + Login Build Plan

Last updated: 2026-09-29
Audience: anyone who can follow instructions. No prior backend knowledge needed.

**Goal:** any college can sign up, enter its data once per semester, publish routines, and let teachers log in to see their own classes on their phone.

---

## Table of contents

1. [What we are building](#1-what-we-are-building)
2. [Words you will see (glossary)](#2-glossary)
3. [Technologies and where each is used](#3-technologies-and-where-each-is-used)
4. [Architecture](#4-architecture)
5. [Folder structure](#5-folder-structure)
6. [Database design](#6-database-design)
7. [API endpoints](#7-api-endpoints)
8. [Build instructions](#8-build-instructions) (Phase 0 to Phase 8)
9. [Two-college security test](#9-two-college-security-test)
10. [Deployment](#10-deployment)
11. [Master checklist](#11-master-checklist)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. What we are building

Today Routine Gen is a browser-only tool: everything lives in session storage and disappears when the session ends. We are adding:

- A **backend** (a server program) that stores data in a database.
- **Accounts**: admins sign up, teachers get invited, everyone logs in with email + password.
- **Saved data**: departments, semesters, subjects, teachers are saved to the cloud.
- **Published routines** with history, automatic deletion after 1 year.
- **Teacher phone view**: a teacher logs in and sees only their own weekly classes.
- **Replace teacher** in an existing routine (mid-semester leave).
- **Timing change requests** from teachers, approved by admin.

**The scheduling engine does not move.** It stays in the browser exactly as it is. The backend only stores and serves data (and double-checks for clashes before publishing).

### Roles

| Role | Can do |
|---|---|
| `admin` | Enter all data, generate, publish, invite teachers and other admins, approve requests, replace teachers. A college can have several admins. An admin who also teaches can be linked to a teacher record and see their own schedule. |
| `teacher` | Log in, see own schedule (read-only), submit timing change requests. |

---

## 2. Glossary

| Word | Plain meaning |
|---|---|
| **Backend / API** | A program running on a server. The browser sends it requests ("give me my departments"), it answers with data. |
| **Endpoint** | One address on the API, like `POST /auth/login`. |
| **Database** | Where data is stored permanently. We use MongoDB. |
| **Collection / document** | MongoDB words. A collection is like a table (`users`). A document is like one row (one user). |
| **Hash** | A one-way scramble. We store scrambled passwords so even we cannot read them. |
| **JWT** | A signed "ID card" text the server gives you after login. The browser sends it with every request to prove who you are. |
| **Token (invite/reset)** | A long random secret in a link, used once. We store only its hash. |
| **Multi-tenant** | Many colleges share one database, but each must only see its own data. We enforce this with `collegeId`. |
| **TTL index** | A MongoDB feature that deletes documents automatically after a date. |
| **CORS** | A browser safety rule. The API must explicitly allow your frontend's website address. |
| **Environment variable** | A secret setting (like the database password) kept outside the code, in a `.env` file or the hosting dashboard. |
| **Middleware** | A small function that runs before your route (for example "check the user is logged in"). |
| **Validation** | Checking incoming data has the right shape before using it. We use `zod`. |

---

## 3. Technologies and where each is used

| Technology | What it does | Where it lives | Why this one |
|---|---|---|---|
| **HTML / CSS / vanilla JS (ES modules)** | The website (existing wizard + new login/teacher pages) | `frontend/` | Already what Routine Gen uses. No rewrite. |
| **Bootstrap 5** | Styling and layout | `frontend/` (CDN link in each page) | Already in use. |
| **SheetJS (xlsx)** | Excel import/export | `frontend/` (already used) | Already in use. |
| **Node.js (current LTS, v22+)** | Runs JavaScript on the server | `backend/` | Same language as the frontend. |
| **Express 5** | Web framework: routes, middleware | `backend/src/app.js`, `routes/` | Simplest, most documented. v5 forwards async errors automatically. |
| **MongoDB Atlas (free M0)** | Cloud database | Atlas website | Free, no server to run, supports TTL and transactions. |
| **Mongoose 8** | Defines document shapes and talks to MongoDB | `backend/src/models/` | Schemas, defaults, indexes in one place. |
| **bcryptjs** | Hashes passwords | `backend/src/controllers/auth.controller.js` | Pure JavaScript, so it installs everywhere with no build errors (the native `bcrypt` package can fail on hosts). |
| **jsonwebtoken** | Creates and checks login tokens | `backend/src/utils/jwt.js`, `middleware/auth.js` | Standard. |
| **zod** | Validates every input, and the `.env` file | `backend/src/validators/`, `config/env.js` | Clear error messages, small. |
| **cors** | Allows only your frontend site to call the API | `backend/src/app.js` | Required for two different domains. |
| **helmet** | Adds safe HTTP headers | `backend/src/app.js` | One line, real protection. |
| **express-rate-limit** | Stops password-guessing and spam | `backend/src/routes/auth.routes.js` | Required for login/forgot/invite. |
| **Brevo (or Resend)** | Sends emails (verify, reset) | `backend/src/services/email.js` | Free tier. Brevo lets you send from one verified address without owning a domain. Check current free limits on their site. The code is written so you can swap providers. |
| **Render** (or Railway) | Hosts the API | Render dashboard | Free tier, deploys from GitHub. Free services sleep when idle (first request can take ~1 min). |
| **Vercel** | Hosts the frontend | Vercel dashboard (already used) | Already set up. |
| **Git + GitHub** | Version control and deploy trigger | Repo root | Already used. |
| **Thunder Client / Postman / curl** | Test the API without a website | Your machine | Lets you test the backend before any frontend exists. |
| **Service Worker + manifest.json** | PWA install + offline fallback | `frontend/sw.js`, `manifest.json` | Already in the repo. |

**Not used (on purpose):** no React/Vue rewrite, no TypeScript, no ORM other than Mongoose, no Redux. Keep it simple enough to read every line.

---

## 4. Architecture

```
 Browser (Vercel)                       API (Render)                 Database (Atlas)
 ┌──────────────────────┐   HTTPS +    ┌──────────────────────┐     ┌──────────────┐
 │ Wizard UI            │   JWT        │ Express routes       │     │ colleges     │
 │ Scheduling engine    │ ───────────► │  → middleware        │ ──► │ users        │
 │ Login / teacher pages│ ◄─────────── │  → validators (zod)  │ ◄── │ tokens       │
 │ Service worker (PWA) │   JSON       │  → controllers       │     │ departments  │
 └──────────────────────┘              │  → Mongoose models   │     │ teachers     │
                                       └──────────────────────┘     │ timetables   │
                                                 │                  │ entries      │
                                                 ▼                  │ requests     │
                                          Brevo (emails)            └──────────────┘
```

**Request life cycle (every request):**
1. Browser sends `Authorization: Bearer <JWT>`.
2. `requireAuth` middleware verifies the JWT, loads the user from the database, and checks the user is still `active` and the token version matches.
3. `requireRole('admin')` middleware checks the role if the route needs it.
4. A zod schema validates the body.
5. The controller runs the query. **Every query includes `collegeId` taken from the logged-in user, never from the request body or URL.**
6. JSON response. Errors go to one central error handler.

---

## 5. Folder structure

### 5.1 Whole repository

```
routine-gen/
├── README.md                  (keep, update later)
├── .gitignore                 (node_modules, .env, .DS_Store)
├── docs/
│   └── BUILD_PLAN.md          (this file)
├── backend/                   (NEW: the API)
└── frontend/                  (your existing site, moved here)
```

### 5.2 `backend/`

```
backend/
├── package.json
├── .env                       (secrets, never committed)
├── .env.example               (same keys, fake values, committed)
├── .gitignore
└── src/
    ├── server.js              starts the app + connects to the database
    ├── app.js                 builds Express: helmet, cors, json, routes, errors
    ├── config/
    │   ├── env.js             reads + validates .env with zod
    │   └── db.js              connects Mongoose to Atlas
    ├── models/
    │   ├── College.js
    │   ├── User.js
    │   ├── Token.js           invite / reset / verify tokens
    │   ├── Department.js      semesters + subjects embedded
    │   ├── Teacher.js
    │   ├── Timetable.js
    │   ├── TimetableEntry.js
    │   └── ChangeRequest.js
    ├── middleware/
    │   ├── auth.js            requireAuth, requireRole
    │   ├── validateId.js      rejects malformed ObjectIds
    │   └── error.js           notFound + errorHandler
    ├── validators/            zod schemas (one file per area)
    │   ├── auth.schema.js
    │   ├── department.schema.js
    │   ├── teacher.schema.js
    │   ├── timetable.schema.js
    │   └── request.schema.js
    ├── controllers/           the actual logic
    │   ├── auth.controller.js
    │   ├── department.controller.js
    │   ├── teacher.controller.js
    │   ├── import.controller.js
    │   ├── timetable.controller.js
    │   ├── replaceTeacher.controller.js
    │   ├── schedule.controller.js      (/me/schedule)
    │   └── request.controller.js
    ├── routes/
    │   ├── index.js           mounts every router
    │   ├── auth.routes.js
    │   ├── department.routes.js
    │   ├── teacher.routes.js
    │   ├── import.routes.js
    │   ├── timetable.routes.js
    │   ├── me.routes.js
    │   └── request.routes.js
    ├── services/
    │   ├── email.js           sendEmail(); prints to console if no API key
    │   └── clash.js           findTeacherClashes(), availability checks
    └── utils/
        ├── AppError.js
        ├── tokens.js          newToken(), hashToken()
        ├── jwt.js             signToken()
        └── time.js            "09:30" <-> minutes since midnight
```

**Rule of thumb:** routes say *which URL and who*, validators say *what shape*, controllers say *what happens*, models say *how it is stored*, services hold reusable logic.

### 5.3 `frontend/`

Files marked *(existing)* are yours. I could not see inside your `js/` folder, so keep your current files untouched and only add the new ones.

```
frontend/
├── index.html                 (existing) the wizard + generator
├── help.html                  (existing)
├── json-import.html           (existing)
├── manifest.json              (existing) PWA manifest
├── sw.js                      (existing) service worker
├── favicon.svg, robots.txt, sitemap.xml, llms*.txt   (existing)
├── vercel.json                (NEW) rewrites for /invite/<token> etc.
│
├── login.html                 (NEW) email + password, all roles
├── signup.html                (NEW) admin creates a college
├── verify.html                (NEW) opened from the verify-email link
├── forgot.html                (NEW) ask for a reset link
├── reset.html                 (NEW) set a new password from the link
├── invite.html                (NEW) teacher sets password from invite link
├── teacher.html               (NEW) mobile weekly schedule + request form
├── history.html               (NEW) admin: drafts, published, replace teacher
├── requests.html              (NEW) admin: pending timing requests
│
├── assets/ icons/             (existing)
├── css/
│   ├── (existing files)
│   ├── auth.css               (NEW)
│   └── teacher.css            (NEW)
└── js/
    ├── (existing engine + wizard files, untouched)
    ├── config.js              (NEW) API_BASE_URL (local vs production)
    ├── api/
    │   ├── client.js          (NEW) one fetch wrapper used by everything
    │   ├── auth.api.js        (NEW)
    │   ├── data.api.js        (NEW) departments, teachers, imports
    │   ├── timetables.api.js  (NEW)
    │   └── requests.api.js    (NEW)
    ├── auth/
    │   ├── session.js         (NEW) save/read/clear token + user
    │   └── guard.js           (NEW) redirect if not logged in / wrong role
    ├── data/
    │   └── store.js           (NEW) adapter: same functions your wizard uses today,
    │                                 backed by sessionStorage (guest) or the API (logged in)
    └── pages/                 (NEW) one small script per new html page
        ├── login.js  signup.js  verify.js  forgot.js  reset.js  invite.js
        └── teacher.js  history.js  requests.js
```

---

## 6. Database design

### 6.1 Golden rules

1. Every collection except `colleges` has a `collegeId`.
2. MongoDB has no built-in row-level security. **Separation between colleges exists only because our code adds `collegeId` to every query.**
3. `collegeId` always comes from the JWT (`req.user.collegeId`), never from `req.body` or `req.params`.
4. Any ID sent by the client that points to another document (teacherId, subjectId, ...) must be checked to belong to the same college before use.
5. Times inside timetable entries are stored as **minutes since midnight** (9:30 AM = 570). Clash checks compare these numbers, never period numbers.

### 6.2 Relationships

```
colleges 1 ──< users
colleges 1 ──< departments (semesters[ subjects[] ] embedded)
colleges 1 ──< teachers ──< teaches[] points to department/semester/subject ids
colleges 1 ──< timetables 1 ──< timetableEntries
users ──< tokens                     users.teacherId → teachers._id
teachers ──< changeRequests
```

### 6.3 Collections

**colleges**
```js
{
  _id, name,
  settings: {                       // wizard step 1 "Settings" defaults
    periodsPerDay, periodMinutes, startTime: "09:00", tiffinAfterPeriod
  },
  createdAt, updatedAt
}
```

**users**
```js
{
  _id, collegeId, name,
  email,                            // unique across the whole system, lowercase
  passwordHash,                     // select:false, never returned by the API
  role: "admin" | "teacher",
  status: "invited" | "active" | "left",
  emailVerified: Boolean,           // admins must verify before login
  teacherId,                        // set for teachers; ALSO allowed on admins who teach
  tokenVersion: Number,             // starts 0; +1 on password reset or when teacher leaves
  createdAt, updatedAt
}
```
`tokenVersion` is what makes "disable their login" real. A JWT contains the version; if it no longer matches, the token is dead even if unexpired.

**tokens** (invite, reset, verify links)
```js
{
  _id, userId,
  type: "invite" | "reset" | "verify",
  tokenHash,                        // SHA-256 of the random secret in the link
  usedAt,                           // null until used
  expiresAt                         // TTL index deletes the doc after this
}
```
Lifetimes: invite 7 days, reset 1 hour, verify 24 hours.

**departments**
```js
{
  _id, collegeId, name,
  semesters: [{
    _id, name,                      // "Sem 3"
    periodsPerDay, periodMinutes, startTime: "09:00",
    subjects: [{
      _id, name,
      classType: "theory" | "theory_extended" | "lab" | "lab_extended" | "theory_lab",
      periodsPerWeek
    }]
  }],
  createdAt, updatedAt
}
```
(Map these `classType` values to whatever strings your frontend uses today.)

**teachers**
```js
{
  _id, collegeId, name, email,
  status: "active" | "left",
  workingDays: ["Mon","Tue"],
  availableFrom: "10:00", availableTo: "14:00",   // optional window
  teaches: [{ departmentId, semesterId, subjectId }],
  createdAt, updatedAt
}
```

**timetables**
```js
{
  _id, collegeId, label,            // "Even Semester 2026"
  status: "draft" | "published" | "archived",
  createdBy, createdAt, publishedAt,
  expiresAt,                        // createdAt + 365 days, TTL index
  entryCount,
  changeLog: [{ type: "teacher_replaced", oldTeacherId, newTeacherId, oldName, newName, at, by }]
}
```
Design decision: when a new routine is published, the previously published one becomes `archived` so teachers always see exactly one current routine. Archived routines stay in History until they expire.

**timetableEntries**
```js
{
  _id, collegeId, timetableId,
  departmentId, semesterId, day, period, startMin, endMin,
  subjectId, teacherId, isFiller, fillerLabel,
  // snapshots, so old routines and PDFs still read correctly after edits or deletions:
  departmentName, semesterName, subjectName, teacherName, classType,
  expiresAt                         // same as the timetable, TTL index
}
```

**changeRequests**
```js
{
  _id, collegeId, teacherId,
  requestedDays: [...], requestedFrom, requestedTo,
  reason,
  status: "pending" | "approved" | "rejected",
  adminNote, createdAt, decidedAt, decidedBy
}
```
v1 rule: an approved request **permanently** changes the teacher's availability. There are no date ranges in v1. (Date-limited exceptions can be added later as a separate `availabilityExceptions` collection.)

### 6.4 Indexes

| Collection | Index | Purpose |
|---|---|---|
| users | `{ email: 1 }` unique | one account per email |
| users | `{ collegeId: 1 }` | list a college's users |
| tokens | `{ tokenHash: 1 }` unique | find a link's token |
| tokens | `{ expiresAt: 1 }` with `expireAfterSeconds: 0` | auto-delete expired |
| departments, teachers, changeRequests | `{ collegeId: 1 }` | tenant filter |
| timetables | `{ collegeId: 1, status: 1 }`, TTL on `expiresAt` | history + retention |
| timetableEntries | `{ timetableId: 1, teacherId: 1 }`, TTL on `expiresAt` | teacher schedule |

TTL notes: MongoDB's background job runs about once a minute, so deletion is "soon after" the date, not to the second. Setup data (departments, teachers, users) is never auto-deleted.

### 6.5 What happens on delete

| Action | Rule |
|---|---|
| Delete department/semester/subject | Also remove matching entries from every teacher's `teaches` (`$pull`). Old routines are unaffected because entries store name snapshots. |
| Delete a teacher who appears in any timetable entry | Refuse. Tell the admin to use **Replace teacher** or mark as `left`. |
| Delete a teacher with no entries | Allowed. Also delete their invited user. |
| Teacher leaves | `teacher.status = "left"`, `user.status = "left"`, `user.tokenVersion += 1`. |

---

## 7. API endpoints

Send `Authorization: Bearer <token>` on everything except the public ones.

| Method | Route | Who | Body / notes |
|---|---|---|---|
| POST | `/auth/register` | public | `{ collegeName, name, email, password }` creates college + admin, sends verify email |
| POST | `/auth/verify-email` | public | `{ token }` |
| POST | `/auth/resend-verify` | public | `{ email }` always answers OK |
| POST | `/auth/login` | public | `{ email, password }` returns `{ token, user }` |
| POST | `/auth/forgot` | public | `{ email }` always answers "If this email exists, a link was sent" |
| POST | `/auth/reset` | public | `{ token, password }` |
| GET | `/auth/invite/:token` | public | returns `{ name }` only |
| POST | `/auth/accept-invite` | public | `{ token, password }` activates + logs in |
| GET | `/me` | any | current user + college name |
| POST | `/teachers/:id/invite` | admin | returns `{ link, expiresAt }`; regenerating kills the old link |
| POST | `/admins/invite` | admin | `{ name, email }` returns link (second admin) |
| GET/POST/PUT/DELETE | `/departments`, `/departments/:id` | admin | full department with semesters + subjects |
| GET/POST/PUT/DELETE | `/teachers`, `/teachers/:id` | admin | |
| GET/PUT | `/college/settings` | admin | wizard step 1 defaults |
| POST | `/import/excel`, `/import/json` | admin | parsed rows sent as JSON; server validates + saves |
| GET | `/timetables` | admin | history list with `daysLeft` |
| GET | `/timetables/:id` | admin | with entries |
| POST | `/timetables` | admin | save draft `{ label, entries[] }` |
| PUT | `/timetables/:id` | admin | replace a draft's entries |
| POST | `/timetables/:id/publish` | admin | server re-checks clashes first |
| DELETE | `/timetables/:id` | admin | |
| POST | `/timetables/:id/replace-teacher` | admin | `dryRun: true` previews clashes |
| GET | `/me/schedule` | teacher (or admin with teacherId) | own entries of the published routine |
| POST | `/requests` | teacher | timing change request |
| GET | `/requests` | admin | pending list |
| POST | `/requests/:id/decide` | admin | `{ decision, adminNote }` |
| GET | `/health` | public | `{ ok: true }` |

Error format is always `{ "error": "message" }`. Validation errors also include `details`.

---

## 8. Build instructions

Work in order. Each phase ends with a **Done when** test. Do not start the next phase until it passes.

### Phase 0: Accounts and tools (about 1 hour)

1. Install **Node.js LTS** (v22 or newer) from nodejs.org. Check: open a terminal and run `node -v`. It must print v22 or higher.
2. Install **Git** and **VS Code**. In VS Code install the extension **Thunder Client** (for testing the API).
3. Create free accounts: **MongoDB Atlas**, **Render**, **Brevo** (email). You already have GitHub and Vercel.
4. In your terminal, go to your project folder: `cd path/to/routine-gen`.

**Done when:** `node -v` and `git --version` both print versions.

---

### Phase 1: Repo restructure, backend skeleton, auth

#### Step 1.1 Move the site into `frontend/`

Work on a branch so the live site (used by your college) is not disturbed.

```bash
git checkout -b backend-and-login
mkdir frontend backend docs
git mv assets css icons js index.html help.html json-import.html manifest.json sw.js favicon.svg robots.txt sitemap.xml llms.txt llms-full.txt frontend/
git commit -m "Move site into frontend/"
```

Copy this file to `docs/BUILD_PLAN.md`.

**Important:** Vercel currently deploys from the repo root. After this move it will find nothing there. Keep this on the branch (Vercel makes a separate preview link). Right before merging to `main`, open Vercel → your project → Settings → Build & Deployment → **Root Directory** and set it to `frontend`.

Add a root `.gitignore`:
```
node_modules/
.env
.DS_Store
```

#### Step 1.2 Create the Atlas database

1. Atlas → **Create** a free **M0** cluster (any region near you).
2. **Database Access** → Add a database user. Choose a username, click *Autogenerate Secure Password*, copy it somewhere safe.
3. **Network Access** → Add IP Address → `0.0.0.0/0` (allow from anywhere). Render's free tier has changing IPs, so this is needed. The strong password and TLS protect you. Never reuse this password elsewhere.
4. **Database** → *Connect* → *Drivers* → copy the connection string. It looks like `mongodb+srv://USER:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`.
5. Replace `<password>` with your password (URL-encode special characters) and add the database name before the `?`: `.../routinegen?retryWrites=true&w=majority`.

#### Step 1.3 Initialize the backend

```bash
cd backend
npm init -y
npm install express mongoose bcryptjs jsonwebtoken cors helmet zod express-rate-limit
mkdir -p src/config src/models src/middleware src/validators src/controllers src/routes src/services src/utils
```

Open `package.json` and set:
```json
{
  "name": "routine-gen-api",
  "version": "1.0.0",
  "type": "module",
  "main": "src/server.js",
  "scripts": {
    "dev": "node --env-file=.env --watch src/server.js",
    "start": "node src/server.js"
  }
}
```
(`"type": "module"` lets us use `import`. `--env-file` loads `.env` without extra packages. `--watch` restarts on save.)

Create `backend/.gitignore` containing `node_modules` and `.env`.

Create `backend/.env` (real values) and `backend/.env.example` (same keys, fake values):
```
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/routinegen?retryWrites=true&w=majority
JWT_SECRET=paste-a-long-random-string-here
FRONTEND_URL=http://localhost:5500
EMAIL_API_KEY=
EMAIL_FROM=you@example.com
```
Generate a secret with: `node -p "require('crypto').randomBytes(48).toString('hex')"` and paste the output as `JWT_SECRET`.

`FRONTEND_URL` is the address you open the site on locally (VS Code Live Server usually uses `http://127.0.0.1:5500`; use exactly what your browser shows). You may list several separated by commas.

#### Step 1.4 Core files

**`src/config/env.js`** (refuses to start if a setting is missing, so you notice immediately)
```js
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  FRONTEND_URL: z.string().min(1),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

export const env = schema.parse(process.env);
```

**`src/config/db.js`**
```js
import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  await mongoose.connect(env.MONGODB_URI);
  console.log('MongoDB connected');
}
```

**`src/utils/AppError.js`**
```js
export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
```

**`src/middleware/error.js`**
```js
export const notFound = (req, res) => res.status(404).json({ error: 'Not found' });

export function errorHandler(err, req, res, next) {
  if (err.name === 'ZodError') {
    return res.status(400).json({ error: 'Invalid input', details: err.issues });
  }
  if (err.code === 11000) return res.status(409).json({ error: 'Already exists' });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    error: status === 500 ? 'Server error' : err.message,
    details: err.details,
  });
}
```

**`src/app.js`**
```js
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';

const app = express();
app.set('trust proxy', 1); // required on Render so rate limiting sees real IPs
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL.split(',').map((s) => s.trim()) }));
app.use(express.json({ limit: '5mb' })); // routines can have thousands of entries

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/', routes);

app.use(notFound);
app.use(errorHandler);
export default app;
```

**`src/server.js`**
```js
import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';

await connectDB();
app.listen(env.PORT, () => console.log(`API running on port ${env.PORT}`));
```

**`src/routes/index.js`** (start with auth only; add more routers as you build them)
```js
import { Router } from 'express';
import authRoutes from './auth.routes.js';

const r = Router();
r.use('/auth', authRoutes);
export default r;
```

#### Step 1.5 Models: College, User, Token

**`src/models/College.js`**
```js
import mongoose from 'mongoose';

const collegeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    settings: {
      periodsPerDay: { type: Number, default: 8 },
      periodMinutes: { type: Number, default: 50 },
      startTime: { type: String, default: '09:00' },
      tiffinAfterPeriod: { type: Number, default: 4 },
    },
  },
  { timestamps: true }
);

export default mongoose.model('College', collegeSchema);
```

**`src/models/User.js`**
```js
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const userSchema = new mongoose.Schema(
  {
    collegeId: { type: ObjectId, ref: 'College', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false }, // never returned unless asked for
    role: { type: String, enum: ['admin', 'teacher'], required: true },
    status: { type: String, enum: ['invited', 'active', 'left'], default: 'invited' },
    emailVerified: { type: Boolean, default: false },
    teacherId: { type: ObjectId, ref: 'Teacher' },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
```

**`src/models/Token.js`**
```js
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const tokenSchema = new mongoose.Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['invite', 'reset', 'verify'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  usedAt: Date,
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }, // TTL
});

export default mongoose.model('Token', tokenSchema);
```

#### Step 1.6 Utilities

**`src/utils/tokens.js`**
```js
import crypto from 'crypto';

// The raw secret goes in the link. Only the hash goes in the database.
export const newToken = () => crypto.randomBytes(32).toString('hex');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
```

**`src/utils/jwt.js`**
```js
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), cid: String(user.collegeId), role: user.role, tv: user.tokenVersion },
    env.JWT_SECRET,
    { expiresIn: user.role === 'admin' ? '7d' : '30d' }
  );
}

export const verifyToken = (t) => jwt.verify(t, env.JWT_SECRET);
```

**`src/services/email.js`** (prints the link to your terminal when no API key is set, so you can develop without any email account)
```js
import { env } from '../config/env.js';

export async function sendEmail({ to, subject, html, textForConsole }) {
  if (!env.EMAIL_API_KEY) {
    console.log(`\n[EMAIL to ${to}] ${subject}\n${textForConsole || ''}\n`);
    return;
  }
  // Brevo transactional email API. Swap this block to change provider.
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.EMAIL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { email: env.EMAIL_FROM, name: 'Routine Gen' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) console.error('Email failed', res.status, await res.text());
}
```

#### Step 1.7 Auth middleware

**`src/middleware/auth.js`**
```js
import User from '../models/User.js';
import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError(401, 'Login required');

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new AppError(401, 'Session expired');
  }

  // Look the user up every time so "left" / password-reset take effect instantly.
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active' || user.tokenVersion !== payload.tv) {
    throw new AppError(401, 'Session expired');
  }

  req.user = {
    id: user._id,
    collegeId: user.collegeId, // ALWAYS use this for tenant filtering
    role: user.role,
    teacherId: user.teacherId,
    name: user.name,
  };
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) throw new AppError(403, 'Not allowed');
  next();
};
```

**`src/middleware/validateId.js`**
```js
import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';

export function validateId(param = 'id') {
  return (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params[param])) throw new AppError(400, 'Bad id');
    next();
  };
}
```

#### Step 1.8 Auth validators and controller

**`src/validators/auth.schema.js`**
```js
import { z } from 'zod';

const email = z.string().trim().toLowerCase().email();
// bcrypt only uses the first 72 bytes, so cap there.
const password = z.string().min(8, 'At least 8 characters').max(72);

export const registerSchema = z.object({
  collegeName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(80),
  email,
  password,
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(72) });
export const emailOnlySchema = z.object({ email });
export const tokenSchema = z.object({ token: z.string().length(64) });
export const resetSchema = z.object({ token: z.string().length(64), password });
```

**`src/controllers/auth.controller.js`** (register, verify, login, me; the rest is added in Phase 5)
```js
import bcrypt from 'bcryptjs';
import College from '../models/College.js';
import User from '../models/User.js';
import Token from '../models/Token.js';
import { AppError } from '../utils/AppError.js';
import { newToken, hashToken } from '../utils/tokens.js';
import { signToken } from '../utils/jwt.js';
import { sendEmail } from '../services/email.js';
import { env } from '../config/env.js';
import { registerSchema, loginSchema, tokenSchema } from '../validators/auth.schema.js';

const HOUR = 3600 * 1000;
const frontend = () => env.FRONTEND_URL.split(',')[0].trim();

async function createLinkToken(userId, type, ttlMs) {
  await Token.deleteMany({ userId, type, usedAt: null }); // old unused links die
  const raw = newToken();
  await Token.create({
    userId,
    type,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

async function sendVerifyEmail(user) {
  const raw = await createLinkToken(user._id, 'verify', 24 * HOUR);
  const link = `${frontend()}/verify/${raw}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify your Routine Gen account',
    html: `<p>Hi ${user.name}, click to verify: <a href="${link}">${link}</a></p>`,
    textForConsole: link,
  });
}

export async function register(req, res) {
  const data = registerSchema.parse(req.body);
  if (await User.exists({ email: data.email })) {
    throw new AppError(409, 'This email is already registered');
  }
  const college = await College.create({ name: data.collegeName });
  let user;
  try {
    user = await User.create({
      collegeId: college._id,
      name: data.name,
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 12),
      role: 'admin',
      status: 'active',
      emailVerified: false,
    });
  } catch (e) {
    await College.findByIdAndDelete(college._id); // do not leave an empty college behind
    throw e;
  }
  await sendVerifyEmail(user);
  res.status(201).json({ message: 'Account created. Check your email to verify it.' });
}

export async function verifyEmail(req, res) {
  const { token } = tokenSchema.parse(req.body);
  const t = await Token.findOne({
    tokenHash: hashToken(token), type: 'verify', usedAt: null, expiresAt: { $gt: new Date() },
  });
  if (!t) throw new AppError(400, 'This link is invalid or expired');
  await User.updateOne({ _id: t.userId }, { emailVerified: true });
  t.usedAt = new Date();
  await t.save();
  res.json({ message: 'Email verified. You can log in now.' });
}

export async function login(req, res) {
  const { email, password } = loginSchema.parse(req.body);
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) throw new AppError(401, 'Wrong email or password'); // same message for both cases
  if (user.status !== 'active') throw new AppError(403, 'This account is not active');
  if (user.role === 'admin' && !user.emailVerified) {
    throw new AppError(403, 'Please verify your email first');
  }
  const college = await College.findById(user.collegeId);
  res.json({
    token: signToken(user),
    user: {
      id: user._id, name: user.name, email: user.email, role: user.role,
      collegeName: college?.name, hasTeacherLink: !!user.teacherId,
    },
  });
}

export async function me(req, res) {
  const college = await College.findById(req.user.collegeId);
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role, collegeName: college?.name });
}

export { createLinkToken, sendVerifyEmail };
```

**`src/routes/auth.routes.js`**
```js
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, verifyEmail, login } from '../controllers/auth.controller.js';

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const r = Router();
r.post('/register', limiter, register);
r.post('/verify-email', limiter, verifyEmail);
r.post('/login', limiter, login);
export default r;
```

Add `GET /me` in `routes/index.js`:
```js
import { requireAuth } from '../middleware/auth.js';
import { me } from '../controllers/auth.controller.js';
r.get('/me', requireAuth, me);
```

#### Step 1.9 Run and test with Thunder Client

```bash
npm run dev
```
You should see `MongoDB connected` and `API running on port 4000`. Open `http://localhost:4000/health` in a browser: `{"ok":true}`.

In Thunder Client:
1. `POST http://localhost:4000/auth/register` body (JSON): `{"collegeName":"Test College","name":"Admin One","email":"admin1@test.com","password":"password123"}`. Expect 201. Look in the terminal: the verify link is printed.
2. Copy the long token from the link. `POST /auth/verify-email` with `{"token":"<64 chars>"}`. Expect 200.
3. `POST /auth/login` with the email and password. Expect a `token`.
4. `GET /me` with header `Authorization: Bearer <token>`. Expect your name.
5. Try a wrong password 21 times quickly. Expect 429 (rate limited).

**Done when:** all five checks behave as described. Also check in Atlas (Browse Collections) that `colleges`, `users`, `tokens` exist and that `users.passwordHash` starts with `$2`.

---

### Phase 2: Login screens in the frontend

#### Step 2.1 Config, session, API client

**`frontend/js/config.js`**
```js
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API_BASE_URL = isLocal
  ? 'http://localhost:4000'
  : 'https://YOUR-API-NAME.onrender.com'; // fill in after deploying (Phase 8)
```

**`frontend/js/auth/session.js`**
```js
const KEY = 'rg_session';

export const saveSession = (token, user) => localStorage.setItem(KEY, JSON.stringify({ token, user }));
export const getSession = () => {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
};
export const getToken = () => getSession()?.token || null;
export const getUser = () => getSession()?.user || null;
export const clearSession = () => localStorage.removeItem(KEY);
```
(Storing the token in `localStorage` is the simple choice because the site and API are on different domains. The trade-off is that a cross-site-scripting bug could steal it, so never insert user-typed text into the page with `innerHTML`. Use `textContent`.)

**`frontend/js/api/client.js`**
```js
import { API_BASE_URL } from '../config.js';
import { getToken, clearSession } from '../auth/session.js';

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const res = await fetch(API_BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {          // token was rejected: force re-login
    clearSession();
    location.href = '/login.html';
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.details = data.details;
    throw err;
  }
  return data;
}
```

**`frontend/js/auth/guard.js`**
```js
import { getUser } from './session.js';

// Call at the top of a protected page. roles = ['admin'] etc.
export function requireLogin(roles) {
  const user = getUser();
  if (!user) { location.href = '/login.html'; return null; }
  if (roles && !roles.includes(user.role)) {
    location.href = user.role === 'teacher' ? '/teacher.html' : '/index.html';
    return null;
  }
  return user;
}
```

#### Step 2.2 Pages

Use absolute paths (`/css/...`, `/js/...`) in every new HTML page, because links like `/invite/<token>` sit one level deep and relative paths would break.

**`login.html`** needs: email input, password input, a Log in button, an error area, links to `signup.html` and `forgot.html`. Load Bootstrap and `<script type="module" src="/js/pages/login.js"></script>`.

**`js/pages/login.js`**
```js
import { api } from '../api/client.js';
import { saveSession } from '../auth/session.js';

document.getElementById('loginBtn').addEventListener('click', async () => {
  const errorBox = document.getElementById('error');
  errorBox.textContent = '';
  try {
    const { token, user } = await api('/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      },
    });
    saveSession(token, user);
    location.href = user.role === 'teacher' ? '/teacher.html' : '/index.html';
  } catch (e) {
    errorBox.textContent = e.message; // textContent, not innerHTML
  }
});
```

**`signup.html` + `js/pages/signup.js`**: fields college name, your name, email, password; calls `POST /auth/register`; on success show "Check your email to verify your account."

**`verify.html` + `js/pages/verify.js`**: reads the token from the URL (`location.pathname.split('/').pop()`), calls `POST /auth/verify-email`, shows the result and a link to login.

#### Step 2.3 Vercel rewrites

**`frontend/vercel.json`**
```json
{
  "rewrites": [
    { "source": "/verify/:token", "destination": "/verify.html" },
    { "source": "/invite/:token", "destination": "/invite.html" },
    { "source": "/reset/:token",  "destination": "/reset.html" }
  ]
}
```

#### Step 2.4 Protect the wizard, keep guest mode

At the top of `index.html`'s script, decide the mode:
```js
import { getUser } from './js/auth/session.js';
const user = getUser();
// user exists  → cloud mode (data from API)
// no user      → guest mode (exactly today's sessionStorage behaviour)
```
Show a small banner in guest mode: "Not logged in. Your data is saved only in this browser. Log in to save to the cloud." Add a Log out button in cloud mode (`clearSession(); location.href='/login.html'`).

Teachers who open `index.html` are redirected to `teacher.html` by `requireLogin(['admin'])` only when logged in as a teacher.

**Done when:** you can sign up, verify via the terminal link, log in from the real page, land on `index.html`, refresh and stay logged in, and log out.

---

### Phase 3: Cloud data (departments, teachers, settings, imports)

#### Step 3.1 Models

**`src/models/Department.js`**
```js
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  classType: {
    type: String,
    enum: ['theory', 'theory_extended', 'lab', 'lab_extended', 'theory_lab'],
    required: true,
  },
  periodsPerWeek: { type: Number, required: true, min: 1, max: 40 },
});

const semesterSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  periodsPerDay: { type: Number, required: true, min: 1, max: 15 },
  periodMinutes: { type: Number, required: true, min: 10, max: 180 },
  startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  subjects: [subjectSchema],
});

const departmentSchema = new mongoose.Schema(
  {
    collegeId: { type: ObjectId, ref: 'College', required: true, index: true },
    name: { type: String, required: true, trim: true },
    semesters: [semesterSchema],
  },
  { timestamps: true }
);

export default mongoose.model('Department', departmentSchema);
```

**`src/models/Teacher.js`**
```js
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const teacherSchema = new mongoose.Schema(
  {
    collegeId: { type: ObjectId, ref: 'College', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    status: { type: String, enum: ['active', 'left'], default: 'active' },
    workingDays: [{ type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }],
    availableFrom: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    availableTo: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    teaches: [
      {
        _id: false,
        departmentId: ObjectId,
        semesterId: ObjectId,
        subjectId: ObjectId,
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model('Teacher', teacherSchema);
```

#### Step 3.2 Validation and one full CRUD example (departments)

**`src/validators/department.schema.js`**
```js
import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const departmentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  semesters: z.array(z.object({
    _id: z.string().optional(),            // present when editing an existing semester
    name: z.string().trim().min(1).max(60),
    periodsPerDay: z.number().int().min(1).max(15),
    periodMinutes: z.number().int().min(10).max(180),
    startTime: time,
    subjects: z.array(z.object({
      _id: z.string().optional(),
      name: z.string().trim().min(1).max(120),
      classType: z.enum(['theory', 'theory_extended', 'lab', 'lab_extended', 'theory_lab']),
      periodsPerWeek: z.number().int().min(1).max(40),
    })).max(60),
  })).max(12),
}).strict(); // unknown fields (such as a smuggled collegeId) are rejected
```

**`src/controllers/department.controller.js`**
```js
import Department from '../models/Department.js';
import Teacher from '../models/Teacher.js';
import { AppError } from '../utils/AppError.js';
import { departmentSchema } from '../validators/department.schema.js';

// Every query below has collegeId: req.user.collegeId. Copy this habit everywhere.

export async function list(req, res) {
  res.json(await Department.find({ collegeId: req.user.collegeId }).sort('name'));
}

export async function create(req, res) {
  const data = departmentSchema.parse(req.body);
  const dept = await Department.create({ ...data, collegeId: req.user.collegeId });
  res.status(201).json(dept);
}

export async function update(req, res) {
  const data = departmentSchema.parse(req.body);
  const dept = await Department.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    data,
    { new: true, runValidators: true }
  );
  if (!dept) throw new AppError(404, 'Department not found');
  // Remove teaching links that point to semesters/subjects that no longer exist.
  const semIds = dept.semesters.map((s) => s._id);
  const subIds = dept.semesters.flatMap((s) => s.subjects.map((x) => x._id));
  await Teacher.updateMany(
    { collegeId: req.user.collegeId },
    { $pull: { teaches: { departmentId: dept._id, $or: [
      { semesterId: { $nin: semIds } }, { subjectId: { $nin: subIds } },
    ] } } }
  );
  res.json(dept);
}

export async function remove(req, res) {
  const dept = await Department.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!dept) throw new AppError(404, 'Department not found');
  await Teacher.updateMany(
    { collegeId: req.user.collegeId },
    { $pull: { teaches: { departmentId: dept._id } } }
  );
  res.json({ ok: true });
}
```

**`src/routes/department.routes.js`**
```js
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateId } from '../middleware/validateId.js';
import * as c from '../controllers/department.controller.js';

const r = Router();
r.use(requireAuth, requireRole('admin'));
r.get('/', c.list);
r.post('/', c.create);
r.put('/:id', validateId(), c.update);
r.delete('/:id', validateId(), c.remove);
export default r;
```
Mount it in `routes/index.js`: `r.use('/departments', departmentRoutes);`

#### Step 3.3 Teachers: same pattern, with three extra rules

Create `validators/teacher.schema.js`, `controllers/teacher.controller.js`, `routes/teacher.routes.js` by copying the department files and changing:

1. **Schema:** `name`, optional `email`, `workingDays` (array of `Mon..Sun`), optional `availableFrom`/`availableTo` (`HH:mm`, and `availableFrom < availableTo`), `teaches` array of `{ departmentId, semesterId, subjectId }`.
2. **Reference check on create/update:** every `departmentId`, `semesterId`, `subjectId` in `teaches` must exist inside a department of **the same college**. Load the college's departments once and verify each triple. Reject with 400 otherwise. (This stops someone linking your teacher to another college's subject.)
3. **Delete rule:** before deleting, `TimetableEntry.exists({ collegeId, teacherId: id })`. If true, return 409 "This teacher appears in a routine. Use Replace teacher or mark as left."

Also add `GET/PUT /college/settings` reading and updating `College.settings` (zod-validate the four numbers/strings, find by `req.user.collegeId`).

#### Step 3.4 Imports

The browser already parses Excel with SheetJS and JSON with your import page. Keep that. Instead of saving to `sessionStorage`, send the parsed result to the server:

- `POST /import/excel` body `{ departments: [...], teachers: [...] }` (same shapes as the CRUD schemas).
- Server validates **the whole payload with zod first**; if anything is invalid, save nothing and return the list of row problems. If valid, insert everything (use a transaction, see Step 4.2) so an import is all-or-nothing.
- Teachers in the import refer to subjects by name in your Excel template. The server resolves names to ids after saving departments: build a map `"DeptName|SemName|SubjectName" → ids`, and report any teacher row whose subject name is not found.
- `POST /import/json` is for the routine-entries JSON page. It validates entries against the timetable entry schema (Step 4.1) and returns clashes rather than saving; saving happens through the timetable endpoints.

#### Step 3.5 Wire the wizard through a data adapter

Your wizard currently reads and writes `sessionStorage`. Do **not** rewrite the wizard. Create `frontend/js/data/store.js` exposing the same operations the wizard already calls (for example `loadAll()`, `saveDepartment()`, `deleteDepartment()`, `saveTeacher()`, `saveSettings()`), with two implementations:

```js
import { getUser } from '../auth/session.js';
import * as guest from './guestStore.js';   // your existing sessionStorage code, moved here
import * as cloud from './cloudStore.js';   // new: calls the API

export const store = getUser() ? cloud : guest;
```

`cloudStore.js` must convert between Mongo's `_id` and whatever `id` field the wizard uses (`{ ...doc, id: doc._id }`), so the engine keeps working with the objects it expects. On login, `loadAll()` calls `GET /departments`, `GET /teachers`, `GET /college/settings` once and hands the wizard the same structure it used to restore from the session.

Add one button in guest mode after login: **"Upload my current browser data to my account"**, which sends the guest data through the import endpoint. This is how your own college moves its existing data.

**Done when:** log in, add a department and a teacher in the wizard, log out, log in from another browser, and see the same data. Excel import saves to the database. Deleting a subject removes it from teachers' teaching lists.

---

### Phase 4: Routines, publish, history, retention

#### Step 4.1 Models and validators

**`src/models/Timetable.js`**
```js
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const yearFromNow = () => new Date(Date.now() + 365 * 24 * 3600 * 1000);

const timetableSchema = new mongoose.Schema(
  {
    collegeId: { type: ObjectId, ref: 'College', required: true },
    label: { type: String, required: true, trim: true },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    createdBy: { type: ObjectId, ref: 'User' },
    publishedAt: Date,
    entryCount: Number,
    expiresAt: { type: Date, default: yearFromNow, index: { expireAfterSeconds: 0 } }, // TTL
    changeLog: [{
      _id: false,
      type: String, oldTeacherId: ObjectId, newTeacherId: ObjectId,
      oldName: String, newName: String, at: Date, by: ObjectId,
    }],
  },
  { timestamps: true }
);
timetableSchema.index({ collegeId: 1, status: 1 });

export default mongoose.model('Timetable', timetableSchema);
```

**`src/models/TimetableEntry.js`**
```js
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const entrySchema = new mongoose.Schema({
  collegeId: { type: ObjectId, required: true },
  timetableId: { type: ObjectId, required: true },
  departmentId: ObjectId, semesterId: ObjectId,
  day: { type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], required: true },
  period: Number, startMin: Number, endMin: Number,
  subjectId: ObjectId, teacherId: ObjectId,
  isFiller: { type: Boolean, default: false }, fillerLabel: String,
  // snapshots so history and PDFs stay readable after later edits or deletions
  departmentName: String, semesterName: String,
  subjectName: String, teacherName: String, classType: String,
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }, // TTL
});
entrySchema.index({ timetableId: 1, teacherId: 1 });

export default mongoose.model('TimetableEntry', entrySchema);
```

**`src/validators/timetable.schema.js`**
```js
import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

export const entrySchema = z.object({
  departmentId: objectId,
  semesterId: objectId,
  day: z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
  period: z.number().int().min(1).max(20),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
  subjectId: objectId.optional(),
  teacherId: objectId.optional(),
  isFiller: z.boolean().default(false),
  fillerLabel: z.string().max(60).optional(),
}).refine((e) => e.endMin > e.startMin, 'endMin must be after startMin')
  .refine((e) => e.isFiller || (e.subjectId && e.teacherId), 'Non-filler needs subjectId and teacherId');

export const saveTimetableSchema = z.object({
  label: z.string().trim().min(1).max(100),
  entries: z.array(entrySchema).max(20000),
});
```

#### Step 4.2 Clash checker and time helpers

**`src/utils/time.js`**
```js
export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
```

**`src/services/clash.js`**
```js
import { toMin } from '../utils/time.js';

// The server double-checks the browser engine: a teacher must never overlap in real clock time.
export function findTeacherClashes(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (e.isFiller || !e.teacherId) continue;
    const key = `${e.teacherId}|${e.day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const clashes = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.startMin - b.startMin);
    let maxEnd = -1;
    for (const e of list) {
      if (e.startMin < maxEnd) {
        clashes.push({ teacherId: e.teacherId, teacherName: e.teacherName, day: e.day, startMin: e.startMin });
      }
      maxEnd = Math.max(maxEnd, e.endMin);
    }
  }
  return clashes;
}

// Used by Replace teacher (Phase 6): can this teacher take over these entries?
export function checkReplacement(teacher, existing, incoming) {
  const from = teacher.availableFrom ? toMin(teacher.availableFrom) : 0;
  const to = teacher.availableTo ? toMin(teacher.availableTo) : 1440;
  const problems = [];
  for (const e of incoming) {
    const base = { teacherId: teacher._id, teacherName: teacher.name, day: e.day, startMin: e.startMin, endMin: e.endMin, subjectName: e.subjectName };
    if (!teacher.workingDays.includes(e.day)) problems.push({ ...base, type: 'not_working_day' });
    else if (e.startMin < from || e.endMin > to) problems.push({ ...base, type: 'outside_hours' });
    for (const x of existing) {
      if (x.day === e.day && e.startMin < x.endMin && x.startMin < e.endMin) {
        problems.push({ ...base, type: 'overlap', withSubject: x.subjectName });
      }
    }
  }
  return problems;
}
```

#### Step 4.3 Timetable controller

**`src/controllers/timetable.controller.js`**
```js
import mongoose from 'mongoose';
import Timetable from '../models/Timetable.js';
import TimetableEntry from '../models/TimetableEntry.js';
import Department from '../models/Department.js';
import Teacher from '../models/Teacher.js';
import College from '../models/College.js';
import { AppError } from '../utils/AppError.js';
import { saveTimetableSchema } from '../validators/timetable.schema.js';
import { findTeacherClashes } from '../services/clash.js';

// Turns the browser's entries into database documents. It ALSO proves every id belongs
// to this college (it only looks them up inside this college's own data).
async function buildEntryDocs(collegeId, tt, entries) {
  const [depts, teachers] = await Promise.all([
    Department.find({ collegeId }).lean(),
    Teacher.find({ collegeId }).lean(),
  ]);
  const deptMap = new Map(depts.map((d) => [String(d._id), d]));
  const teacherMap = new Map(teachers.map((t) => [String(t._id), t]));

  return entries.map((e) => {
    const dept = deptMap.get(e.departmentId);
    const sem = dept?.semesters.find((s) => String(s._id) === e.semesterId);
    if (!dept || !sem) throw new AppError(400, 'Unknown department or semester in entries');
    let subject = null, teacher = null;
    if (!e.isFiller) {
      subject = sem.subjects.find((s) => String(s._id) === e.subjectId);
      teacher = teacherMap.get(e.teacherId);
      if (!subject || !teacher) throw new AppError(400, 'Unknown subject or teacher in entries');
    }
    return {
      ...e, collegeId, timetableId: tt._id, expiresAt: tt.expiresAt,
      departmentName: dept.name, semesterName: sem.name,
      subjectName: subject?.name ?? null, teacherName: teacher?.name ?? null,
      classType: subject?.classType ?? null,
    };
  });
}

export async function saveDraft(req, res) {
  const { label, entries } = saveTimetableSchema.parse(req.body);
  const collegeId = req.user.collegeId;
  const session = await mongoose.startSession();
  let tt;
  try {
    // Transaction = all-or-nothing. No half-saved routine can ever exist.
    await session.withTransaction(async () => {
      [tt] = await Timetable.create(
        [{ collegeId, label, status: 'draft', createdBy: req.user.id, entryCount: entries.length }],
        { session }
      );
      await TimetableEntry.insertMany(await buildEntryDocs(collegeId, tt, entries), { session });
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json({ id: tt._id, expiresAt: tt.expiresAt });
}

export async function updateDraft(req, res) {
  const { label, entries } = saveTimetableSchema.parse(req.body);
  const collegeId = req.user.collegeId;
  const tt = await Timetable.findOne({ _id: req.params.id, collegeId });
  if (!tt) throw new AppError(404, 'Routine not found');
  if (tt.status !== 'draft') throw new AppError(409, 'Only drafts can be edited');
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await TimetableEntry.deleteMany({ timetableId: tt._id, collegeId }, { session });
      await TimetableEntry.insertMany(await buildEntryDocs(collegeId, tt, entries), { session });
      await Timetable.updateOne({ _id: tt._id, collegeId }, { label, entryCount: entries.length }, { session });
    });
  } finally {
    await session.endSession();
  }
  res.json({ ok: true });
}

export async function list(req, res) {
  const items = await Timetable.find({ collegeId: req.user.collegeId })
    .sort('-createdAt').select('-changeLog').lean();
  res.json(items.map((t) => ({
    ...t,
    deletesOn: t.expiresAt,
    daysLeft: Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 86400000)),
  })));
}

export async function getOne(req, res) {
  const collegeId = req.user.collegeId;
  const tt = await Timetable.findOne({ _id: req.params.id, collegeId }).lean();
  if (!tt) throw new AppError(404, 'Routine not found');
  const entries = await TimetableEntry.find({ timetableId: tt._id, collegeId }).lean();
  res.json({ ...tt, entries });
}

export async function publish(req, res) {
  const collegeId = req.user.collegeId;
  const tt = await Timetable.findOne({ _id: req.params.id, collegeId });
  if (!tt) throw new AppError(404, 'Routine not found');
  if (tt.status === 'published') throw new AppError(409, 'Already published');

  const entries = await TimetableEntry.find({ timetableId: tt._id, collegeId }).lean();
  const clashes = findTeacherClashes(entries);
  if (clashes.length) throw new AppError(409, 'Teacher clashes found. Fix them before publishing.', clashes);

  // Only one current routine: the previous published one becomes archived.
  await Timetable.updateMany({ collegeId, status: 'published' }, { status: 'archived' });
  tt.status = 'published';
  tt.publishedAt = new Date();
  await tt.save();
  await College.updateOne({ _id: collegeId }, { $unset: { routineOutdatedAt: 1 } }); // used in Phase 7
  res.json({ ok: true, publishedAt: tt.publishedAt });
}

export async function remove(req, res) {
  const collegeId = req.user.collegeId;
  const tt = await Timetable.findOneAndDelete({ _id: req.params.id, collegeId });
  if (!tt) throw new AppError(404, 'Routine not found');
  await TimetableEntry.deleteMany({ timetableId: tt._id, collegeId });
  res.json({ ok: true });
}
```

**`src/routes/timetable.routes.js`**
```js
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateId } from '../middleware/validateId.js';
import * as c from '../controllers/timetable.controller.js';

const r = Router();
r.use(requireAuth, requireRole('admin'));
r.get('/', c.list);
r.post('/', c.saveDraft);
r.get('/:id', validateId(), c.getOne);
r.put('/:id', validateId(), c.updateDraft);
r.post('/:id/publish', validateId(), c.publish);
r.delete('/:id', validateId(), c.remove);
export default r;
```
Mount: `r.use('/timetables', timetableRoutes);`

Also add `routineOutdatedAt: Date` to the College model now (used in Phase 7), and return it from `GET /college/settings`.

#### Step 4.4 Frontend

1. After the engine finishes and conflicts are resolved, convert every filled cell into an entry object: `{ departmentId, semesterId, day, period, startMin, endMin, subjectId, teacherId, isFiller, fillerLabel }`. Your engine already computes `startMin` and `endMin`.
2. Add buttons **Save draft** and **Publish** on the Routines step (cloud mode only). Publish = save draft (if not saved) then `POST /timetables/:id/publish`. If the server answers 409 with `details`, show the clashes.
3. Create `history.html`: call `GET /timetables`, list label, status, created date, and a line **"Deletes on [date]. Download the PDF first."** When `daysLeft <= 30`, make the line red with **"Deletes in N days"**.
4. Each history item has **Open** (loads entries back into the routine view for PDF export) and **Delete**.

**Done when:** you can generate, save a draft, refresh, find it in History, publish it, and publishing a routine with a deliberately double-booked teacher is rejected. In Atlas, `timetables.expiresAt` is about 365 days ahead. (To test the TTL quickly, edit one test document's `expiresAt` to 2 minutes from now and watch it disappear.)

---

### Phase 5: Invites, forgot password, teacher phone view, PWA

#### Step 5.1 More auth controller functions

Add to `auth.controller.js` (also import `Teacher`, `emailOnlySchema`, `resetSchema`, and `z`):

```js
// ADMIN: create or re-issue an invite for a teacher.
export async function inviteTeacher(req, res) {
  const collegeId = req.user.collegeId;
  const teacher = await Teacher.findOne({ _id: req.params.id, collegeId });
  if (!teacher) throw new AppError(404, 'Teacher not found');
  if (teacher.status === 'left') throw new AppError(400, 'This teacher has left');

  let user = await User.findOne({ teacherId: teacher._id, collegeId });
  if (!user) {
    const { email } = emailOnlySchema.parse(req.body);
    if (await User.exists({ email })) throw new AppError(409, 'This email already has an account');
    user = await User.create({
      collegeId, name: teacher.name, email, role: 'teacher',
      status: 'invited', teacherId: teacher._id,
    });
    teacher.email = email;
    await teacher.save();
  }
  // If the user is already active, this acts as "send new invite link"
  // (teacher lost email access). Accepting it lets them set a new password.
  const raw = await createLinkToken(user._id, 'invite', 7 * 24 * HOUR);
  res.json({ link: `${frontend()}/invite/${raw}`, expiresAt: new Date(Date.now() + 7 * 24 * HOUR) });
}

// ADMIN: invite a second admin.
export async function inviteAdmin(req, res) {
  const { name, email } = z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email(),
  }).parse(req.body);
  if (await User.exists({ email })) throw new AppError(409, 'This email already has an account');
  const user = await User.create({
    collegeId: req.user.collegeId, name, email, role: 'admin', status: 'invited',
  });
  const raw = await createLinkToken(user._id, 'invite', 7 * 24 * HOUR);
  res.json({ link: `${frontend()}/invite/${raw}` });
}

// PUBLIC: show only the person's name so the page can say "Hello Priya".
export async function inviteInfo(req, res) {
  const t = await Token.findOne({
    tokenHash: hashToken(req.params.token), type: 'invite', usedAt: null, expiresAt: { $gt: new Date() },
  });
  const user = t && (await User.findById(t.userId));
  if (!user || user.status === 'left') throw new AppError(404, 'This link is invalid or expired');
  res.json({ name: user.name });
}

// PUBLIC: teacher sets their own password. Link then stops working.
export async function acceptInvite(req, res) {
  const { token, password } = resetSchema.parse(req.body);
  const t = await Token.findOne({
    tokenHash: hashToken(token), type: 'invite', usedAt: null, expiresAt: { $gt: new Date() },
  });
  const user = t && (await User.findById(t.userId).select('+passwordHash'));
  if (!user || user.status === 'left') throw new AppError(400, 'This link is invalid or expired');
  user.passwordHash = await bcrypt.hash(password, 12);
  user.status = 'active';
  user.emailVerified = true;
  user.tokenVersion += 1;            // old sessions (if any) stop working
  await user.save();
  t.usedAt = new Date();
  await t.save();
  const college = await College.findById(user.collegeId);
  res.json({
    token: signToken(user),
    user: { id: user._id, name: user.name, email: user.email, role: user.role,
            collegeName: college?.name, hasTeacherLink: !!user.teacherId },
  });
}

// PUBLIC: always the same answer, so nobody can discover which emails exist.
export async function forgot(req, res) {
  const { email } = emailOnlySchema.parse(req.body);
  const user = await User.findOne({ email, status: 'active' });
  if (user) {
    const raw = await createLinkToken(user._id, 'reset', HOUR);
    const link = `${frontend()}/reset/${raw}`;
    await sendEmail({
      to: user.email, subject: 'Reset your Routine Gen password',
      html: `<p>Reset your password (link valid for 1 hour): <a href="${link}">${link}</a></p>`,
      textForConsole: link,
    });
  }
  res.json({ message: 'If this email exists, a link was sent.' });
}

export async function reset(req, res) {
  const { token, password } = resetSchema.parse(req.body);
  const t = await Token.findOne({
    tokenHash: hashToken(token), type: 'reset', usedAt: null, expiresAt: { $gt: new Date() },
  });
  const user = t && (await User.findById(t.userId).select('+passwordHash'));
  if (!user || user.status !== 'active') throw new AppError(400, 'This link is invalid or expired');
  user.passwordHash = await bcrypt.hash(password, 12);
  user.tokenVersion += 1;            // logs out every other device
  await user.save();
  t.usedAt = new Date();
  await t.save();
  res.json({ message: 'Password changed. Please log in.' });
}

export async function resendVerify(req, res) {
  const { email } = emailOnlySchema.parse(req.body);
  const user = await User.findOne({ email, role: 'admin', emailVerified: false });
  if (user) await sendVerifyEmail(user);
  res.json({ message: 'If this email needs verifying, a link was sent.' });
}
```

Add the routes in `auth.routes.js` (all with `limiter`): `POST /forgot`, `POST /reset`, `POST /accept-invite`, `POST /resend-verify`, `GET /invite/:token`. In `teacher.routes.js` add `POST /:id/invite` (admin). Create `routes/admin.routes.js` with `POST /invite` mounted at `/admins`.

#### Step 5.2 Frontend pages

- `forgot.html`: email box, shows the server's message.
- `reset.html`: reads token from the URL, new password box, calls `/auth/reset`, then link to login.
- `invite.html`: reads the token, calls `GET /auth/invite/:token`, shows "Hello Priya, set your password", calls `/auth/accept-invite`, saves the session, redirects to `teacher.html`. The success screen says: **"Tip: add this page to your home screen (browser menu → Add to Home Screen). Next time, open it and log in with your email and password. The invite link will not work again."**
- In the wizard's Teachers step: each teacher row gets an **Invite** button. It asks for an email (first time), calls `POST /teachers/:id/invite`, shows the link with a **Copy** button and a **Share on WhatsApp** button (`https://wa.me/?text=` + encoded message + link). Show the status (invited / active / left). For active teachers the button reads **Send new invite link**.

#### Step 5.3 Teacher schedule endpoint

**`src/controllers/schedule.controller.js`**
```js
import Timetable from '../models/Timetable.js';
import TimetableEntry from '../models/TimetableEntry.js';
import { AppError } from '../utils/AppError.js';

export async function mySchedule(req, res) {
  if (!req.user.teacherId) throw new AppError(404, 'No teacher profile is linked to this account');
  const collegeId = req.user.collegeId;
  const tt = await Timetable.findOne({ collegeId, status: 'published' }).sort('-publishedAt').lean();
  if (!tt) return res.json({ timetable: null, entries: [] });
  const entries = await TimetableEntry.find({
    collegeId, timetableId: tt._id, teacherId: req.user.teacherId, isFiller: false,
  }).select('day period startMin endMin subjectName departmentName semesterName classType').lean();
  res.json({ timetable: { label: tt.label, publishedAt: tt.publishedAt }, entries });
}
```

**`src/routes/me.routes.js`**
```js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { mySchedule } from '../controllers/schedule.controller.js';

const r = Router();
r.get('/schedule', requireAuth, mySchedule); // teacher, or admin who is linked to a teacher
export default r;
```
Mount: `r.use('/me', meRoutes);` (keep the earlier `GET /me` too.)

#### Step 5.4 Teacher phone page

`teacher.html`: mobile-first, big text, one card per day. Script `js/pages/teacher.js`:

```js
import { api } from '../api/client.js';
import { requireLogin } from '../auth/guard.js';
import { clearSession } from '../auth/session.js';

const user = requireLogin(['teacher', 'admin']);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CACHE = 'rg_last_schedule';

const minToTime = (m) => {
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
};

function render(data, offline) {
  const root = document.getElementById('schedule');
  root.textContent = '';
  if (!data.timetable) { root.textContent = 'No routine has been published yet.'; return; }
  document.getElementById('label').textContent =
    data.timetable.label + (offline ? ' (offline copy)' : '');
  for (const day of DAYS) {
    const items = data.entries.filter((e) => e.day === day).sort((a, b) => a.startMin - b.startMin);
    if (!items.length) continue;
    const card = document.createElement('div');
    card.className = 'card mb-3';
    const h = document.createElement('div');
    h.className = 'card-header fw-bold';
    h.textContent = day;
    card.append(h);
    for (const e of items) {
      const row = document.createElement('div');
      row.className = 'p-3 border-top';
      row.textContent =
        `${minToTime(e.startMin)} – ${minToTime(e.endMin)}  ${e.subjectName} (${e.departmentName}, ${e.semesterName})`;
      card.append(row);
    }
    root.append(card);
  }
}

try {
  const data = await api('/me/schedule');
  localStorage.setItem(CACHE, JSON.stringify(data));   // offline fallback
  render(data, false);
} catch (e) {
  const cached = localStorage.getItem(CACHE);
  if (cached) render(JSON.parse(cached), true);
  else document.getElementById('schedule').textContent = e.message;
}

document.getElementById('logout').onclick = () => { clearSession(); localStorage.removeItem(CACHE); location.href = '/login.html'; };
```
Clear the cache on logout (as above) so the next person on a shared phone cannot see it.

#### Step 5.5 PWA

Your `manifest.json` and `sw.js` already exist. Make sure `manifest.json` has `start_url` pointing to `/login.html` (login redirects logged-in users onward) and icons of 192 and 512 px. In `sw.js`, cache the static files of `teacher.html` (its css/js) so the page opens offline; the schedule data itself comes from the `localStorage` fallback above. Register the worker in `teacher.html`: `navigator.serviceWorker?.register('/sw.js')`. Because the site's files move to `frontend/`, confirm the service worker's cached paths still match.

**Done when:** you can invite a teacher, open the link in a private window, set a password, see "Hello <name>", land on the phone view, close the browser, reopen and log in with email + password, and the invite link now says invalid. Forgot-password works end to end (link printed in the terminal), and after a reset the old session is logged out.

---

### Phase 6: Replace a teacher mid-semester

Never rename a teacher. A rename rewrites history and hands the old login to a new person. Instead, move the classes.

#### Step 6.1 Backend

**`src/controllers/replaceTeacher.controller.js`**
```js
import mongoose from 'mongoose';
import { z } from 'zod';
import Timetable from '../models/Timetable.js';
import TimetableEntry from '../models/TimetableEntry.js';
import Teacher from '../models/Teacher.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { checkReplacement } from '../services/clash.js';

const id = z.string().regex(/^[a-f\d]{24}$/i);
const schema = z.object({
  oldTeacherId: id,
  // one row per subject that moves; different subjects may go to different teachers
  assignments: z.array(z.object({ subjectId: id, newTeacherId: id })).min(1),
  markOldAsLeft: z.boolean().default(true),
  dryRun: z.boolean().default(false),
});

export async function replaceTeacher(req, res) {
  const body = schema.parse(req.body);
  const collegeId = req.user.collegeId;
  const tt = await Timetable.findOne({ _id: req.params.id, collegeId });
  if (!tt) throw new AppError(404, 'Routine not found');

  const newIds = [...new Set(body.assignments.map((a) => a.newTeacherId))];
  const wanted = new Set([body.oldTeacherId, ...newIds]);
  const teachers = await Teacher.find({ _id: { $in: [...wanted] }, collegeId });
  if (teachers.length !== wanted.size) throw new AppError(400, 'Unknown teacher');
  const byId = new Map(teachers.map((t) => [String(t._id), t]));
  if (newIds.some((n) => byId.get(n).status !== 'active')) throw new AppError(400, 'New teacher must be active');

  // Which entries move, and to whom
  const oldEntries = await TimetableEntry.find({ collegeId, timetableId: tt._id, teacherId: body.oldTeacherId });
  const moves = [];
  for (const e of oldEntries) {
    const a = body.assignments.find((x) => x.subjectId === String(e.subjectId));
    if (a) moves.push({ entry: e, newId: a.newTeacherId });
  }
  if (!moves.length) throw new AppError(400, 'Nothing to move for these subjects');

  // Clash check: working days, hours, and overlap with the new teacher's existing classes
  const clashes = [];
  for (const nid of newIds) {
    const existing = await TimetableEntry.find({ collegeId, timetableId: tt._id, teacherId: nid }).lean();
    const incoming = moves.filter((m) => m.newId === nid).map((m) => m.entry.toObject());
    clashes.push(...checkReplacement(byId.get(nid), existing, incoming));
  }
  if (body.dryRun) return res.json({ clashes, movedCount: moves.length });
  if (clashes.length) throw new AppError(409, 'Clashes found', clashes);

  const oldTeacher = byId.get(body.oldTeacherId);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const nid of newIds) {
        const nt = byId.get(nid);
        const mine = moves.filter((m) => m.newId === nid);
        await TimetableEntry.updateMany(
          { _id: { $in: mine.map((m) => m._id ?? m.entry._id) }, collegeId },
          { teacherId: nt._id, teacherName: nt.name },
          { session }
        );
        const links = mine.map((m) => ({
          departmentId: m.entry.departmentId, semesterId: m.entry.semesterId, subjectId: m.entry.subjectId,
        }));
        // future regenerations use the new teacher
        await Teacher.updateOne({ _id: nt._id, collegeId }, { $addToSet: { teaches: { $each: links } } }, { session });
        for (const l of links) {
          await Teacher.updateOne({ _id: oldTeacher._id, collegeId }, { $pull: { teaches: l } }, { session });
        }
        await Timetable.updateOne({ _id: tt._id, collegeId }, { $push: { changeLog: {
          type: 'teacher_replaced', oldTeacherId: oldTeacher._id, newTeacherId: nt._id,
          oldName: oldTeacher.name, newName: nt.name, at: new Date(), by: req.user.id,
        } } }, { session });
      }
      if (body.markOldAsLeft) {
        await Teacher.updateOne({ _id: oldTeacher._id, collegeId }, { status: 'left' }, { session });
        await User.updateOne({ teacherId: oldTeacher._id, collegeId },
          { status: 'left', $inc: { tokenVersion: 1 } }, { session });   // login dies immediately
      }
    });
  } finally {
    await session.endSession();
  }
  res.json({ ok: true, movedCount: moves.length });
}
```
(Small clean-up while coding: `moves` items are `{ entry, newId }`, so use `m.entry._id` in the `$in` list. The `m._id ?? ` part is not needed.)

Route: in `timetable.routes.js` add `r.post('/:id/replace-teacher', validateId(), replaceTeacher);`

#### Step 6.2 Frontend

In `history.html`, each routine gets **Replace teacher**. A modal walks the admin through:
1. Pick the leaving teacher (list from the routine's entries).
2. The subjects that teacher takes are listed. For each, choose the new teacher from a dropdown (default: one teacher for all). Include **Add new teacher** (creates via `POST /teachers`, then shows the invite link).
3. Click **Check**: sends `dryRun: true`, shows each clash in plain words ("Ravi is not available on Wed", "Ravi is free only 10:00 to 14:00", "Overlaps with Physics 11:00").
4. When there are no clashes, **Confirm** sends the real request. Show the routine's change log: "Teacher X replaced by Y on date."

**Done when:** replacing a teacher moves exactly their entries, the old teacher's phone session stops working on the next request, the new teacher sees the classes, a clash is reported (and nothing changes) when the new teacher is busy, and the change log line appears.

---

### Phase 7: Timing change requests

#### Step 7.1 Backend

**`src/models/ChangeRequest.js`**
```js
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const schema = new mongoose.Schema({
  collegeId: { type: ObjectId, required: true, index: true },
  teacherId: { type: ObjectId, ref: 'Teacher', required: true },
  requestedDays: [{ type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }],
  requestedFrom: { type: String, required: true },
  requestedTo: { type: String, required: true },
  reason: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: String,
  decidedAt: Date,
  decidedBy: ObjectId,
}, { timestamps: true });

export default mongoose.model('ChangeRequest', schema);
```

**Controller rules (`request.controller.js`)**
- `POST /requests` (teacher): `teacherId` is taken from `req.user.teacherId`, never the body. zod: days 1 to 7 valid values, `requestedFrom < requestedTo`, reason 5 to 500 characters. Reject if that teacher already has 3 pending requests.
- `GET /requests` (admin): `ChangeRequest.find({ collegeId, status: 'pending' })` joined with the teacher's name.
- `POST /requests/:id/decide` (admin): body `{ decision: 'approved' | 'rejected', adminNote }`. Only pending requests can be decided. On approve, in a transaction: update the teacher's `workingDays`, `availableFrom`, `availableTo` (filtered by `collegeId`), mark the request decided, and set `College.routineOutdatedAt = new Date()`.
- **Never auto-regenerate.**

#### Step 7.2 Frontend

- Teacher page: a **Request timing change** form (days as checkboxes, from/to time, reason) and a list of "My requests" with status.
- `requests.html` (admin): pending list, Approve / Reject with a note.
- `index.html` (admin): if `routineOutdatedAt` is set, show a yellow banner **"Teacher availability changed. Routine may be outdated. Regenerate and republish."** Publishing a new routine clears it (already done in the `publish` function).

**Done when:** teacher submits, admin approves, the teacher's availability changes in the Teachers step, the banner appears, and publishing clears it.

---

### Phase 8: Hardening

Do this before showing the app to any other college.

1. **Input validation:** every `req.body` goes through zod (`.parse`) in every controller. Confirm with Thunder Client by sending garbage.
2. **Rate limits:** login, register, forgot, reset, accept-invite, invite lookup, resend-verify all use `limiter`. Consider a stricter limiter (for example 5 per 15 minutes) on login.
3. **Secrets:** `.env` is in `.gitignore`. Run `git log --all -- backend/.env` to be sure it was never committed. If it was, rotate the database password and JWT secret.
4. **No secret fields leak:** search the code for `passwordHash` and `tokenHash`; they must never appear in a response. `passwordHash` is `select: false`, keep it that way.
5. **CORS:** `FRONTEND_URL` on Render contains only your real frontend domain(s) (no trailing slash).
6. **Errors:** the central handler hides internal details (it returns "Server error" for unexpected failures).
7. **Backups:** Atlas free tier has no automatic backups. Add a monthly reminder to export important collections (Atlas → Database Tools, or `mongodump`), or upgrade before many colleges depend on it.
8. **Account rules:** deleting your last admin must be refused (count active admins in the college first).
9. Run the two-college test in the next section.

---

## 9. Two-college security test

Create two admins in two different colleges (register both, verify both), with a department and a teacher each. Save `tokenA`, `tokenB`, and the ids created by each. Every row below must give the "Expected" result.

| # | Test | Expected |
|---|---|---|
| 1 | With `tokenA`, `GET /departments/<B's department id>` style requests (update, delete, get) | 404 |
| 2 | With `tokenA`, `GET /departments` | Only A's departments |
| 3 | With `tokenA`, `POST /departments` with `"collegeId": "<B's id>"` in the body | 400 (strict schema rejects it) |
| 4 | With `tokenA`, save a timetable whose entries use B's `teacherId` or `subjectId` | 400 "Unknown ..." |
| 5 | With `tokenA`, `GET /timetables/<B's timetable id>` | 404 |
| 6 | With `tokenA`, `replace-teacher` on B's timetable | 404 |
| 7 | With `tokenA`, `POST /requests/<B's request id>/decide` | 404 |
| 8 | A teacher token calling any admin route | 403 |
| 9 | No token, or a tampered token, on any protected route | 401 |
| 10 | A teacher marked `left`, then use their old token | 401 immediately |
| 11 | Reset a password, then use the token from before the reset | 401 |
| 12 | Open an invite link twice | Second time: invalid |
| 13 | Use an invite link older than 7 days (edit `expiresAt` in Atlas) | Invalid |
| 14 | Forgot-password with an unknown email | Same message as a known email |
| 15 | Search any API response for `passwordHash` or `tokenHash` | Not found |
| 16 | Publish a routine with a double-booked teacher | 409 |
| 17 | `GET /me/schedule` as teacher A | Only A's classes, never a colleague's |
| 18 | Log in 21 times fast | 429 |

If any row fails, fix it before deploying. A missing `collegeId` filter is the most common cause.

---

## 10. Deployment

### 10.1 Email (Brevo)

1. Create a Brevo account. Under Senders, add and verify the email address you will send from.
2. Create an API key (v3). Put it in `EMAIL_API_KEY`, and the verified address in `EMAIL_FROM`.
3. Check Brevo's current free daily sending limit; it is plenty for verify/reset emails.

### 10.2 API on Render

1. Push your branch to GitHub.
2. Render → **New** → **Web Service** → connect the repo.
3. Settings: **Root Directory** `backend`, **Build Command** `npm install`, **Start Command** `npm start`, Instance type **Free**, Health Check Path `/health`.
4. Environment variables:
   - `NODE_ENV=production`
   - `MONGODB_URI` (Atlas string)
   - `JWT_SECRET` (a new long random value, not the local one)
   - `FRONTEND_URL=https://routinegen.vercel.app` (your real frontend URL, no trailing slash)
   - `EMAIL_API_KEY`, `EMAIL_FROM`
5. Deploy. Open `https://<name>.onrender.com/health`. It must show `{"ok":true}`.
6. Free services sleep after inactivity and the first request afterwards can take a minute. Options: accept it, ping `/health` every 10 minutes with a free uptime monitor, or upgrade to an always-on plan once teachers depend on it.

### 10.3 Frontend on Vercel

1. In `frontend/js/config.js`, put the Render URL as the production `API_BASE_URL`.
2. Vercel → Settings → Build & Deployment → **Root Directory** = `frontend`.
3. Merge the branch into `main`. Vercel redeploys.
4. Test on a real phone: sign up, verify (a real email should arrive), log in, publish, invite yourself as a teacher from a second email, open the invite link, view the schedule, install to home screen.

### 10.4 Launch checklist

- [ ] Two-college test passes on the **production** API.
- [ ] `.env` not in Git history.
- [ ] Atlas password and JWT secret are production-only.
- [ ] Vercel root directory is `frontend` and the live site still loads.
- [ ] README updated (tech stack is no longer "no backend").
- [ ] Your own college's data uploaded via "Upload my current browser data to my account".

---

## 11. Master checklist

**Phase 0**
- [ ] Node, Git, VS Code, Thunder Client installed
- [ ] Atlas, Render, Brevo accounts created

**Phase 1: Backend skeleton and auth**
- [ ] Repo moved into `frontend/`, `backend/` created
- [ ] Atlas cluster, user, connection string
- [ ] `env.js`, `db.js`, `app.js`, `server.js`
- [ ] Models: College, User, Token
- [ ] register, verify-email, login, `/me`
- [ ] Rate limiting on auth routes
- [ ] All Phase 1 tests pass

**Phase 2: Login screens**
- [ ] `config.js`, `session.js`, `client.js`, `guard.js`
- [ ] login, signup, verify pages
- [ ] `vercel.json` rewrites
- [ ] Guest mode still works

**Phase 3: Cloud data**
- [ ] Department and Teacher models, CRUD, tenant filtering
- [ ] Reference checks and delete rules
- [ ] College settings endpoint
- [ ] Imports validate first, save all-or-nothing
- [ ] `store.js` adapter + "upload my browser data"

**Phase 4: Routines**
- [ ] Timetable and TimetableEntry models with TTL
- [ ] Save draft, update draft, list, get, publish, delete
- [ ] Server-side clash check on publish
- [ ] History page with "Deletes on [date]" warning

**Phase 5: Teacher experience**
- [ ] Invite teacher, invite admin, accept invite
- [ ] Forgot / reset password, resend verification
- [ ] `/me/schedule` and mobile page with offline copy
- [ ] PWA install works

**Phase 6: Replace teacher**
- [ ] Dry-run clash preview, confirm, change log
- [ ] Old teacher's login disabled instantly

**Phase 7: Timing requests**
- [ ] Teacher form, admin approval, outdated banner

**Phase 8: Ship**
- [ ] Hardening list done
- [ ] Two-college test passes
- [ ] Deployed and tested on a phone

---

## 12. Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| `MongoServerSelectionError` | Wrong password in `MONGODB_URI`, special characters not URL-encoded, or Atlas Network Access does not allow your IP (use `0.0.0.0/0` for Render). |
| `ZodError` on startup | A variable is missing from `.env` or `JWT_SECRET` is shorter than 32 characters. |
| Browser shows a CORS error | `FRONTEND_URL` does not exactly match the address in the browser bar (check `localhost` vs `127.0.0.1`, port, trailing slash). |
| Logged out on every page | The API returned 401. Check `JWT_SECRET` did not change and the user is `active`. |
| `Cannot use import statement outside a module` | `"type": "module"` missing from `backend/package.json`. |
| Verify or reset email never arrives | Without `EMAIL_API_KEY` links print in the terminal (local). In production, check Brevo's sender is verified and look at the Render logs for "Email failed". |
| First request after a while is very slow | Render free tier was asleep. See 10.2. |
| Vercel shows 404 after the move | Root Directory is not set to `frontend`. |
| `/invite/<token>` page has no styling | The HTML uses relative paths. Change to absolute paths (`/css/...`, `/js/...`). |
| Transactions fail | Use Atlas (a replica set). A plain local MongoDB without a replica set does not support transactions. |
| 429 Too Many Requests while testing | Wait 15 minutes, or temporarily raise the limiter in development. |
| Teacher still sees classes after being replaced | They are looking at a cached copy. Reload while online; the offline copy refreshes on the next successful fetch. |

---

## Design decisions recorded in this plan

These differ from or add to the first draft of the plan, and why:

1. `bcryptjs` instead of `bcrypt`: identical hashing, no native build problems on hosts.
2. `tokenVersion` on users and a database lookup on every request: makes "disable login" and "password reset logs out old sessions" actually work with long-lived JWTs.
3. Admin email verification before login: stops someone registering a college with another person's email.
4. Second-admin invite endpoint: the original plan allowed several admins but had no way to create one.
5. `teacherId` allowed on admins: a senior faculty admin who also teaches can see their own schedule.
6. Name snapshots in timetable entries: old routines and PDFs stay readable after edits and deletions.
7. `archived` status: exactly one current published routine per college.
8. Server re-checks clashes on publish and replace: does not trust the browser blindly.
9. Timing requests are permanent in v1 (no date ranges), because approving one overwrites availability.
10. Guest mode kept: logging in is optional, so the tool stays as easy as it is today.
