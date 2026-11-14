# Database

MongoDB with Mongoose. Models are defined in `packages/db/src/models/`.

A field the source did not provide is stored as `null` (or `"unknown"` for module type). It is never guessed.

## User (`users`)

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | |
| `email` | string | Unique, lower-cased |
| `passwordHash` | string | bcrypt. Excluded from queries by default (`select: false`) |
| `role` | `student` \| `staff` \| `admin` | Default `student` |
| `status` | `active` \| `blocked` \| `deleted` | Default `active` |
| `country` | ISO 3166-1 alpha-2 \| null | Picked at sign-up (e.g. `PK`). null for older accounts and CLI-made admins |
| `region` | `local` \| `international` \| null | From `country` only: `PK` = local, any other = international. Never from IP |
| `passwordChangedAt` | date \| null | Set by a password reset. Session tokens signed before it are rejected |
| `resetTokenHash` | string \| null | SHA-256 of the emailed reset token (the token is never stored). `select: false` |
| `resetTokenExpiresAt` | date \| null | 30 minutes after the request. Both reset fields are cleared when the token is used |
| `createdAt`, `updatedAt` | date | |

Roles are extensible: add the role to `USER_ROLES` and its permissions to `ROLE_PERMISSIONS` in
`packages/types`. Routes check permissions (`admin:access`, `papers:read`, …), never role names.

The proposal's five user types (local/international × free/paid, plus admin) are a combination of
role, region and plan. Region is stored (above); plan arrives with payments (Checkpoint 4.1).

Indexes: `email` (unique), `role`, `status`, `region`, `resetTokenHash` (sparse).

## Paper (`papers`)

| Field | Type | Notes |
| --- | --- | --- |
| `title`, `description` | string | |
| `source` | string | Where it came from, e.g. `bluecorn` |
| `sourcePaperId` | string | Its ID at the source |
| `status` | `draft` \| `published` \| `hidden` | Default `draft`. Imports never publish |
| `sections` | (`reading_writing` \| `math`)[] | |
| `modules` | array | See below |
| `adaptive` | object | See below |
| `questionCount` | number | |
| `metadata` | object | Ours: expected question count, what was unavailable |
| `sourceMetadata` | object | The source's own attempt fields, kept for debugging |

`modules[]`: `key`, `section`, `moduleNumber` (1, 2 or null), `moduleType`
(`m1` \| `m2_easy` \| `m2_hard` \| `none` \| `unknown`), `questionCount`, `timeLimitSeconds`.

`none` means the questions are a flat set with no module (a paper imported from a drill).
`unknown` means there is a module but the source did not say which.

A complete adaptive section has three modules: `m1`, `m2_easy` and `m2_hard`. A paper imported
from a single mock attempt only has the route that attempt was given.

`adaptive`:

| Field | Meaning |
| --- | --- |
| `isAdaptive` | A Module 2 route was observed |
| `routing` | `server_side` \| `client_side` \| `unknown`: where the source makes the decision |
| `observedRoute` | The Module 2 type seen, or null |
| `module1Correct` | Module 1 correct count in the observed attempt, or null |
| `routingThreshold` | Null unless a source explicitly exposes its rule |

Indexes: `{ source, sourcePaperId }` unique; `status`.

## Question (`questions`)

| Field | Type | Notes |
| --- | --- | --- |
| `paperId` | ObjectId → Paper | |
| `source`, `sourceQuestionId` | string | Stable ID of the question at the source |
| `section` | `reading_writing` \| `math` | |
| `moduleNumber` | 1 \| 2 \| null | |
| `moduleType` | `m1` \| `m2_easy` \| `m2_hard` \| `none` \| `unknown` | |
| `questionNumber` | number | Position within the module |
| `questionType` | `mcq` \| `spr` \| `other` | `spr` = student-produced response (grid-in) |
| `difficulty` | `easy` \| `medium` \| `hard` \| null | |
| `topic`, `skill` | string \| null | Domain and skill |
| `prompt` | string | May contain LaTeX (`$…$`, `$$…$$`) |
| `passage` | string \| null | |
| `choices` | `{ key, text, viz }[]` | Empty for `spr` |
| `correctAnswer` | `{ choiceKey, acceptedValues[] }` \| null | Excluded from queries by default |
| `explanation` | string \| null | Excluded from queries by default |
| `assets` | `{ kind: "image", url, maxWidth }[]` | |
| `viz` | any \| null | Structured chart/table data from the source |
| `sourceMetadata` | object | Source IDs, position and type as received |
| `status` | `draft` \| `published` \| `hidden` | |
| `tags` | string[] | `full-test` and `full-test:<upload id>` on questions of an uploaded practice test; every student bank query excludes `full-test`. An uploaded exam's questions have `uploaded-exam` and `full-test:<upload id>` (not excluded) |

`correctAnswer` and `explanation` use `select: false`, so a query has to ask for them explicitly.
This supports the proposal's rule that answers never reach the browser before submission.

Indexes:

| Index | Purpose |
| --- | --- |
| `{ paperId, moduleType, sourceQuestionId }` unique | Identity of an imported question |
| `{ paperId, section, moduleNumber, questionNumber }` | Reading a paper in order |
| `{ status, section, difficulty }` | Question bank filters |
| `{ status, topic, skill }` | Question bank filters |
| `{ source, sourceQuestionId }` | Finding the same source question across papers |
| `{ tags }` | Questions of an uploaded test |

## Relationships

```
Paper 1 ──── * Question      (Question.paperId)
User                          (no relations yet; attempts arrive in Phase 2)
```

## Source IDs and re-importing

- A paper is upserted on `{ source, sourcePaperId }`.
- A question is upserted on `{ paperId, moduleType, sourceQuestionId }`.
- `status` is written only on first insert, so re-importing never undoes an admin's publish or hide.
- Questions that exist in the database but are missing from a later import are left in place.

For the reference site, `sourcePaperId` is the mock **attempt ID**, because that site has no
fixed papers (see [scraping.md](scraping.md)). `sourceQuestionId` is the site's `content_id`.

## Asset (`assets`)

Files we host ourselves; today, the question images copied from the source.

| Field | Type | Notes |
| --- | --- | --- |
| `key` | string | Unique. `<hash>.<extension>`; the public name under `/api/assets/` |
| `sourceUrl` | string | Unique. Where it was copied from |
| `contentType` | string | |
| `size` | number | Bytes |
| `data` | binary | The file |

Stored in MongoDB because the files are small SVGs (201 files, 7 MB) and no object storage is
configured. Questions refer to an asset by URL (`/api/assets/<key>`), so moving the bytes to
S3-compatible storage later changes only where that route reads from.

A question's `assets[]` entries now also carry `sourceUrl`, the original location.

## Attempt (`attempts`)

One student working through one drill or one adaptive mock section.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | ObjectId → User | |
| `kind` | `drill` \| `mock` | |
| `name`, `section`, `paperId`, `paperIds` | | |
| `status` | `active` \| `done` | |
| `timed`, `timeLimitSeconds` | | Mock: limit per module, already multiplied by `timeMultiplier` |
| `timeMultiplier` | 1 \| 1.5 \| 2 | Extended-time accommodation. Default 1 |
| `fullTestId` | ObjectId → FullTest \| null | Set when the mock is one section of a full test |
| `startedAt` | date | The clock: remaining time is always computed from this on the server. Mock: start of the current module |
| `lastPosition` | number | Where to resume |
| `viewPosition`, `viewStartedAt` | | The question on screen and since when (per-question timing) |
| `items[]` | | `questionId`, `module`, `answer`, `flagged`, `checked`, `correct`, `timeSpentSeconds` |
| `currentModule`, `m2Type`, `m1Correct`, `m2Correct`, `routingThresholdPercent`, `routingRequiredCorrect` | | Mock routing |
| `m1TimeUsedSeconds`, `m2TimeUsedSeconds` | number \| null | Per module: start to submission, capped at the limit when timed; untimed = sum of question times |
| `sectionScore` | number \| null | 200–800 from the conversion table for the route taken. null until a table exists |
| `correct`, `incorrect`, `unanswered` | number | Set when the attempt ends |
| `timeUsedSeconds` | number \| null | Whole attempt (mock: both modules) |
| `completedAt` | date \| null | |

Indexes: `{ userId, status, createdAt }`; `{ fullTestId, section }` unique, partial (only attempts
that belong to a full test).

Question time: each time a question is loaded, the time since the previous load is added to the
previous question (capped by the module deadline; untimed attempts cap one stretch at 10 minutes).

Attempts reference questions by ID. Hiding a paper keeps its attempts; deleting a question
removes it from the review of attempts that included it.

```
User 1 ──── * Attempt * ──── * Question
Paper 1 ──── * Question
```

## FullTest (`fulltests`)

Both sections in one sitting: a Reading & Writing mock, a 10-minute break, then a Math mock.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | ObjectId → User | |
| `name`, `timed`, `timeMultiplier` | | Applied to both sections |
| `paperIds.reading_writing`, `paperIds.math` | ObjectId[] | Exams each section draws from; empty = all |
| `testUploadId` | ObjectId → TestUpload \| null | Set for a sitting of an uploaded practice test (fixed modules) |
| `readingWritingAttemptId`, `mathAttemptId` | ObjectId → Attempt \| null | Math is created when the break ends |
| `totalScore` | number \| null | 400–1600: the two section scores added, once both exist |
| `completedAt` | date \| null | |

Index: `{ userId, createdAt }`.

## TestUpload (`testuploads`)

A fixed adaptive test uploaded as two PDFs (see `docs/full-test-upload.md`). Attempts of a sitting
carry `testUploadId` and `paperId` (the section's paper) and take their modules from that paper.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `practice` \| `exam` | Missing on older uploads = `practice`. An exam is listed under Exams |
| `title`, `year`, `testNumber` | | `{ year, testNumber }` unique. An exam's year is its date's; its number is assigned from 1001 |
| `examDate` | `YYYY-MM-DD` \| null | Exams only |
| `status` | `draft` \| `published` | |
| `active` | boolean | Published tests only: students can start it |
| `readingWriting`, `math` | section \| null | `{ fileName, fileSize, status: extracted\|reviewed\|failed, errorMessage, warnings[], questions: UploadQuestion[], uploadedAt, reviewedAt, reviewedBy }`. Every new `UploadQuestion` has a validated nonblank topic and skill; legacy records may still contain null until corrected. The PDF itself is never stored |
| `paperIds.reading_writing`, `paperIds.math` | ObjectId → Paper \| null | Created on publish (`source: "pdf-upload"`, or `"pdf-upload-exam"` for an exam) |
| `publishedAt`, `uploadedBy` | | |

## ProblemReport (`problemreports`)

A student's "Report a problem" on one question. Never deleted.

| Field | Type | Notes |
| --- | --- | --- |
| `questionId`, `paperId`, `section` | | The question reported |
| `userId` | ObjectId → User | Reporter |
| `attemptId`, `attemptKind`, `position` | | Where the student met it |
| `reason` | `wrong_answer` \| `typo` \| `display` \| `explanation` \| `other` | |
| `details` | string \| null | Up to 1,000 characters |
| `status` | `pending` \| `resolved` | |
| `history[]` | | `{ action: created\|resolved\|reopened, at, by, note, questionEdited }` |
| `resolvedAt`, `resolvedBy` | | |

Indexes: `{ status, createdAt }`, `{ questionId, status }`, `{ userId, questionId }` unique where
`status = pending` (one pending report per student per question).

## Setting (`settings`)

| Key | Value |
| --- | --- |
| `adaptive` | `{ routingThresholdPercent }` |
| `scoring.conversionTables` | `{ reading_writing: { m2_easy, m2_hard }, math: { m2_easy, m2_hard } }`: each `null` or (questions + 1) scores, 200–800, steps of 10, never decreasing. Entered by an admin |
