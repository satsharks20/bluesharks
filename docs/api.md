# API

Base URL: `http://localhost:4000` in development. The web app reaches it through its own origin
at `/api/*`.

## Conventions

Success:

```json
{ "ok": true, "data": { } }
```

Failure:

```json
{ "ok": false, "error": { "code": "bad_request", "message": "Invalid request", "details": [] } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | Validation failed, malformed JSON or malformed ID |
| 401 | `unauthorized` | Missing, invalid or expired session; wrong credentials |
| 403 | `forbidden` | Signed in without the required permission; inactive account |
| 404 | `not_found` | Unknown route or record |
| 409 | `conflict` | Email already registered |
| 429 | `rate_limited` | Too many requests |
| 503 | `service_unavailable` | Database not connected |
| 500 | `internal_error` | Unexpected error (details are logged, not returned) |

Authentication is a JWT in an httpOnly cookie named `ss_token`, valid for 7 days. Requests need no
`Authorization` header.

Rate limits: 300 requests per minute per IP on `/api/*`; 20 per 15 minutes per IP on register and login.

## Health

### `GET /api/health`

No authentication. Works without a database.

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "service": "sat-sharks-api",
    "environment": "development",
    "database": "connected",
    "uptimeSeconds": 12,
    "time": "2026-10-02T17:36:24.939Z"
  }
}
```

`database` is `connected`, `disconnected` or `not_configured`.

## Auth

`PublicUser`: `{ id, name, email, role, status, permissions[], country, region }`.

### `POST /api/auth/register`

Body: `{ "name": string (2–80), "email": string, "password": string (8–72), "country": ISO code }`

Creates a `student` account with `region` = `local` for `PK`, `international` otherwise, sets the
session cookie, returns `201` with `{ user }`. Errors: `400` (including an unknown country), `409`.

### `POST /api/auth/login`

Body: `{ "email": string, "password": string }`

Sets the session cookie, returns `{ user }`. Errors: `400`, `401` (same message for an unknown
email and a wrong password), `403` for a blocked account.

### `POST /api/auth/logout`

Clears the session cookie. Returns `{ "loggedOut": true }`.

### `GET /api/auth/me`

Requires a session. Returns `{ user }`, or `401`. A session signed before the account's last
password reset is answered with `401`.

### `POST /api/auth/forgot-password`

Body: `{ "email": string }`. Always answers `{ "sent": true }` at once, whether or not the address
has an account; the lookup and email happen afterwards. An active account gets a single-use link
to `CLIENT_URL/reset-password?token=…` valid for 30 minutes, sent through Resend. A new request
replaces the previous link. Rate limit: 5 per 15 minutes per IP.

### `POST /api/auth/reset-password/check`

Body: `{ "token": string }`. Returns `{ "valid": boolean }` (used by the reset page).

### `POST /api/auth/reset-password`

Body: `{ "token": string, "password": string (8–72) }`. Sets the new password, spends the token,
signs out every existing session and clears this browser's cookie. Returns `{ "reset": true }`.
Errors: `400` for an invalid, used or expired token.

## Admin

Every route requires a session and the `admin:access` permission (roles `staff` and `admin`).

### `GET /api/admin/papers`

Permission `papers:read`. Returns `{ papers: PaperSummary[] }`, newest first.

`PaperSummary`: `id`, `title`, `description`, `source`, `sourcePaperId`, `status`, `sections`,
`modules`, `adaptive`, `questionCount`, `createdAt`, `updatedAt`.

### `GET /api/admin/papers/:id`

Permission `papers:read`. Returns `{ paper: PaperSummary, questions: QuestionListItem[] }`.

`QuestionListItem`: `id`, `section`, `moduleNumber`, `moduleType`, `questionNumber`,
`questionType`, `difficulty`, `topic`, `skill`, `prompt`, `hasCorrectAnswer`.

The correct answer itself is not returned; only whether one was imported.

## Import

There is no HTTP import endpoint in Phase 1. Importing is a command, so that a long-running job
never runs inside a request:

```bash
npm run scrape:paper -- <path-to.har> [--attempt <id>] [--dry-run]
```

## Practice (students)

Every route requires a session. A student only ever sees **published** papers and questions, and
only their own attempts (another user's attempt answers `404`).

### `GET /api/practice/catalog`

Returns `{ exams, topics, access }`.

- `exams[]`: `examId`, `name`, `examDate`, `testUploadId` (an uploaded exam, also takeable as a full
  test; otherwise null), `sections` — per section, the `paperId` and `questionCount`. Papers from the
  same exam are grouped into one entry. `locked`: the exam is kept for paid plans and this account
  is free (see "Access by plan").
- `topics`: per section, the list of `{ topic, skills[] }` present in published questions.
- `access`: `{ paid, features: { drills, mocks, full_tests } }` for this account (`true` = may use).

Cached in memory for 60 seconds (locks are added per request); cleared when an admin changes a
paper's status or a question, or activates or edits an uploaded test. `GET /api/practice/tests`
also marks each uploaded test `locked`.

### Access by plan

Set in Admin → Access (`/api/admin/settings/access`). A free account gets `403` ("… only available on
the paid plans") when it starts a drill (`drills` feature + the exam), a single-section mock (`mocks`
+ every chosen exam), a pool-built full test (`full_tests` + every chosen exam) or a fixed uploaded
test (that test only). A free account's mock or full test with no exams chosen draws only from the
exams open to it (`403` if none are). Paid plans (not expired), staff and admins may open
everything. Attempts and full tests already started can always be continued and finished.

### `POST /api/practice/attempts`

Starts a drill. Body:

| Field | Type | Notes |
| --- | --- | --- |
| `paperId` | id | Must be published |
| `topics`, `skills` | string[] | Optional filters |
| `difficulty` | `easy` \| `medium` \| `hard` \| null | |
| `limit` | 1–200 \| null | null = every match, up to 200 |
| `timed`, `timeMinutes` | boolean, 1–600 | |
| `excludeAnswered` | boolean | Skip questions this student has already answered |
| `name` | string | Optional title |

Questions are picked at random from the matches. Returns `201` with `{ attempt }`.
Errors: `404` paper not available, `400` no questions match.

### `GET /api/practice/attempts`

The student's attempts, newest first (up to 100).

### `GET /api/practice/attempts/:id`

`{ attempt, navigation[] }`. `navigation` has one entry per question: `position`, `answered`,
`flagged`, `checked`. `attempt.timeRemainingSeconds` is computed by the server.

A timed attempt whose time has run out is submitted automatically the next time it is touched.

### `GET /api/practice/attempts/:id/questions/:position`

One question: text, passage, choices, images and figure data, plus the student's saved `answer`
and `flagged`. `result` is `null` unless the question has been checked or the attempt has ended.
**The answer key is never included before that.**

### `PATCH /api/practice/attempts/:id/questions/:position`

Body: `{ answer?: string | null, flagged?: boolean }`. Saves one or both.
Errors: `409` if the attempt has ended, or if the question was already checked and the answer is
being changed.

### `POST /api/practice/attempts/:id/questions/:position/check`

Grades one answered question and returns it with `result` (`correct`, `correctAnswer`,
`explanation`). The question is then locked. `400` if it has no answer yet.

### `POST /api/practice/attempts/:id/end`

Grades everything and closes the attempt. Safe to call twice.

### `GET /api/practice/attempts/:id/result`

`{ attempt, questions[] }` with the answer key, topic, skill and difficulty for every question.
`409` until the attempt has ended.

### Grading

- Multiple choice: the selected key must equal the correct key.
- Typed answers: any accepted value matches, as does a numerically equal fraction or decimal.
  A decimal that fills the answer box (5 characters, or 6 if negative) may be truncated or
  rounded at its last digit.
- An unanswered question is counted as unanswered, not incorrect.

## Admin: papers and question bank

In addition to the two paper routes above:

| Route | Permission | Purpose |
| --- | --- | --- |
| `GET /api/admin/stats` | `admin:access` | Counts of users (and by region), papers, questions, attempts and reports |
| `GET /api/admin/settings/scoring` | `admin:access` | Conversion tables |
| `GET /api/admin/settings/pricing` | `admin:access` | Plans, prices, comparison rows, tagline, schools note, refund policy (defaults until saved) |
| `PUT /api/admin/settings/pricing` | `papers:write` | Body: the whole `PricingContent`. The four plans stay in their fixed order (`free`, `monthly`, `three_months`, `till_test_day`); at most one is "most popular". `GET /api/pricing` (public) serves the same content to the pricing page |
| `PUT /api/admin/settings/scoring` | `papers:write` | Body: all four tables (see database.md, Setting) |
| `GET /api/admin/announcements` | `admin:access` | Every announcement, newest first. `GET /api/announcements` (any signed-in account) returns only the active, not-ended ones for that account's plan (newest 5) |
| `POST /api/admin/announcements`, `PUT /api/admin/announcements/:id` | `papers:write` | Body `{ title, message, audience: all\|free\|paid, tone: info\|important, active, endsAt: ISO \| null }` |
| `DELETE /api/admin/announcements/:id` | `papers:write` | `404` if already gone |
| `GET /api/admin/settings/access` | `papers:read` | `{ settings, items }`: the access rules and every exam and published uploaded test they can apply to (`key`, `kind` exam/practice, `name`, `date`, `active`) |
| `PUT /api/admin/settings/access` | `papers:write` | Body `AccessSettings`: `features` (`drills`, `mocks`, `full_tests` → `free`/`paid`), `content[]` (`{ key, level }`; key = catalog `examId`, `upload:<id>` for uploaded tests), `newContent` (level for exams/tests without a rule). Until saved, everything is free |
| `GET /api/admin/reports` | `reports:read` | `?status=pending\|resolved&page&pageSize`. Returns `{ reports, total, page, pageSize, counts }` |
| `GET /api/admin/reports/:id` | `reports:read` | `{ report, question (with answer key), related }` |
| `POST /api/admin/reports/:id/resolve` | `reports:write` | Body `{ note?, includeSameQuestion? }`. `409` if already resolved |
| `POST /api/admin/reports/:id/reopen` | `reports:write` | Body `{ note? }`. `409` if already pending |
| `PATCH /api/admin/papers/:id/status` | `papers:write` | Body `{ status }`. Also sets the status of the paper's questions |
| `POST /api/admin/papers/status` | `papers:write` | Body `{ status, ids? }`. Omit `ids` to apply to every paper |
| `GET /api/admin/questions` | `questions:read` | Filterable, paginated list (below) |
| `GET /api/admin/questions/facets` | `questions:read` | Topics and skills present, per section |
| `GET /api/admin/questions/:id` | `questions:read` | One question with its answer key |
| `PATCH /api/admin/questions/:id` | `questions:write` | Edit difficulty, topic, skill, prompt, passage, explanation, correct answer, `questionType` (`mcq`/`spr`, needs a matching answer), `choices` (`{ key, text }[]`; a choice figure is kept by key), `assets` (`{ url, maxWidth }[]`: existing images or ones from `POST /api/admin/assets`) |
| `POST /api/admin/assets` | `questions:write` | Multipart field `image`: PNG, JPEG or WebP (checked from the bytes), up to 2 MB. Returns `{ url }` (`/api/assets/<key>`), attached on the next question save |
| `DELETE /api/admin/questions/:id` | `questions:write` | Deletes it and corrects the paper's counts |

`GET /api/admin/papers/:id` now returns the first 50 questions as a preview.

`GET /api/admin/questions` query parameters: `section`, `topic`, `skill`,
`difficulty` (`easy` / `medium` / `hard` / `none`), `status`, `paperId`, `search`
(text in the question or passage, or an exact source ID), `page`, `pageSize` (max 100).
Returns `{ questions, total, page, pageSize }`.

Papers of uploaded practice tests (`source: "pdf-upload"`) are not listed by `GET /api/admin/papers`
and are skipped by the bulk status route; `PATCH /api/admin/papers/:id/status` on one answers 400.

## Admin: uploaded practice tests

Details in `docs/full-test-upload.md`. Read routes need `papers:read`, the rest `papers:write`.

| Route | Purpose |
| --- | --- |
| `GET /api/admin/test-uploads` | `{ uploads }`: summaries with per-module counts (no question bodies) |
| `POST /api/admin/test-uploads` | Multipart: `kind` (`practice` default \| `exam`), `title`, and `year` + `testNumber` (practice) or `examDate` `YYYY-MM-DD` (exam), files `readingWriting` and/or `math` (PDF, ≤ 20 MB). Each PDF is read during the request; a broken one is stored as `failed` with its reasons. `409` for a used year + number. `201 { upload }` |
| `GET /api/admin/test-uploads/:id` | `{ upload (with questions), topics }`; `topics` = the bank's domains and skills per section |
| `PATCH /api/admin/test-uploads/:id` | Body as on upload: `{ kind, title, year, testNumber }` or `{ kind: "exam", title, examDate }`. Changing `kind` of a published test moves it between practice tests and Exams |
| `POST /api/admin/test-uploads/:id/sections/:section/file` | Multipart `file`: replace one section (`reading_writing` / `math`). `409` once published |
| `PUT /api/admin/test-uploads/:id/sections/:section` | Body `{ questions: UploadQuestion[] }` in order (renumbered per module). `topic` and `skill` are both required and the skill must belong to the topic. Validated like the PDF; marks the section `reviewed`. Up to 2 MB |
| `POST /api/admin/test-uploads/:id/publish` | Both sections reviewed; creates two hidden papers and their tagged questions. `409` if already published |
| `POST /api/admin/test-uploads/:id/active` | Body `{ active }`. Activating needs all six modules non-empty and every question answered |
| `DELETE /api/admin/test-uploads/:id` | Drafts only (`409` for a published test) |

Students: `GET /api/practice/tests` lists active uploaded tests of both kinds (`{ tests:
PracticeTestListing[] }`, each with `kind`); `POST /api/practice/full-tests` with `testUploadId`
starts a sitting of one (`paperIds` ignored). The catalog, drills and random mocks never include a
practice test's questions (tag `full-test`); an exam's are bank questions and its card is in the catalog.

## Assets

### `GET /api/assets/:key`

Public. Serves a hosted question image. Cached for one year (keys never change), and sent with a
sandboxing Content-Security-Policy so an SVG opened directly cannot run scripts.

## Practice: Phase 2 additions

- `POST /api/practice/mocks` also takes `timeMultiplier`: `1`, `1.5` or `2` (extended time; every
  module's limit is multiplied).
- `AttemptSummary` adds `fullTestId`, `timeMultiplier`, `sectionScore` (200–800, finished mocks
  once a conversion table exists), `timeUsedSeconds` and `modules[]` (per module: `total`,
  `correct`, `incorrect`, `skipped`, `timeUsedSeconds`, `timeLimitSeconds`; finished mocks only).
- `ReviewQuestion` adds `timeSpentSeconds`.

| Route | Purpose |
| --- | --- |
| `POST /api/practice/full-tests` | Body `{ paperIds?: { reading_writing[], math[] }, timed?, timeMultiplier?, name? }`. Starts Reading & Writing. `201 { fullTest }` |
| `GET /api/practice/full-tests` | The student's full tests |
| `GET /api/practice/full-tests/:id` | `{ fullTest }` with `stage` (`reading_writing`, `break`, `math`, `done`), `breakEndsAt`, both sections and `totalScore` (400–1600) |
| `DELETE /api/practice/attempts/:id` | Deletes the student's own drill or mock (finished or not). `409` for a section of a full test |
| `DELETE /api/practice/full-tests/:id` | Deletes the student's full test and both its sections |
| `POST /api/practice/full-tests/:id/continue` | Ends the break and starts Math. Safe to repeat: always the same Math section. `409` before Reading & Writing is finished |
| `POST /api/practice/attempts/:id/questions/:position/report` | Body `{ reason, details? }`. `201 { id }`. `409` for a second pending report on the same question, or a question in a closed module. Rate limit: 30 per hour |

Staff can read the reports queue (`reports:read`); only admins resolve (`reports:write`).
