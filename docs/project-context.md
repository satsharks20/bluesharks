# SAT Sharks — project context and work log

**Read this first when starting a new session.** It records what exists, why, what was decided,
what is half-done, and the traps already found. Keep it up to date: every session that changes the
project adds to the change log at the bottom and corrects anything above that is no longer true.

Last updated: 2026-10-31 (Analytics "Skills breakdown" with a Reading & Writing / Math selector; not committed. Earlier: no repeats incl. top-up of exams without Math, official module pattern, Highlights & Notes, counts for premium only, committed as `edfaeb0`; security pass `1c8f2d3`, live).

---

## 1. The project

- **Client:** SAT Sharks. **Developer contact:** Umair (works in this repository).
- **What it is:** a Digital SAT practice platform. Full scope and 4-week plan: the client proposal,
  kept locally at `docs/purposal/SAT_Sharks_Proposal_v4_4Weeks.pdf` (git-ignored: it is marked
  Confidential and the repository is public). **On 2026-10-14 that file was no longer on disk**;
  Umair attached it in the chat instead. Ask him to put it back. Do **not** use
  `D:\PROJECTS\SAT Sharks\SAT Sharks Proposal v2.pdf` (an older, phase-based proposal with
  counseling/essays) or the other site's "Phase4 Proposal.docx": wrong documents for this project.
- **Proposal v4 weeks:** 1 foundation & question bank (1.1, 1.2) · 2 test engine (2.1, 2.2) ·
  **3 analytics, history & engagement (3.1 history/mistake bank/drills, 3.2 performance analytics,
  3.3 goals/streaks/leaderboard; built 2026-10-14)** · **4 money, admin, SEO & launch (4.1 plans,
  payments & conversion, 4.2 admin portal & paper control, 4.3 SEO & GEO, 4.4 testing & launch;
  built 2026-10-19 except what needs SAT Sharks: card gateway, domain, Search Console/GA IDs).**
- **Reference site:** `bluecorn.org` (also branded "Bluebooky"; API host `ciao.bluebooky.org`).
  Umair wants SAT Sharks to work like it. Its screenshots are in `docs/references/screenshots/`.
  SAT Sharks keeps its own name and branding; layout, fonts and spacing follow the reference.
- **Repository:** `https://github.com/satsharks20/bluesharks` (public, remote `origin`), branch
  `main`. **Client copy (deploys from here):** `https://github.com/sadsharks81-max/satsharks-platform`
  (remote `client`, public since 2026-10-09). Push to both. The client account's other repo `satsharks` is the older site.
- **Phase 1 brief:** `docs/prompts/phase1.txt`. Status report: `docs/phase-1-completion.md`
  (accurate up to the adaptive-mock work; see the change log for what came after).

## 2. Current state (2026-10-07)

### Working

- Accounts: register, login, logout, session (`/api/auth/*`), roles `student` / `staff` / `admin`
  with permission checks. Admins are created with `npm run create:admin` (not by registration).
- **One device at a time (2026-10-12):** each student login or sign-up stores a new random
  `sessionId` on the user and in the token (`sid`); `requireAuth` rejects a student token whose
  `sid` differs (401, code `signed_in_elsewhere`, `SIGNED_IN_ELSEWHERE` in packages/types). So a
  new login signs out the student's other device; the login page then says why
  (`takeSignedInElsewhere`, sessionStorage). Staff and admins are not limited. Older tokens
  without `sid` keep working until the account's next login.
- **Hidden developer accounts (2026-10-12):** user field `hidden`; such accounts are left out of
  Admin → Users (list, search, counts), the user detail/edit endpoints (404) and the dashboard
  stats (`visible()` in `user-admin.service.ts`); the "keep one active admin" rule ignores them.
  Made with `create:admin --hidden` (`--role student --paid` for a paid student, plan
  `three_months` since 2026-10-16 (was `till_test_day`), no end date, country PK). Live accounts: **`dev-admin@satsharks.invalid`**
  (admin, same role as `admin2.0@gmail.com`) and **`dev-student@satsharks.invalid`** (paid
  student). `.invalid` can never receive mail, so no one can take them over by password reset.
  Passwords were given to Umair only; not stored anywhere in the repo. Reports filed by a hidden
  student still show its name/email in the report queue.
- **Country at sign-up** (required, ISO code): `PK` → `region: local`, anything else →
  `international`. Never from IP. Accounts made before this have `country`/`region` null; such a
  student adds it **once** on Leaderboard → My country (`PUT /api/student/country`, 409 when a
  country is already set; it also sets the region). On 2026-10-16 one live student had none.
- **Clear deleted accounts (2026-10-16):** Admin → Users → Deleted tab → "Delete all permanently"
  (admins only, `users:write`, `DELETE /api/admin/users/deleted`, `userAdminService.purgeDeleted`).
  Removes each still-deleted, non-hidden account with its attempts, full tests, question log,
  mistakes and day totals, and takes it off friend lists. Problem reports are kept (no reporter
  shown). Until cleared, a deleted account can still be restored.
- **Bulk actions in Admin → Users (2026-10-20, client via Umair):** a checkbox per row, a header
  checkbox for the page, **Select all (N)** (every account matching the tab, filters and search,
  across pages) and "Select all N matching users" after ticking a page. The bar then offers Delete
  selected (All/Paid/Free/Disabled tabs) or Restore selected / Delete permanently (Deleted tab);
  "all matching" deletes ask for DELETE to be typed. `POST /api/admin/users/bulk` (`users:write`,
  `bulkUsersSchema`: `action` delete/restore/purge + `ids` (≤500) **or** `filter`),
  `userAdminService.bulk`. **Admin accounts and the acting admin are always skipped** (checkboxes
  disabled; the server skips them too and reports `skipped`), so "delete all" cannot lock admins out.
- **Member badge (2026-10-20):** under "Student portal" in the student sidebar (and first in the
  phone tab strip): red "PREMIUM MEMBER" pill with a medal for an effective paid plan (end date in
  the tooltip), grey "FREE MEMBER" linking to /pricing otherwise (`MemberBadge` in
  `student-sidebar.tsx`). Follows `/api/auth/me`, so an admin upgrade or approved payment shows on
  the next session check (tab focus or reload).
- **Forgot / reset password** through Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`). Token: 32
  random bytes, only its SHA-256 stored, 30 minutes, single use, same answer for unknown emails,
  a reset signs out every older session (`passwordChangedAt`). Without the key, development prints
  the link in the API console.
- **Landing page** (`app/(landing)/page.tsx`, own layout since 2026-10-09; Claude Design's
  "SAT Sharks — Landing page"): full-width blue hero with the nav on it (`<Nav tone="brand" />`),
  announcements under the nav, an interactive test-screen laptop (`components/landing-test-demo.tsx`:
  pick an answer, mark for review), a phone showing a drill (≥720px), floating tool callouts
  (≥1260px); bank facts, six features (three illustrated), both ways to practise, how it works,
  closing call to action. Font Plus Jakarta Sans on this page only (rest of the site: Roboto).
  `HomeActions` buttons are styled for blue. Only true, fixed figures; no invented student numbers.
- **Log in, sign up, forgot / reset password** (`app/(auth)/…`, own layout since 2026-10-09; Claude
  Design's "SAT Sharks · Log in / Sign up"): from 1024px a blue brand pane (logo, headline, a small
  test-screen card, three features) beside the form; below that a short blue bar with the logo and
  Pricing / Log In / Sign Up (or "Dashboard" / "Admin portal" when signed in) above the form card.
  Log in and sign up have a Log in | Sign up switch on the card. All in `components/auth-ui.tsx`
  (`AuthShell` with `tab`, fields with `icon`, `authButton` / `authButtonOutline`); behaviour,
  validation and redirects unchanged. Plus Jakarta Sans, like the landing page.
- **Delete** drills, mocks and full tests from their cards (with confirmation).
- **Pricing is editable** in Admin → Settings (plan names, PKR/USD prices, periods, saving badges,
  points, most popular, comparison rows, the lines under them and a **refund policy** line, default
  "All payments are final: SAT Sharks does not offer refunds."). Stored as setting `pricing`;
  the pricing page reads `GET /api/pricing`. The plan ids are fixed (accounts store them).
  **Three plans since 2026-10-16** (client): Free, Monthly, 3 Months, in PKR and USD. "Till Test
  Day" (`till_test_day`) was removed: it is in `LEGACY_PAID_PLANS` only, so the user model still
  accepts it and such an account stays paid (Admin → Users shows it as plain "Paid"; it can be
  moved to Monthly / 3 Months). Pricing saved with four plans has the old plan dropped on read
  (`settingsService.getPricing`), keeping the admin's other edits; the live saved pricing still
  lists it until an admin saves Admin → Settings again. On 2026-10-16 only the hidden
  `dev-student@satsharks.invalid` stored `till_test_day` (left as it is: no live writes).
- **Login / sign-up / forgot / reset pages** redesigned (split brand panel, inline validation,
  password show/hide, loading states). **Pricing** (proposal pp. 9–10, PKR/USD switch),
  **Terms** and **Privacy** pages (factual, not legally reviewed), site footer, phone menu.
- **Question bank: 9,927 questions** (2,207 Math, 7,720 Reading & Writing) in **41 papers**, one per
  exam source and section. Every question has a correct answer, a topic and a skill.
  **All 41 papers are published** (visible to students).
- **201 question images** copied from the source into our MongoDB `assets` collection and served
  at `/api/assets/<key>`. No question points at the source's servers.
- **Practice drills:** pick exam, section, domains, skills, difficulty, count, timer, exclude
  answered; Bluebook-style test screen; per-question "Check"; results and review. Since 2026-10-30
  questions never given to the student come first, then the ones given longest ago (`freshFirst`).
- **No repeats (2026-10-30, client):** every question has a fingerprint `contentKey`
  (`contentKeyOf` in `question.model.ts`: text, figures, images, normalised; set on import, upload
  and admin edit; backfilled on Atlas with `apps/api/src/cli/backfill-content-keys.ts`). 9,927
  published questions = 9,044 distinct; 684 twin groups, **445 of them inside a single exam**
  (the source reused questions), which is why the client saw repeats inside one module. "Seen" =
  given in any of the student's attempts in that section, deleted ones too (`seenByKey`). Drills,
  mocks and full tests take never-seen first, then oldest seen; one per fingerprint per test.
- **Top-up of small exams (2026-10-30, client):** **11 of the 26 exams have no Math** and October
  07, 2023 has 22 (two modules need 44); May 06, 2023 has 38 R&W (needs 54). When the chosen exams
  cannot fill both modules, `checkedMockPool` adds the account's other open exams as `fallback`
  candidates, stored on the attempt (`extraPaperIds`) so Module 2 uses the same pool. Order:
  never-seen questions of the chosen exams, then never-seen of other exams, then repeats. The start
  dialog no longer says "Choose more exams" and **says nothing about it** (client: students must
  not be told an exam has no Math; a note was added and removed the same day; premium accounts'
  pool-size line is hidden for a topped-up section too); refused only when even all open exams are
  too few. A full test on an exam
  without Math already sent no Math exam ("all exams"); the dialog used to block it.
  `continueFullTest` takes the account's access only to choose top-up exams (no plan check).
- **Adaptive mocks:** one section in two modules. Math 22+22 (35 min each), Reading & Writing 27+27
  (32 min each). Module 2 is built on the server after Module 1 is submitted: harder if Module 1
  correct ≥ ⌈size × threshold⌉, otherwise easier. Threshold **65%** (15/22 Math, 18/27 R&W), an
  admin setting. **Modules follow the official pattern** (2026-10-30, `MODULE_PATTERN`; evidence in
  `docs/adaptive-testing.md`): R&W 27 = Words in Context 4, Text Structure 2/3, Cross-Text 1/0,
  Central Ideas 2, Command of Evidence 4 (2 on a table/graph), Inferences 2, Boundaries 3 + Form 3
  (mixed), Transitions 3, Rhetorical Synthesis 3, in that order, easier→harder per block; Math 22 =
  Algebra 8/7, Advanced 7/8, PSDA 4/3, Geometry 3/4 with 6 grid-ins at 5–6, 11–12, 17–18.
  Admin → Settings "Official question pattern" switches back to the old spread
  (`AdaptiveSettings.officialPattern`, default on). Harder Module 2 prefers hard-tagged questions,
  easier prefers easy-tagged; never-seen before seen; each module has its own server clock; a
  submitted module cannot be reopened. Results show per-module scores and the route.
- **Full test:** Reading & Writing mock → 10-minute break (skippable, auto-continues if the page is
  open) → Math mock (`fulltests` collection; Math created only when the break ends).
- **Extended time** 1.5× / 2× chosen when starting a mock or full test (multiplies every module).
- **Time tracking** on the server: per question (between question loads), per module and per
  attempt. **Scaled scores**: 200–800 per section from admin-entered conversion tables (one per
  section × Module 2 route), total 400–1600 = sum. Logic only in `apps/api/src/services/scoring.ts`.
  **No tables are entered yet**, so the built-in estimate `DEFAULT_CONVERSION_TABLES`
  (packages/types; harder route 200–800, easier route 200–650) is used for every route without an
  entered table, shown pre-filled in Admin → Settings. A section whose question count differs from
  27+27 / 22+22 (e.g. an uploaded test) is scored by its share correct. "Pending" now only shows
  for a mock that ended before Module 2.
- **Results page:** section/total score, correct/incorrect/skipped and time per module, time per
  question, report a problem from the review.
- **Report a problem** on every question (test screen and review); admin queue with the question
  editor beside the report, resolve/reopen with history and an "also resolve the others" option.
  Since 2026-10-20 the report page opens with a full-width **"As the student saw it"** card (test
  screen layout, figures full size, answer key marked; reads the editor's cached question so it
  follows saves) and, for a figure kind the site cannot draw, its stored data.
- **Answer-choice images (2026-10-20):** a choice's figure may be `{ type: "image", url }` (drawn by
  `Viz`). The question editor has "+ Add image" / Replace / Remove under each choice
  (`ChoiceImage`), a red notice when choices are empty (also on the report page), and sends
  `choices[].image` (URL = set, null = remove an image but keep a drawn figure, left out = keep;
  new URLs must be uploaded assets, `requireUploaded`). The server names the empty choices
  ("Choice A, B, C are empty: …") instead of the old "needs every choice filled in".
- **Highlights & Notes (2026-10-30, client: "like Bluebook"):** header button + select words in the
  passage or question → toolbar: yellow / blue / pink, underline, note, delete; click a highlight
  to change it. Stored per attempt item (`items.annotations`: target, start/end character offsets
  of the rendered text, colour, underline, note ≤ 500, ≤ 60 per question), saved by
  `PUT /api/practice/attempts/:id/questions/:n/annotations` (only while running and in the current
  module), returned with each question. Painted with the CSS Custom Highlight API
  (`components/annotations.tsx`, `::highlight(sat-*)` in globals.css), so question markup is never
  changed; a browser without it gets an "update your browser" message. Not on answer choices.
  Before this there was **no highlighter at all** (students lost a plain text selection).
- **Question counts for premium only (2026-10-30, client):** exam-card Total/RW/Math pills, the
  drill dialog's section counts, the mock dialog's pool sizes and the practice-test card counts show
  only when `access.paid` (UI only; the catalog API still sends them).
- **Test screen tools:** timer (hide/show), directions, mark for review, cross-out (ABC),
  question navigator, **Desmos calculator** (`desmos.com/testing/collegeboard/graphing` in an
  iframe) **docked on the left like Bluebook since 2026-10-20** (`components/calculator-dock.tsx`):
  the question moves over beside it instead of being covered; 36% of the window when opened, an
  expand button for 60%, a drag handle on its edge (min 320px, the question keeps ≥420px); above the
  question (45% of the height) under 1024px; closing only hides it, so its work is kept while the
  test screen is open. **Reference sheet** still a floating draggable window (from Umair's other
  project; see §6).
- **Admin** (sidebar: Dashboard, Papers, Questions, Reports, Settings; tab strip on phones):
  stats incl. users by region and pending reports, publish/hide per paper and in bulk, question
  bank with filters/search/paging, question editor (shared component `question-editor.tsx`) with
  live preview, delete, adaptive threshold, conversion tables, problem-report queue.
- **Uploaded practice tests (full-test PDF upload)** — see `docs/full-test-upload.md`. Admin → Full
  tests: upload an English and a Math PDF (Module 1, 2 Easy, 2 Hard each) in a strict text format,
  checked during the upload; review screen with live preview and the same rules as the server;
  publish (two hidden papers, questions tagged `full-test`); add images; activate. Students see
  "Full-Length Practice Tests" on Home and sit them through the normal full-test flow; Module 2
  follows the same routing rule (65%). The tagged questions never reach drills, random mocks or
  the catalog. Math may be LaTeX in `$…$` (like the bank) or plain text (the other site's style,
  converted); CATEGORY is a bank domain or skill, or one of the other site's category names.
  **Each upload goes to Practice tests or Exams** (chosen in the upload dialog, changeable in Edit
  details, also after publishing). An **exam** (a real administration, e.g. the December SAT) has
  a title and exam date; when active it is a normal card under Exams (year/season filters, Start
  Exam = drill), its questions join drills and random mocks, and the card adds **Take Full Test**.
- **Question editor** (bank, reports, uploaded tests): image drag-and-drop upload (PNG/JPEG/WebP,
  stored in `assets`), editable choices with Set/Correct, question-type switch (Math), Math symbol
  bar and a visual equation editor (MathLive), live preview including the explanation.
- Rendering: LaTeX (KaTeX, Math only), tables, bar/line charts, right triangles, images,
  `**bold**`, `*italic*`, `__underline__`, bullets, blanks, `{viz}` figure placement.
- **Logo and favicon** (2026-10-09): the client's logo traced to SVG (`components/logo.tsx`,
  `currentColor`; brand blue `#324dc7` in the nav, white on the sign-in panel), sources in
  `docs/brand/`. Favicon = the fin and wave in white on a brand-blue rounded square:
  `app/icon.svg`, `app/favicon.ico` (16/32/48, bolder at small sizes), `app/apple-icon.png`.
  Tab titles use "|" (e.g. "Log in | SAT Sharks"), never a dash. Nav is bottom-aligned (logo
  letters level with the button bottoms).
- **Light mode only:** `colorScheme: "only light"` (viewport) + `color-scheme: only light` (CSS),
  so phone browsers' automatic dark mode does not recolour the site (it turned the brand blue
  pale purple). A real dark theme would be a separate piece of work.
- **Fast test screen:** the next question is fetched ahead (`GET …/questions/:n?peek=1`, which
  does not record a view), questions already seen are kept, so Next/Back show at once; the normal
  GET (records the view and timing) still runs in the background, one at a time in order.
  **Remembered session:** the last signed-in account is kept in `localStorage` (`satsharks.me`) and
  shown at once while `/api/auth/me` re-checks; cleared on sign-out or a 401.
- **Access by plan (2026-10-09):** Admin → Access (`/admin/access`, `papers:read` to view,
  `papers:write` to save) sets each way of practising (drills, adaptive section mocks, pool-built
  full tests) and each exam / uploaded test (practice tests and uploaded exams, key `upload:<id>`)
  to **Free** or **Paid only**, plus the level for exams/tests published later. Setting `access`;
  logic in `apps/api/src/services/access.service.ts`; enforced when something is started
  (`practice.service`), never on attempts already begun. Paid = `effectivePlan` paid (plan set on
  the Users page, not expired), staff and admins. A free account's "All exams" mock pool is the
  exams open to it. Students see a "Paid" pill and "Unlock with a paid plan" (→ /pricing).
  **Until an admin saves the page, everything is free** (no change for existing accounts).
- **Announcements (2026-10-09):** Admin → Announcements (`/admin/announcements`; anyone with
  admin access reads, `papers:write` writes): title, message, audience (all / free / paid, same
  paid rule as access), style (info / important), on/off, optional "show until". Collection
  `announcements`; `announcement.service.ts`; `GET /api/announcements` gives the signed-in
  account its active ones (newest 5). Shown as banners at the top of every `(site)` page to
  students (not admins/staff) by `components/announcements.tsx`; dismissed per browser
  (`localStorage` `satsharks.dismissed`, keyed by id + updatedAt, so an edit shows it again).
- **FAQ (2026-10-11):** ten questions in Umair's own wording (`components/faq.tsx`, `FAQS`), as an
  accordion on the landing page (`#faq`, before the closing call to action) and on `/faq`. **Used
  exactly as written at Umair's request, although some answers are not true yet** (see §6, §9).
- **SAT dates (2026-10-11):** public `/sat-dates` (upcoming dates table / phone cards with
  registration status, a 5-step registration guide for Pakistan, College Board links), editable in
  **Admin → SAT dates** (`/admin/sat-dates`; `admin:access` views, `papers:write` saves). Setting
  `satDates` (`SatDatesContent`, `satDatesContentSchema`: YYYY-MM-DD, deadlines before the test day,
  no duplicates, sorted on save); `GET /api/sat-dates` (public), `GET/PUT /api/admin/settings/sat-dates`.
  Defaults = College Board's 2026-27 dates (Oct 3, Nov 7, Dec 5 2026; **Mar 6**, May 1, Jun 5 2027)
  with score-release notes. Past dates hide themselves. Helpers in `lib/sat-dates.ts`.
- **Dashboard countdown (2026-10-11):** `components/sat-countdown.tsx` at the top of `/dashboard`
  (above the Adaptive Mock / Practice Drill cards, then Exams): next SAT date, days/hours/minutes/
  seconds to midnight at the start of test day in the student's time zone, registration status and
  a link to `/sat-dates`; moves to the next date after test day; hidden when none is set.
- **WhatsApp button (2026-10-11):** `components/whatsapp-button.tsx`, fixed bottom right (48px on
  phones, 56px from 640px; made smaller at Umair's request), opens `https://wa.me/923066595745`
  (0306 6595745) with a typed-in message ("Hi SAT Sharks! I need some help. Here is my question or
  issue: ", `WHATSAPP_MESSAGE`). In the `(site)`, `(landing)` and `(auth)` layouts, so
  never on the `(test)` test screen; also hidden on `/admin/*` (staff pages with bottom save bars).
  Footer links added: SAT Dates, FAQ; the footer has extra right padding from 640px up so the
  button never covers a link.
- Fonts Roboto (interface) and Noto Serif (question text) via `next/font`. Page container up to
  1700px wide, 16px/32px side padding — measured from the reference site's stylesheet.

- **Student panel (2026-10-14, reshaped the same day at Umair's request):** the student **home
  `/dashboard` is unchanged** (countdown, start cards, exams; no sidebar). The nav has **Home ·
  Dashboard · Review** for students; **Dashboard opens `/portal`**, the panel's own page ("today"
  strip `components/today-strip.tsx`: goal, streak, mistakes due, predicted score vs target; then a
  card per section). Panel pages sit in `app/(site)/(student)/` (URLs unchanged) beside
  `components/student-sidebar.tsx` ("Student portal": Dashboard (/portal), My tests (/practice),
  History, Mistake bank (red due count), Analytics, Goals & streaks, Leaderboard; streak, Home,
  SAT dates, FAQ, Upgrade at the bottom; a tab strip on phones). Results and full-test pages are in
  the panel too. The nav saves the browser's time zone for students (`useTimeZoneSync`;
  `PublicUser.timeZone`).
- **Week 3 (proposal 3.1–3.3, 2026-10-14).** Everything reads from a **permanent question log**
  (`questionlogs`, `QuestionLogModel`): one entry per question per attempt, written by
  `activity.service.ts` when a drill question is checked (in the background) and when an attempt
  ends (`finalize`); drill blanks are not logged, test blanks are. It also gives points, day totals
  (`dailystats`), the streak (user `streak`) and the mistake bank (`mistakes`). Pure rules in
  `services/engagement-rules.ts` (unit-tested).
  - **3.1** Deleting a drill/mock/full test now only sets `removedAt` (hidden from My tests, kept in
    history and analytics). History page: tests with score, change since the previous one of its
    kind, score-over-time chart; questions with filters (result, section, topic, difficulty, dates),
    each opening its review (`/practice/<id>/results?q=<n>`). Mistake bank: every wrong answer;
    **retry queue** 1, 3, 7, 16 days (wrong again → next wait, stays at 16; right → fixed; wrong
    later → reopens). "Retry" starts a drill of due mistakes (`POST /api/practice/drills/retry`).
    **Drill mode across the bank**: "All exams (by topic and skill)" in the drill dialog
    (`POST /api/practice/drills/bank`, open exams only, origin `bank`).
  - **3.2** `analytics.service.ts`, page /analytics: predicted score = weighted average of each
    section's last 5 scores, total moves **at most 50 points per scored section**, range ±30–100
    narrowing with data, trend chart; skills sorted by estimated points to gain
    ((1 − accuracy) × skill's share of the bank × 600); error patterns (changed a right answer —
    answers are now remembered per item, `items.answers`; ran out of time — blanks when the clock
    closed a module, `m1TimedOut`/`timedOut`; trap — the wrong choice ≥40% of ≥5 students' wrong
    answers picked; topic not known — skill accuracy < 60%; otherwise careless); timing (average vs
    official pace 71 s / 95 s, pace chart of the latest timed test, slowest questions). Each part
    ends with a next step and a button that starts the matching drill. **Skills breakdown**
    (2026-10-31; the client calls it "areas to improve"): a Reading & Writing / Math selector; each
    section has its own list and next step (`Analytics.skillSteps`). Opens on the first listed
    section, so a student with answers in one section never opens on an empty list.
  - **3.3** Daily goal (questions or minutes; suggested 20 + 10 × points-per-day still needed,
    15–80) from target score, predicted score and test date (own or next SAT date). Target score
    400–1600 in steps of 10; the boxes on Goals & streaks round and limit only when the student
    leaves the box (`NumberField`). Streak = days the
    goal was met, in the student's time zone; freezes used by themselves (free 1, paid 3 a month);
    badges at 7/30/100. Points: 10 right (+5 hard), 2 for a real wrong try, nothing under 10 s (R&W) /
    8 s (Math), nothing for a set that is mostly that fast, 300 a day at most. Leaderboards global /
    country / friends (friend codes, both ways), week (ISO, Monday) / all time; **full names**
    on boards and the friends list since 2026-10-16 (client; the share card keeps first name +
    initial); opt-out. Share card (canvas, 1080×1350, real first/best full-test totals and streak; share sheet,
    download, WhatsApp). **Emails** `jobs/engagement-emails.ts` in the API every 15 min: streak at risk
    (7–10 pm local) and weekly progress (Monday 9–12 local), claimed in the DB so never sent twice;
    off without Resend or with `ENGAGEMENT_EMAILS=off`. Settings on Goals & streaks.
  - **Free vs paid** (proposal p.10): new Access feature **"Full analytics & mistake bank"**
    (`analytics`). Locked: score only (no range/trend), top 3 weak areas per section (since 2026-10-31), no error/timing analysis,
    last 20 mistakes. **Free until an admin saves Admin → Access**, like the others; a setting saved
    before this feature existed keeps its choices and reads analytics as free.

- **Week 4 (proposal 4.1–4.4, 2026-10-19).**
  - **Payments** (`payment.service.ts`, `payment-rules.ts`, `payment-gateways.ts`, collection
    `payments`, `PaymentModel`). Students buy on `/checkout?plan=` (student panel) in their
    account's currency (PK → PKR, else USD; the pricing switch is display only). Amount = the price
    typed in Admin → Settings → Pricing, parsed (`parsePrice`). Ways to pay: **bank transfer,
    JazzCash, Easypaisa** (Admin → Settings → Payments: on/off, account details, currencies) — the
    student sends a transaction ID, status `review`, an admin approves (plan given, receipt email) or
    rejects (student emailed the note); one waiting at a time, a transaction ID once. **Card**: only
    a **test gateway** (`PAYMENTS_TEST_GATEWAY=on`, refused in production; page `/checkout/test`)
    because SAT Sharks has not chosen a gateway (adapter interface ready). The plan is given only in
    `markPaid` (guarded update, once). Period = 1 or 3 calendar months from now, or from the end of a
    running plan (renewing early loses nothing); paid-without-end-date stays so. Nothing is charged
    automatically: "cancel" = `autoRenew:false` (no renewal reminder; the plan just ends).
    Receipts `SS-YYYYMMDD-XXXXXX`, printable at `/receipts/<id>`. Billing page `/billing` ("Plan &
    billing" in the student sidebar): plan, end date, cancel/renew, payments, receipts, friend invites,
    one-time offer.
  - **Admin**: sidebar **Payments** (`payments:read`/`payments:write`, admins only, new permissions)
    with a red count of unseen payments (cleared on opening the page, polled every minute), approve /
    reject, search by name/email/phone/transaction ID/receipt, revenue. **Alert email** to the
    owner (Settings → Payments alert email, else env `PAYMENT_ALERT_EMAIL`) when a transfer arrives
    or a card payment goes through. Dashboard adds paid vs free, sign-ups today/7 days, practice
    started today, revenue this month / all time (PKR, USD), transfers to approve ("today" =
    Pakistan). Users: phone search (digits, leading 0 ignored), delete/restore from the list,
    **Export CSV** (`GET /api/admin/users/export`, same filters, formula-safe cells), deleted
    accounts show "restore until" and are **removed by the scheduler 30 days after deletion**
    (`deletedAt`; accounts deleted before 2026-10-19 have none and are never auto-removed). User
    page: phone, payments, restore deadline.
  - **Paper control**: Papers page select several → publish/hide selected; **schedule** a draft or
    hidden paper (`publishAt`); Full tests: schedule activation of a published test (`activateAt`).
    Admin → Access per exam/test: **Free / Paid only / Invite code** (code per item, unique;
    students type it on Home → "Have an invite code?", stored in `user.inviteKeys`; paid plans do
    NOT open invite-only content), **Pin to top**, **label** New / Hard / Most attempted; free daily
    **drill limit** (`freeDrillQuestionsPerDay`, null = none; exam and bank drills count, mistake
    retries do not; a longer drill is cut, then 403 `daily_limit`). Catalog/tests carry `lockReason`,
    `pinned`, `label`, `free`; pinned first; cards show Featured/label/Free pills.
  - **Conversion set-up**: locked results panel (`components/locked-insights.tsx`, analytics
    `locked: {skills, points}` for the free view; real numbers, skills not sent); score gap + own
    test countdown on Home (`components/goal-gap.tsx`) and a "Test in N days" chip in the nav for
    students; price anchoring (pricing tagline); **exit offer** (Settings → Payments, 5–50%, shown
    once per browser on leaving `/pricing`, desktop mouse-out or 40 s on phones; applied at checkout
    with `offer=1`, once per account `exitOfferUsedAt`); **friend invites** (`/register?ref=<friend
    code>` → `referredBy`, friends at once; a friend counts at 50 points; every 2 → 7 free days, at
    most 5, recorded as a `referral` payment of 0); **renewal reminder** 2 days before a plan ends;
    **come-back email** 7 days after the last practice; **proof** (`GET /api/public/proof`: students
    practising in the last 15 min, shown from 5; real first→best full-test gains of students on the
    leaderboard, "Ayesha R.") on landing and pricing. Sign-up asks optional phone and SAT date.
  - **Scheduler** `jobs/scheduler.ts` in the API (env `SCHEDULER=off` to stop): every minute
    publishes/activates scheduled content; every 15 min friend-invite rewards and (with Resend)
    renewal and come-back emails; hourly the 30-day purge.
  - **SEO & GEO**: root metadata (`metadataBase` from `NEXT_PUBLIC_SITE_URL`, else Vercel's
    production URL), default share image `app/opengraph-image.tsx`, canonical + descriptions on
    public pages, `sitemap.ts`, `robots.ts` (private paths closed, AI crawlers named and allowed),
    `/llms.txt`, JSON-LD (Organization, WebSite, Course, FAQPage on `/` and `/faq`, Product offers on
    pricing, Article + breadcrumbs on guides), **guides** `/guides` + 4 guides (`lib/guides.ts`),
    `/pricing/pakistan` (PKR) and `/pricing/international` (USD) with hreflang; `/pricing` picks the
    currency from Vercel's `x-vercel-ip-country` for visitors. Signed-in students see only their
    account region's prices on every pricing page, with no switch (§6, 2026-10-19). GA4 when `NEXT_PUBLIC_GA_ID` is set; Search
    Console tag from `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`. **Refund page** `/refund` (reads the
    refund line from pricing); Terms "Plans and payments" rewritten for the real flow.
  - **4.4**: `docs/admin-guide.md` (for SAT Sharks' admins), `docs/launch-checklist.md`, load test
    `apps/api/test/load/load-test.mjs` (read-only).

### Not built yet

- Conversion-table **values** from SAT Sharks (the built-in estimate is used until then; the admin editor is ready). Per-paper tables
  wait for "build a paper" (mocks mix exams, so tables are per section and route for now).
- Google sign-in. A real **card payment gateway** (SAT Sharks to choose; only the test gateway
  exists). Launch work in `docs/launch-checklist.md` (domain, env vars, Search Console, GA,
  Lighthouse, cross-browser and load runs).
- A legal contact address on Terms/Privacy/Refund.
- AI extraction from free-form PDFs (proposal Checkpoint 1.2). Only the strict-format test upload
  exists. Building papers from approved bank questions.
- Line reader (Checkpoint 2.1). Re-grading old attempts after an answer key is fixed.
- Week 3 gaps: history starts on 2026-10-14 for questions (older attempts were never logged; their
  test scores do appear in test history and the prediction). Points/streak reminders are emails only
  (no in-app notifications).

### Deployment (in progress, 2026-10-09)

- **Railway** (client account, project "carefree-imagination"): one service `@satsharks/api`,
  repo root (no root directory), no build command, start `npm run start --workspace=@satsharks/api`,
  watch paths `/apps/api/**`, `/packages/**`, `/package.json`, `/package-lock.json`. Domain
  `https://satsharksapi-production.up.railway.app`. Variables: `NODE_ENV=production` (meant to be
  set; live `/api/health` said `development` on 2026-10-23), `MONGODB_URI`, `JWT_SECRET` (new,
  production only), `CLIENT_URL` (= the Vercel URL), Resend, `PROXY_SECRET` (same value as Vercel).
  The auto-created `web` and `worker` services were deleted (web is on Vercel; the worker needs
  Redis and is not used live). Atlas Network Access must allow `0.0.0.0/0`.
- **Latency (2026-10-09):** Atlas cluster `cluster0.wprq5io` is in **Mumbai**; the Railway API was
  in Railway's default (US) region, so each database round trip cost ~300 ms (live `/api/health`
  ~330 ms vs `/api/pricing` ~650 ms from Pakistan) and a question load ~1–2 s. **Move the Railway
  service to Southeast Asia (Singapore)** (service → Settings → Deploy → Regions); asked of Umair.
- **Vercel** (client account): project `satsharks-platform`, root directory `apps/web`, preset
  Next.js, default commands, `API_URL=https://satsharksapi-production.up.railway.app` (with
  `https://`, no trailing slash; read at build time, so redeploy after changing it).
  `PROXY_SECRET` (same value as Railway; `docs/security.md` "Rate limiting"): without it in both,
  every visitor shares the API's rate limits, because the API sees Vercel's address.
- First Vercel build failed (`Cannot find module 'typescript'`, §8); fixed in `9319fcc`.
- **Vercel Hobby blocks private-repo commits not authored by the Vercel owner** ("Deployment
  Blocked", also for builds started by a Deploy Hook). Umair made the client repo **public**
  (2026-10-09), so pushes by `satsharks20` deploy again. If it ever goes private: author commits
  as `sadsharks81-max <309707139+sadsharks81-max@users.noreply.github.com>`, or Vercel Pro.
  A Deploy Hook (branch `main`) exists; its URL is in local `.env` as `VERCEL_DEPLOY_HOOK`
  (secret, never commit or print it). POST to it to rebuild the latest `main`.
  Not yet checked: `/api/health` on Railway, the live site end to end.

### Last verified

- **Uploaded practice tests (2026-10-07):** typecheck clean; 46 unit tests (32 API incl. 11 new
  parser/rule tests, 14 worker); **13 end-to-end checks** against a throwaway in-memory MongoDB
  (`mongodb-memory-server`; Atlas never touched): input validation, both PDFs read with exact
  counts, formulas/money/paragraphs/grid-ins kept, wrong-section/broken/unknown-category/bad-LaTeX/
  bare-dollar PDFs rejected with reasons, review validation, publish, exclusion from catalog/drills/
  random mocks/bulk publish, activation guard, a student routed R&W hard (27/27) and Math easy
  (11/22 < 15) with grid-ins graded, question edit with image and type change, deactivate/delete.
  All the port kit's sample and demo PDFs and our own (incl. 1.5 and double spacing) parse with no
  errors. Browser click-through (Chrome, test API on 4100 + web on 3100 against that database):
  upload, failed section, re-upload, review with a flagged question, symbol bar, visual editor,
  publish, activate, image upload, phone layouts (no overflow), a student starting the test. Only
  console errors: the existing 401 session check and missing favicon on /login.
  **Not tested:** real client PDFs (none yet), Word/Google Docs exports, `next build`.

- **Phase 2 (2026-10-03):** typecheck clean; 35 unit tests (21 API, 14 worker); **82 end-to-end
  checks** against the real database on a second API instance (port 4100): sign-up/region, the
  whole reset flow (expired, reused, malformed tokens, old sessions signed out), extended time,
  per-question and per-module timing, timer expiry, reports (duplicates, other users, closed
  modules), scoring from tables, full test incl. two simultaneous "continue" calls, admin
  report resolve (double click) / reopen. Headless Chrome screenshots of every page at 390px and
  1440px: no horizontal overflow; one hydration error (country names) found and fixed. Test
  accounts, data and the temporary conversion table were removed; the one edited question was
  restored. **Not tested:** a real Resend send (no key here), `next build`.
- Before the reference-sheet and calculator changes: typecheck clean; 27 unit tests pass
  (14 worker, 13 API); 32 end-to-end mock checks and 67 earlier drill/admin checks passed against
  the real database; screens reviewed from headless-browser screenshots.
- **The reference sheet (black figures, drawn square roots, moved labels) and the floating
  calculator were NOT tested in the app** — Umair asked for changes without testing. Only the type
  check was run. Check them in a Math drill or mock.

- **Upload destination (2026-10-08):** typecheck clean; 49 unit tests pass. Its e2e check (exam
  upload → Exams card, drill, mock, full test; moved to practice and back) **passed on 2026-10-09**
  (VC++ runtime back; all 14 e2e checks pass).
- **Speed + session (2026-10-09):** 12 browser checks (puppeteer-core from the scratchpad, every API
  call delayed 800 ms) against the e2e `--serve 4100` API and a `.next-test` web on 3100: Next
  and Back 25–65 ms with no spinner, look-ahead uses `peek=1`, the real view is still recorded,
  answers kept on return, `lastPosition` correct after fast Back/Next, dashboard shows before
  `/me` answers, sign-out and expired sessions clear the remembered account and reach /login.
  Forced dark (Chrome `WebContentsForceDark`) leaves the pages light; nav alignment screenshot.

- **Access by plan (2026-10-09):** typecheck clean; 49 unit tests; **15 e2e checks** (in-memory
  MongoDB) incl. a new one: defaults open, admin GET/PUT (403 for students, duplicate keys 400),
  locked catalog/tests for a free account, 403 on locked drill/mock/full test/uploaded test, free
  "All exams" mock limited to the open exam (403 when none), paid account opens everything, an
  expired paid plan counts as free, a full test begun while paid continues after expiry, admins
  never locked. Headless Chrome (e2e `--serve 4100` + `.next-test` web on 3100): Admin → Access at
  1440/390px, free dashboard at 1440/390px, mock and drill dialogs; no horizontal overflow. The
  only console errors are the existing 401 session check and the nav hydration error (§8).

- **FAQ / SAT dates / countdown / WhatsApp (2026-10-11):** type check; 49 unit tests; **17 e2e
  checks** (new: public `GET /api/sat-dates` = defaults, 401/403 for visitor/student saves, six
  invalid saves refused with a reason, sorted save, trimmed note, public endpoint follows, empty
  list allowed, defaults restored). **11 browser checks** against the e2e `--serve 4100` API and a
  `.next-test` web on 3100 with the seeded test accounts: landing FAQ (10 items, opens, Pricing
  link), WhatsApp on landing/faq/sat-dates/pricing/login/register/dashboard/results and **not** on
  a real drill's test screen or admin; `/sat-dates` hides past dates and marks Nov 7 next; dashboard
  order countdown → cards → Exams, countdown ticks and its days match the calendar; admin editor
  refuses a late deadline with the server's message, adds/removes/saves and the student's
  dashboard and dates page follow at once; no sideways scroll at 390px; footer links clear of the
  button at 1440/820/390px. Only console errors: the usual 401 session check and the deliberate 400.
- **Announcements (2026-10-09, quick test as Umair asked):** typecheck clean; **16th e2e check**:
  free/paid/all audiences (incl. an expired plan = free), off and ended ones hidden, "show until"
  in the future shown, edit, delete (404 the second time), 400 on bad input, 403 for students.
  **Not checked in a browser** (admin page, banners, dismiss).

## 3. Git state

- `main` (newest first): `41f2bef` user management in admin (Umair), `8354da1` Phase 2 (Umair),
  `40120f4` nav sign-in/out fix, `777eba9` login/port fix, fonts, adaptive mocks, reference sheet,
  calculator; below: `d61bff3`, `aff4a62` (Umair) and `73b574d` (Phase 1 commit by Claude).
- Umair has since committed and pushed up to `02e41e2` ("chnaged button location"), which includes
  the 2026-10-08 work, to both `origin` and `client`.
- `9319fcc` (2026-10-09, Claude): Vercel build fix + deployment notes, pushed to both remotes.
- `592337f` (2026-10-09, Claude): logo and favicon, pushed to both remotes.
- Next commit (2026-10-09, Claude): "Faster test screen and session, nav alignment, light mode
  only", pushed to both remotes (see `git log`).
  Ask before committing or pushing.
- `4621469` (2026-10-09, Claude): access by plan, announcements, landing page redesign, pushed to
  both remotes. Next commit (2026-10-09, Claude): log in / sign up redesign, pushed to both remotes.
- Umair committed the FAQ / SAT dates / countdown / WhatsApp work and the hydration fix (up to
  `9fad05e` "few changes done"). Next commit (2026-10-11, Claude): "Show an estimated score
  instead of Pending", pushed to both remotes. Next (2026-10-12, Claude): "One device at a time
  for students; hidden developer accounts", pushed to both remotes.
- `a5ed021` "phase 3" (Umair): Week 3 + student panel (student pages moved with `git mv` into
  `app/(site)/(student)/`). Pushed to `origin` by Umair, to `client` by Claude on 2026-10-15.
  Needs the API and web live together (new `/api/student/*` routes); not yet checked live.
- Next commit (2026-10-16, Claude, asked by Umair): "Leaderboard country and full names, target
  score box, clear deleted users, remove Till Test Day", pushed to both remotes (see `git log`).
  Needs the API and web live together (new routes); the live site was not checked.
- `a61f316` "week 4 implemented" (Umair): the Week 4 work and the two 2026-10-19 fixes.
  `9df5d33` "new changes and few improvements" (Umair): the 2026-10-20 changes (bulk users, member
  badge, report view, Desmos dock, `viz.tsx` image/table fixes). Both pushed to `origin` by Umair,
  to `client` by Claude on 2026-10-21 (fast-forward `b84f8b1..9df5d33`).
- `docs/prompts/` (untracked) holds the phase briefs and the port kit from the other site
  (`full-test-port-kit/`, with its code and demo PDFs). Not committed so far; ask Umair.
- `docs/references/reference sheet/ReferenceSheet.tsx` is Umair's source file (untracked).
- Never commit: `.env`, `data/`, `*.har` (except `docs/references/network/bluecorn.org.har`, which
  has no tokens), `docs/purposal/`. All are in `.gitignore`.

## 4. How to run

```bash
npm install
# .env at the repo root (never .env.example): MONGODB_URI, JWT_SECRET, PORT=4000, CLIENT_URL,
# API_URL, SOURCE_API_KEY, SOURCE_ACCESS_TOKEN, RESEND_API_KEY, RESEND_FROM_EMAIL (see .env.example)
# Optional DNS_SERVERS=8.8.8.8,1.1.1.1 if MongoDB fails with querySrv ENODATA (see §8)
npm run dev:api     # http://localhost:4000/api/health
npm run dev:web     # http://localhost:3000 (pinned to 3000)
npm run typecheck
npm test
# Uploaded tests end to end (in-memory MongoDB, never Atlas):
node apps/api/test/e2e/make-test-pdfs.mjs <dir>
npx tsx apps/api/test/e2e/test-uploads.e2e.ts <dir>          # add --serve 4100 to keep it running
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm run create:admin -- --email <e> --name "<n>" [--role admin\|staff\|student] [--hidden] [--paid]` | Create/promote an admin. Password from env `ADMIN_PASSWORD`. `--hidden` = developer account kept out of Admin → Users and stats; `--role student` only with `--hidden`; `--paid` for students |
| `npm run collect:bank -- --list` | List the source's exam sources and sizes (needs `SOURCE_ACCESS_TOKEN`) |
| `npm run collect:bank -- --exam <id> --section math\|rw` | Collect one bank and import it as Draft |
| `npm run collect:bank -- --all [--section math\|rw]` | Collect every bank; cached ones cost no requests |
| `npm run assets:copy` | Copy question images into our storage. **Run after any `collect:bank`** (re-import resets image links) |
| `npm run scrape:paper -- <file.har> [--dry-run]` | Import one attempt from a HAR recording (the first proof of concept) |
| `npm run observe:mock -- --answers none\|key` | Take one source mock and record it to `data/mock-observations/` (needs token) |

## 5. Architecture (where things are)

npm workspaces monorepo, TypeScript everywhere, run with `tsx` (no build step for API/worker).

| Path | Contents |
| --- | --- |
| `apps/web` | Next.js 15 App Router, Tailwind 4, TanStack Query. `src/app/(site)/…` pages with the nav bar; `src/app/(landing)` home page and `src/app/(auth)` log in / sign up / password pages, each with its own layout; `src/app/(test)/practice/[id]` full-screen test screen |
| `apps/web/src/components` | `question.tsx` (passage/prompt/choices/answer box), `viz.tsx` (tables/charts/triangles), `create-drill.tsx`, `create-mock.tsx`, `draggable-panel.tsx`, `reference-sheet.tsx`, `attempt-card.tsx` (+ full-test card), `nav.tsx`, `footer.tsx`, `ui.tsx`, `auth-ui.tsx` / `auth-form.tsx`, `admin-sidebar.tsx`, `question-editor.tsx`, `report-ui.tsx`, `legal-page.tsx` |
| `apps/web/src/lib` | `api.ts` (fetch wrapper), `auth.ts` (session hooks), `rich-text.tsx` (markup + KaTeX) |
| `apps/api/src` | Express 5: `routes/`, `controllers/`, `services/` (`practice.service.ts` drills + mocks, `mock-assembly.ts` module builder, `settings.service.ts`, `admin.service.ts`, `auth.service.ts`, `email.service.ts` (Resend), `scoring.ts` (all scaled scores), `report.service.ts`), `middleware/`, `utils/grading.ts` |
| `apps/worker/src` | Import pipelines: `scrapers/source/bluecorn/*` (HAR reader, API client, bank collector, parsers), `scrapers/normalizers`, `scrapers/validators`, `services/`, `cli/*` |
| `packages/types` | Shared enums, DTOs, role→permission map, `MOCK_FORMAT`, default threshold |
| `packages/validation` | Zod schemas |
| `packages/db` | Mongoose models: User, Paper, Question, Asset, Attempt, Setting; `connectMongo`, `trusted` |
| `packages/config`, `packages/utils` | Env loading; logger and helpers |
| Uploaded tests | `apps/api/src/services/test-upload.service.ts`, `test-upload-parser.ts`, `pdf-text.ts`; `packages/db/.../test-upload.model.ts`; web `app/(site)/admin/tests/**`, `components/question-form.tsx`, `math-input.tsx`, `practice-tests.tsx`, `test-upload-ui.tsx`; `public/full-test/` (format guide, builder, samples); `public/mathlive/fonts` |
| Week 4 | API: `services/payment.service.ts` (+ `payment-rules.ts`, `payment-gateways.ts`), `public.service.ts`, `controllers/billing.controller.ts`, `routes/billing.routes.ts` (`/api/billing/*`), `jobs/scheduler.ts`; db `payment.model.ts`; web `(student)/{billing,checkout,checkout/test}`, `receipts/[id]`, `admin/payments`, `pricing/{pakistan,international}`, `guides/**`, `refund`, `robots.ts`, `sitemap.ts`, `llms.txt/route.ts`, `opengraph-image.tsx`, components `payment-settings`, `invite-friends`, `goal-gap`, `locked-insights`, `exit-offer`, `student-proof`, `pricing-page`, `json-ld`, `google-analytics`; `lib/{billing,site,guides}.ts` |
| Week 3 | API: `services/activity.service.ts` (logging, points, mistakes, streak), `engagement-rules.ts` (pure rules), `history.service.ts`, `analytics.service.ts`, `engagement.service.ts`, `jobs/engagement-emails.ts`, `controllers/student.controller.ts`, `routes/student.routes.ts` (`/api/student/*`); db `question-log`, `mistake`, `daily-stat` models; web `app/(site)/(student)/{history,mistakes,analytics,goals,leaderboard}`, `components/{student-sidebar,charts,share-card,today-strip}.tsx`, `lib/engagement.ts` |
| `docs/` | `full-test-upload.md`, `architecture.md`, `database.md`, `api.md`, `scraping.md`, `adaptive-testing.md`, `security.md`, `performance.md`, `phase-1-completion.md`, this file |

Web calls go to its own origin; `next.config.ts` rewrites `/api/*` to `API_URL`
(`http://localhost:4000`), so the auth cookie is first-party.

## 6. Decisions made by Umair (do not re-ask)

| Date | Decision |
| --- | --- |
| 2026-10-02 | Use MongoDB Atlas (database `satsharks`). URI lives only in `.env` |
| 2026-10-02 | Import from the reference site rather than client PDFs (content-ownership risk was raised and left to the client) |
| 2026-10-02 | Collect via Umair's own session token (`SOURCE_ACCESS_TOKEN`), not manual HARs. Math first, then Reading & Writing — both done |
| 2026-10-02 | Push everything to `main`; the repository stays public (proposal PDF kept out) |
| 2026-10-03 | SAT Sharks keeps its branding; copy the reference's fonts and side spacing |
| 2026-10-03 | Build adaptive mocks. Observe 2 source mocks (done). Routing threshold **65%** |
| 2026-10-03 | Math difficulty "learn from the mocks" was chosen, but the mocks showed the source tags every Math question easy, even in its hard module — so nothing was relabelled (see §7) |
| 2026-10-03 | Reference sheet: use Umair's own component from his other project (`docs/references/reference sheet/ReferenceSheet.tsx`), figures black, movable window, readable square roots, top 30°/45° labels lower, cylinder "r" higher |
| 2026-10-03 | Calculator: floating, draggable window like the reference site's, not a new tab |
| 2026-10-03 | For UI-only changes Umair may say "do not test" — then only typecheck, no login/browser runs |
| 2026-10-03 | Admin/staff accounts do not practise: they land on `/admin`, the nav shows only "Admin Portal", and student pages redirect them there (UI only; the API does not block them) |
| 2026-10-03 | Students can delete their own drills, mocks and full tests (a full test is deleted as a whole) |
| 2026-10-03 | The admin account's login is now `admin2.0@gmail.com` (same account, role and history; display name "SAT Sharks Admin"). Umair set the password; it is not stored in the repo |
| 2026-10-03 | Keep testing light unless asked: typecheck plus a few targeted checks |
| 2026-10-07 | Port the other site's full-test PDF upload; Umair left the design to Claude ("do what is best for this web"). Chosen: two papers per test + fixed-module mode in the mock engine; Math in LaTeX `$…$` like the bank; CATEGORY = bank domain or skill; students take uploaded tests as full tests only; test against an in-memory MongoDB, never Atlas |
| 2026-10-07 | The admin question editor must work like the other site's: image upload, symbol bar, visual equation editor, editable choices with Set/Correct, question type |
| 2026-10-09 | Free accounts get limited access to papers and exams; admins choose in the admin portal what free and paid accounts can open. Built as Admin → Access (per way of practising and per exam/test, plus a default for new ones); everything stays free until saved |
| 2026-10-11 | FAQ text used **exactly as written** although parts are not true yet (explanations: none exist; "20 practice questions a day": no quota built; "Pro": the plans are Monthly / 3 Months (Till Test Day removed 2026-10-16); "same time left": the clock keeps running while away; card payment / one-click cancel: no payments). Asked and confirmed |
| 2026-10-11 | SAT dates editable in Admin (not fixed in code); dashboard countdown always to the next upcoming date |
| 2026-10-11 | Students must always see a score after a full test / mock: use a built-in estimated conversion table until SAT Sharks enters real ones (replaces "no scores are invented") |
| 2026-10-12 | Stop account sharing (client request): a student account is used on one device at a time. Umair chose "new login kicks out the old device" (not a hard lock to the first device, not "logout frees it"), for all students, free and paid; staff/admins exempt |
| 2026-10-12 | Two hidden developer accounts (one admin with the same access as `admin2.0@gmail.com`, one paid student), not in the Users list or any count |
| 2026-10-19 | Pricing by region (Umair): a signed-in student sees only the plans of their account's country (PK → PKR, else USD), with no currency switch. Account country, not IP, for students (VPNs, students abroad; checkout charges the same currency). Visitors: Vercel IP country first, switch kept. Accounts without a country and staff keep the switch |
| 2026-10-19 | A student who has not chosen a test date sees "The next SAT is in N days" / "Next SAT in N days" (the next date from Admin → SAT dates), never "Your test" |
| 2026-10-30 | Client via Umair: no repeated questions (unseen first; when an exam runs out, **reuse the ones seen longest ago**, not block); the **official Bluebook module pattern** with exact counts (Claude to research; College Board practice tests used); **Bluebook-style Highlights & Notes**; exam question counts **for premium accounts only**. Umair allowed writing the fingerprint field to the live database and using a bluecorn token as needed |
| 2026-10-31 | Client via Umair: areas to improve per section, with an option to choose Reading & Writing or Math. The card keeps the name **"Skills breakdown"** (Umair; do not rename it). Claude chose: the free plan shows 3 per section instead of 3 overall, and error patterns and timing stay for both sections together |
| 2026-10-08 | An upload asks where it goes: Practice tests or Exams. A real SAT (e.g. December) goes to Exams. Umair chose "exam card + full test": it behaves like the other exams (drill, random mocks) and can also be taken whole as a fixed adaptive test |

## 7. Facts about the source (verified)

- React SPA on Supabase. All data via `POST https://ciao.bluebooky.org/rest/v1/rpc/<fn>` with
  headers `apikey` (publishable anon key) and `Authorization: Bearer <user access token>`.
  Login is captcha-protected; we never automate login. Access tokens last **1 hour**; copy from
  Chrome DevTools → Application → Local Storage → `sb-ciao-auth-token` → `access_token`.
- Drill flow: `pFilter` (returns question IDs, creates nothing) → `pStart` → `pGet`/`pAnswer` →
  `pEnd` → `rpGetResult` (returns **every** question with answers, opened or not).
- Labels come from filters: one `pFilter` per domain, skill and difficulty (`easy`/`hard`; no medium).
- **Math difficulty is unusable at the source:** 2,139 easy, 68 hard (only March 14, 2026 has a real
  split). Reading & Writing is real: 4,739 easy, 2,981 hard.
- 23 questions have a skill filed under the wrong domain (so a skill can appear under two domains —
  de-duplicate skill lists in the UI). One R&W question (ID 1506) is in two exam sources.
- Mock flow: `mStart` → `mGetAttempt` → `mGet` → `mAnswer` → `mEndModule1` (sends only the attempt
  ID; returns `m2_type`, `m1_correct`, `m2_start_pos`) → `mEnd` → `mrGetResult`. Math modules 22
  questions, 35 minutes; Module 2 numbering restarts at 1. 0 correct → `m2_easy`; 22/22 → `m2_hard`;
  threshold unknown. Each module covers ~19 skills from ~10 exams. Details: `docs/adaptive-testing.md`.
- The source embeds `**[bluebooky.com]**` in 537 chart titles/labels; it is stored and displayed
  as received (client decision pending).
- Calculator on the source: iframe of `https://www.desmos.com/testing/collegeboard/graphing` in a
  640×520 draggable, resizable panel with a drag overlay.
- Answers are sent to the source as the choice's **text** (MCQ) or the typed value (SPR).

## 8. Traps already hit (save time)

- **`.env` vs `.env.example`:** Umair has twice pasted secrets into `.env.example` (committed!).
  Always check, move secrets to `.env`, blank the template.
- **HAR files contain session tokens** in response bodies even when exported "sanitized". `*.har`
  is git-ignored for that reason.
- **Mongoose `sanitizeFilter` is on:** operators like `$in`/`$exists` in `find()` filters are
  rejected unless wrapped in `trusted()` (from `@satsharks/db`). Aggregation pipelines are not
  sanitized. One-off scripts hit this often.
- **PowerShell drops `--`** when calling npm scripts: `npm run x -- --flag` loses the flags. Call
  the CLI directly: `npx tsx apps/api/src/cli/create-admin.ts --email … --role admin`.
- **PowerShell safety check** misreads regexes or here-strings containing `/` as paths and blocks
  `Remove-Item`. Write scripts with the Write tool, run and delete them in separate steps.
- **Commit messages with double quotes** break in PowerShell 5.1 here-strings passed to `git commit
  -m` (split into pathspecs, nothing committed). Write the message to a scratchpad file and use
  `git commit -F <file>`.
- **The Bash tool has at times lost `node`, `sed`, `grep`, `curl`** from its PATH. Use PowerShell or
  the Edit/Grep tools.
- **Background dev servers started by Claude are killed** when the session's background time limit
  is reached. Umair should run `npm run dev:api` / `dev:web` in his own terminals.
- **Port clash (fixed):** Next once started on 4000 and proxied to itself ("socket hang up"). Web is
  now pinned to 3000 and the API opens its port before connecting to MongoDB, failing loudly on
  `EADDRINUSE`.
- **Stale session in the menu (fixed):** switching accounts in another tab left the Admin button
  visible. Sign-in clears cached data; the session is re-checked on tab focus; 4xx are not retried.
- **Never `queryClient.clear()` (or remove the `["auth","me"]` query) on sign-in/out.** The nav sits
  in the `(site)` layout, which does not re-render on navigation; its observer stays on the removed
  query and keeps showing the old account (Admin/Sign Out after logout, Log In/Sign Up after login).
  `useSwitchUser` removes every *other* query and updates "me" in place.
- **Atlas first connection can exceed 10 s** from this machine; timeout is 30 s.
- **Testing against Umair's running dev servers:** the API's dev reset link prints in *his*
  console. Start a second API with `PORT=4100` (same database) and capture its output; PowerShell
  wraps long stderr lines, so join lines before searching the log.
- **Auth rate limits** (in memory; table in `docs/security.md`) trip repeated test runs: restart the
  test API instance between runs. Failed logins count per address and per account; successful ones
  do not.
- **`next dev` with a different `NEXT_DIST_DIR` rewrites `apps/web/tsconfig.json`** (adds that folder
  to `include` and reformats it): `git checkout -- apps/web/tsconfig.json` after such a test run.
- **Headless screenshots** of a tab that is not in front hang: call `page.bringToFront()` first.
  Type into forms only after `networkidle0` (+ a moment), or the form submits before hydration.
- **Anything built from `Intl` locale data** (country names) differs between Node and Chrome and
  breaks hydration: build it after mount.
- **Bash heredocs with long Python** sometimes fail to parse in this tool; write the script with the
  Write tool and run it.
- **Next.js page files** may only export the page and its config; shared constants go in components.
- **Never `networkidle0` as the only wait on a page Next has not compiled yet**: the first dev compile
  can exceed 2 minutes. Use `load` plus a fixed wait.
- **pdf-parse drops blank lines**, so paragraphs merge; `pdf-text.ts` rebuilds lines from pdf.js
  positions instead. Keep it if the extractor is ever swapped.
- **`$\$78$` in Math** was cut wrongly by the old renderer regex (91 bank questions with money
  showed garbled). Fixed in `rich-text.tsx`; formulas may contain escaped characters.
- **mongodb-memory-server's first start** on this machine took over 10 s (binary scan): the e2e
  sets a 120 s launch timeout.
- **Two question views sent at once can land in either order** and leave the server timing the
  wrong question (`recordView` only writes if nobody moved the view first). The test screen sends
  views one at a time (`views` promise chain); keep it that way.
- **In-memory `mongod` exits with code 3221225781 (0xC0000135, DLL not found)** (2026-10-08, fixed
  2026-10-09 once the runtime was reinstalled, **missing again on 2026-10-11** and reinstalled the same day with Umair's permission:
  `winget install --id Microsoft.VCRedist.2015+.x64 --exact --silent`):
  `vcruntime140.dll` / `msvcp140.dll` are missing from System32 (the VC++ Redistributable x64 is
  not installed any more). Install it from Microsoft (`aka.ms/vs/17/release/vc_redist.x64.exe`)
  before running the e2e; it is a system install, so ask Umair first.
- **`querySrv ENODATA _mongodb._tcp.cluster0…` on startup** (2026-10-08): the Wi-Fi router
  (192.168.1.1) returns no SRV records, so `mongodb+srv://` cannot resolve; 8.8.8.8 answers fine.
  `connectMongo` now calls `dns.setServers()` when `DNS_SERVERS` is set (local `.env` has
  `8.8.8.8,1.1.1.1`). Alternative: set the Windows Wi-Fi DNS to 8.8.8.8 / 1.1.1.1.
- **Never run a second `next dev` in `apps/web` on the same build folder.** Claude's test web
  server (port 3100) shared `.next` with Umair's server on 3000 and broke it (ChunkLoadError on
  /admin/tests, 2026-10-08). Test servers now use `NEXT_DIST_DIR=.next-test`
  (`API_URL=http://localhost:4100 NEXT_DIST_DIR=.next-test npx next dev -p 3100`); fix a broken
  server by stopping it, deleting `apps/web/.next` and starting it again.
- **A `next dev` with `NEXT_DIST_DIR=.next-test` rewrites `apps/web/tsconfig.json`** (expands it
  and adds `.next-test/types/**/*.ts`). Run `git checkout -- apps/web/tsconfig.json` after testing.
- **Puppeteer clicks** can land on the review page's floating save bar; scroll the field to the
  centre first.
- Auto mode once blocked reading local web files right after a read-only Atlas query, labelling it
  "production reads". Avoid querying Atlas during a session; use the local cache in `data/`.
- **Vercel installs only the root directory's workspace** (`apps/web`), not the repo root's
  devDependencies. Anything `next build` needs (TypeScript for `next.config.ts`, `@types/node`)
  must be listed in `apps/web/package.json`. Check with a clean clone in the scratchpad:
  `npm install` inside `apps/web`, then `npm run build` (never build in the working copy while
  Umair's dev server uses `apps/web/.next`).
- **Hydration and the remembered account (fixed 2026-10-09):** `providers.tsx` fills the "me"
  query from `localStorage` in an effect of the root, which runs before nested layouts/pages
  (nav, landing buttons, auth links) hydrate, so their first client render had a user while the
  server HTML said "still checking" → "Hydration failed" on every page load. Fix: `useMe()` in
  `lib/auth.ts` reports "loading, no user" while its component hydrates (`useHydrated()`,
  `useSyncExternalStore` with a `false` server snapshot), then the remembered account on the next
  render. Anything user-dependent must read the account through `useMe()`, not the query directly.
- **The Bash tool fails on heredocs containing backticks** ("unexpected EOF while looking for
  matching"). Write the script with the Write tool into the scratchpad and run it.
- **The e2e makes > 300 requests a minute from one address** (`apiRateLimit`): a long check resets
  the limiter first (`apiRateLimit.resetKey`). Bank drills in the e2e also draw the uploaded exam's
  questions (keys are not all "A"): answer from each question's real key.
- **Grid items keep their content's min width:** a wide table inside `grid gap-4` widened the page
  on phones. Use `grid grid-cols-1` (or `minmax(0,1fr)`).
- **The Bash tool rewrites `\u…`, `\r` and `\n` escapes inside heredocs** (even quoted `<<'EOF'`)
  into real characters (a literal BOM and line breaks ended up in TypeScript), and heredocs with
  backticks fail to parse. Write edit scripts with the Write tool and run them; check escapes after.
- **Users are read with `lean()`**, so fields added later (`engagement`, `streak`, `totalPoints`,
  `friends`) are missing on older accounts: read them through `engagementOf` / `streakOf`.
- Testing in the app needs an account. Use temporary accounts `phase1-test-*@example.com`
  (create with `create:admin` or `/api/auth/register`) and delete them afterwards. Never use or
  change Umair's own accounts.

- **Vercel and Railway deploy separately; a push can update the web but not the API.** On
  2026-10-21 the live web had Week 4 but the Railway API was still the 2026-10-15 build (uptime in
  `/api/health`; Week 4 reached the client repo during a Railway outage with builds paused), so
  `/billing` showed "No route for GET /api/billing". Check status.railway.com before pushing; after a push, compare
  `uptimeSeconds` on `https://satsharksapi-production.up.railway.app/api/health` with the push time.
- **Railway watch paths: a push that changes no API files is "Skipped"** ("No changes to watched
  files"), even if an earlier API commit was never built (e.g. it arrived during an outage). Fix:
  Ctrl+K → "Deploy Latest Commit" (or ⋯ → Redeploy on the skipped deployment); manual deploys
  ignore watch paths. "Redeploy" on the ACTIVE card rebuilds that old commit instead.

## 9. Open items and suggestions

0000. **Deploying the 2026-10-31 Skills breakdown change:** API (Railway) and web (Vercel) must go
   live together: `skillsStep` became `skillSteps`, and `/analytics` breaks while one side is older.
   Check Railway did not "Skip" or lag (§8). The default pricing row now says "Top 3 per section",
   but the live saved pricing keeps its old text until edited in Admin → Settings. **132 uploaded
   Math questions have no skill**, so they would be left out of the Skills breakdown once students
   answer them (no such answers logged on 2026-10-31; the 162 uploaded R&W questions have skills).
000. **Deploying the 2026-10-30 work:** API (Railway) and web (Vercel) together; the web's
   highlight save calls a new route. The API change is safe for the current web (new optional
   fields only). Fingerprints are already on Atlas (all 10,221). A test in progress at deploy time
   keeps its questions; its Module 2 is built with the new rules. Check Railway did not "Skip" the
   build (§8). Open: the exact places of Math grid-ins in digital modules are not published
   (positions scale the paper forms); a bluecorn Reading and Writing mock could still be observed
   for comparison, but needs a fresh token from Umair (the one in `.env` expired 2026-10-02).
00. **Before deploying the 2026-10-23 security pass: set `PROXY_SECRET`** (one random value, 32+
   characters) **in both Vercel and Railway**, and **`NODE_ENV=production` in Railway** (live
   `/api/health` still reports `development`). After the deploy, check that requests through the
   site and straight to Railway from the same computer share one `RateLimit` counter (proof the
   visitor's address arrives). Vercel now runs middleware on every `/api` call (counts toward
   Hobby's function/middleware invocations).
0. **Move the Railway API to Singapore** (near the Mumbai database; see §2 Deployment). Then
   click through an uploaded Exam in the browser: upload, activate, card under Exams with Take
   Full Test (the API side passed the e2e).
   **Try the upload with the client's real PDFs** (Admin → Full tests). They must follow the format
   (`/full-test/format.html`). PDFs made for the other SAT Sharks site upload unchanged (its
   category names and plain-text Math are accepted). Word/Google Docs exports are untested.

   **Set up Admin → Access** after deploying it: choose the free exams/tests (the proposal says
   2 full papers for free), which ways of practising are free, and "added later" (Paid only fits
   "every paper, plus each new one" for paid plans). Until saved, everything is free.

1. Umair to check the reference sheet and the floating calculator in the app (untested).
2. Commit and push the uncommitted work when Umair says so.
3. Client decisions pending: use of the reference site's content; the embedded "[bluebooky.com]"
   strings; the adaptive threshold (65% is a placeholder); Math difficulty source.
4. Scaled scores use a built-in estimate until SAT Sharks enters real tables (Admin → Settings), and Umair's
   Resend values in `.env`. Terms/Privacy need legal review and a contact email
   (`LEGAL_CONTACT_EMAIL` in `apps/web/src/components/legal-page.tsx`). Pricing is set in Admin →
   Settings (defaults: the proposal's "starting suggestion", `DEFAULT_PRICING` in packages/types).
   The Terms page still says refund terms "will be published"; it should match the no-refund line.
5. Remaining proposal items (§2 "Not built yet"), then deployment.
6. **FAQ answers that are not true yet** (§6, 2026-10-11): update `components/faq.tsx` once
   explanations, the daily drill quota, payments/cancel, and a paused clock exist, or reword them.
   Also re-check the SAT dates each year in Admin → SAT dates (College Board publishes them).

7. **Week 3 decisions made by Claude (2026-10-14), open for Umair/client:** analytics/mistake-bank
   limits as an Access switch (free until saved); points 10/+5/2, minimum seconds 10/8, cap 300;
   goal suggestion formula; streak = daily goal met; deleting only hides; streak/weekly emails on
   by default when Resend is set up (students can turn them off). Week 3 sign-off "every number on
   screen must be true": the card and dashboard only show the student's own numbers.
8. **Proposal PDF**: put `SAT_Sharks_Proposal_v4_4Weeks.pdf` back in `docs/purposal/`.
9. **Week 4 decisions made by Claude (2026-10-19), open for Umair/client:** card gateway left to
   SAT Sharks (manual transfers + test gateway meanwhile); currency fixed by account country at
   checkout; no automatic charging, "cancel" = stop reminders; invite-only content not opened by a
   paid plan; drill limit counts exam and bank drills, not retries, and stays off until Admin →
   Access sets it; exit offer off until turned on, once per account; friend invites on (2 friends at
   50 points each → 7 days, max 5); 30-day auto-removal only for accounts deleted from now on;
   payments visible to admins only (new `payments:*` permissions); "practising now" shown from 5.
   **FAQ (Umair's wording) still says "pay with a debit or credit card"** — true only once a gateway
   is added; "cancel with one click" is now true. Ask before rewording.
10. Set up live: Admin → Settings → Payments (accounts, alert email), Admin → Access (free papers,
    drill limit 20), then the items in `docs/launch-checklist.md`.

## 10. Change log

Newest last. One entry per session or major step.

- **2026-10-02 — Phase 1 investigation.** Read proposal, screenshots and the first HAR (a drill).
  Found the Supabase RPC API, captcha-protected login, no fixed papers, server-side routing.
- **2026-10-02 — Foundation.** Monorepo, Express API with auth/permissions, Mongoose models,
  Next.js shell, worker with HAR import pipeline, docs. Atlas connected; admin account created.
- **2026-10-02 — First import.** 50-question drill from Umair's recorded HAR imported and verified
  idempotent (later deleted as redundant).
- **2026-10-02 — Token mode.** Built `collect:bank` (labels via filters, content via drill results,
  cached and resumable). Collected all Math (15 banks, 2,207) then all R&W (26 banks, 7,720).
- **2026-10-03 — Images and app.** `assets:copy` (201 SVGs into MongoDB). Drill engine, Bluebook-style
  test screen, results, admin question bank and editor, renderers. Pushed to `main` as `73b574d`
  (proposal PDF excluded).
- **2026-10-03 — Fixes.** Duplicate skill keys; login "socket hang up" (port pinning, API listens
  first); Admin button for students (session refresh); Roboto/Noto Serif fonts; 1700px layout.
- **2026-10-03 — Adaptive mocks.** Observed two source mocks with Umair's token. Built the mock
  engine (module builder, routing, per-module clocks, locking), API (`/api/practice/mocks`,
  `/attempts/:id/submit-module`, `/api/admin/settings/adaptive`), start dialog, test-screen module
  handling, results per module, admin threshold card. 32 end-to-end checks passed. Test-screen
  directions rewritten in our own words.
- **2026-10-03 — Reference sheet.** Replaced the text-only sheet with Umair's component; black
  figures, drawn square roots, adjusted labels; opens in a floating draggable window. Not tested in app.
- **2026-10-03 — Calculator.** Desmos now opens in a floating, draggable, resizable window instead
  of a new tab. Not tested in app.
- **2026-10-03 — This file** (`docs/project-context.md`) and `CLAUDE.md` created.
- **2026-10-03 — Nav after sign-in/out.** Nav kept showing the previous account's buttons until a
  reload: `useSwitchUser` called `queryClient.clear()`, orphaning the nav's "me" observer. Now it
  removes other queries and updates "me" in place (`isMeQuery` shared with `providers.tsx`). Home
  page buttons moved to `components/home-actions.tsx`: signed-in visitors see "Go to your
  dashboard" instead of "Create a free account / Log in". Type check only; not tested in app.
- **2026-10-03 — Hydration warning on `<body>`** seen on a friend's browser: an extension adds a
  `__processed_…__` attribute before React loads. Harmless, dev-only; no code change made.
- **2026-10-03 — Phase 2.** Inspected the proposal (Checkpoint 2.2, pricing, user types) and the
  code first; nothing below existed. Added: country/region at sign-up; forgot/reset password via
  Resend (hashed single-use 30-min tokens, old sessions revoked); redesigned auth pages; pricing,
  terms, privacy, footer, phone nav; admin sidebar layout with Papers and Settings split out;
  extended time; server-side question/module/attempt timing; conversion tables + centralised
  scoring + full test (R&W, break, Math) with 400–1600 total; results page breakdown; report a
  problem + admin queue with in-place question editing and resolve/reopen history; mobile layout
  fixes (test screen stacks and scrolls on phones, tables collapse columns, admin tab strip).
  New collections `fulltests`, `problemreports`; new fields on users and attempts; permissions
  `reports:read` (staff) / `reports:write` (admin). Tested as in §2 "Last verified".
- **2026-10-03 — Delete, admin-only portal, admin login, landing page.** `DELETE` routes for
  attempts and full tests + delete buttons on cards. Admin/staff: login goes to `/admin`, nav shows
  only "Admin Portal", student pages redirect (`RequireUser studentOnly`, `homePath`). Admin account
  email changed to `admin2.0@gmail.com` with Umair's new password (old sessions signed out).
  Landing page rebuilt. Light tests: typecheck; 6 API checks (admin login, old email gone, delete
  own/others', full-test section refused, full test removes sections); admin redirect and nav
  checked in Chrome; landing page at 390/1440px with no overflow or errors. Test users removed.
- **2026-10-03 — Landing page revisions (Umair).** Stats strip now shows the bank (9,900+ questions,
  26 past exams, 29 skills across 8 topics, 400–1600), counted from the database. Removed the
  "Bluebook style" badge, the pricing teaser and every "explained" claim: **no question has an
  explanation yet (0 of 9,927)**, so neither the landing page nor the sign-in panel may say so.
  Added a Practice drill tile beside the adaptive mock (R&W, 10-minute break, Math). Typecheck +
  screenshot at 390/1440px (no overflow, no errors).
- **2026-10-03 — Hero alignment.** Landing hero text block lifted ~24px on wide screens (`lg:pb-12` on the
  centred text column) so it lines up with the test-screen picture; spacing inside unchanged.
- **2026-10-07 — Uploaded practice tests (full-test PDF upload) and question editor.** Ported the
  other SAT Sharks site's feature from `docs/prompts/full-test-port-kit/`, adapted to this site's
  generated mocks: `testuploads` collection; upload/review/publish/activate API and admin screens
  (Full tests in the sidebar); publish creates two hidden papers with `full-test`-tagged questions;
  fixed-module mode in the mock engine (`fixedModule`, `MockSource`), routing unchanged; student
  "Full-Length Practice Tests" on Home; exclusions in catalog, drills, mock pool, Papers list and
  bulk status. PDF text via pdf.js with paragraph-gap detection; parser re-joins wrapped lines in
  both sections; Math in LaTeX with KaTeX checks; grid-in values must be typeable. Question editor:
  image upload (`POST /api/admin/assets`), choices, type switch, symbol bar, MathLive visual
  editor. Fixed the renderer's `$\$…$` bug. Format guide, printable builder and sample PDFs in
  `apps/web/public/full-test/`. New deps: `pdfjs-dist`, `multer`, `katex` (API), `mathlive` (web),
  `mongodb-memory-server` (API dev). Tested as in §2 "Last verified". The kit's two §5 fixes did
  not apply here (no `UPDATED` status; the Papers list never loaded questions).
- **2026-10-07 — The other site's PDFs.** Umair uploaded the other site's demo PDFs and every
  question was rejected (its "SAT …" categories; plain-text Math with bare `$90`). Now accepted:
  category aliases to our domains, English skill inferred from the prompt wording, and plain-text
  Math detected per file and converted (`$` kept as `\$`, powers → superscripts). The renderer
  shows `\$` outside a formula as `$` and never opens a formula at an escaped `$`. Unknown
  categories are reported once per name. Tests: 14 parser tests, 14 end-to-end checks including
  both of the other site's demo PDFs (extracted with no errors, saved through review unchanged).
- **2026-10-07 — Home order (Umair).** Home now shows: the two start cards, Active Drills & Mocks
  (an uploaded test in progress appears here as a full-test card), Exams, then Full-Length
  Practice Tests at the bottom. Typecheck only.
- **2026-10-08 — Editable pricing, refund line, sign-in/out fixes.** Pricing moved from
  `lib/pricing.ts` constants to the `pricing` setting with an editor card in Admin → Settings
  (`components/pricing-settings.tsx`), `GET /api/pricing` (public) and `GET/PUT
  /api/admin/settings/pricing`; a refund-policy line shows under the plans. Sign-in: the form is
  replaced at once by "Opening …" (the nav no longer shows the account over the login form) and the
  destination is prefetched; `?next=` is only used when it suits the account (`nextPathFor`).
  Sign-out from a protected page no longer opens the login form with `?next=` that page (the
  cause of a student landing on /admin/settings). `RequireUser` sends an account that may not
  open a page to its own home instead of "You do not have access". Checked in Chrome against the
  in-memory test API: all of the above, plus the price change reaching /pricing.
- **2026-10-08 — Logo goes to the landing page.** The SAT Sharks logo in the nav opened the
  account's home (/dashboard or /admin) when signed in, so on that page it seemed to do nothing.
  It now always opens `/`, whose buttons send signed-in visitors to their dashboard. Typecheck only.
- **2026-10-08 — Atlas DNS fix.** `npm run dev:api` failed with `querySrv ENODATA` because the
  router's DNS does not answer SRV queries. Added optional `DNS_SERVERS` (comma-separated) read by
  `connectMongo` in `packages/db/src/connection.ts`, documented in `.env.example`, set locally to
  `8.8.8.8,1.1.1.1`. Typecheck plus a read-only Atlas ping with the override: ok.
- **2026-10-08 — Upload destination: Practice tests or Exams (Umair).** A real SAT (e.g. December)
  uploaded through Full tests landed in Full-Length Practice Tests; it belongs under Exams. Uploads
  now have `kind` (`practice` default / `exam`) and, for exams, `examDate` (year from the date,
  number auto-assigned from 1001 so practice numbers stay free). Upload dialog and Edit details
  have an "Add to" choice; the list and test page show the kind. An exam's papers get source
  `pdf-upload-exam` and exam metadata (`examId: upload:<id>`, name, date), its questions the tag
  `uploaded-exam` instead of `full-test`, so the catalog shows one exam card (with `testUploadId`)
  and drills/mocks use its questions; Admin → Papers still leaves it out (activate on its page).
  Changing the kind of a published test rewrites papers and tags. Dashboard: exam cards of uploaded
  exams add "Take Full Test"; Full-Length Practice Tests lists only practice tests. Catalog cache
  is cleared on activate/edit. Typecheck and unit tests pass; the e2e could not run (VC++ runtime
  missing, §8); not tested in the browser.
- **2026-10-09 — Deployment to the client's accounts.** Code pushed to
  `sadsharks81-max/satsharks-platform` (remote `client`); Railway API service and Vercel web
  project set up as in §2 "Deployment". The first Vercel build failed: TypeScript was only a root
  devDependency. Added `typescript` and `@types/node` to `apps/web` devDependencies; a clean-clone
  `next build` (install inside `apps/web`, like Vercel) now passes, type check included, 27 routes.
  First production build of the project.
- **2026-10-09 — Logo and favicon (Umair).** The client's PNG logo (navy, transparent) traced with
  potrace into one SVG path and drawn in `currentColor`, so it matches the site's brand blue
  instead of the artwork's navy; it replaces the "SAT Sharks" text in the nav (36px phone / 44px
  desktop, made a little smaller at Umair's request) and the sign-in panel (white). Favicon set
  generated from the fin and wave (see §2). Landing page tab title "SAT Sharks — …" → "SAT Sharks
  | …" (the only title with a dash). Typecheck clean; headless Chrome screenshots of the landing
  page (1440/390px) and login checked on a test server (port 3100, `.next-test`). That test server
  rewrites `apps/web/tsconfig.json` (adds `.next-test/types`); revert it afterwards (§8).
- **2026-10-09 — Speed, alignment, dark mode (Umair).** Each Next showed "Loading question" for
  1–2 s and pages "Checking your session": measured ~300 ms per database trip on the live API
  (Railway in the US, Atlas in Mumbai; Umair to move Railway to Singapore). Code: question and
  view recorded in parallel on the server; the test screen fetches the next question ahead
  (`?peek=1`), keeps loaded ones, and sends views in order; the session is remembered in
  `localStorage`. Nav bottom-aligned (logo SVG `block`, no inline gap). `color-scheme: only light`
  stops phone dark modes turning the blue purple. Tested as in §2 "Last verified".
- **2026-10-09 — Access by plan (Umair: free users get limited papers and exams, editable by
  admin).** Types `AccessSettings` / `AccessItem` / `PracticeAccess`, `locked` on `CatalogExam`
  and `PracticeTestListing`; schema `accessSettingsSchema`; setting `access` (cached 30 s, cleared
  on save); `access.service.ts` (`accessFor`, `requireFeature`, `requireContent`, `paidOnly`);
  `practice.service` splits the cached catalog (`baseCatalog`) from per-account locks, checks
  plan on drill/mock/full-test/uploaded-test start, limits a free "All exams" pool; `GET/PUT
  /api/admin/settings/access`; `testUploadService.listPublished`. Web: `/admin/access` page
  (sidebar "Access"), `plan-lock.tsx` (Paid pill, Unlock button), dashboard / drill / mock /
  practice-test locks and a free-plan note. Umair's own wording edit on the Adaptive Mock card was
  kept. Tested as in §2 "Last verified"; found the nav hydration error (§8, not fixed).
- **2026-10-09 — Announcements (Umair: admin announcements for all, free or paid users).** Types
  `Announcement` + audiences/tones; `AnnouncementModel`; `announcementSchema`; API
  `GET /api/announcements`, admin `GET/POST /api/admin/announcements`, `PUT/DELETE …/:id`; web
  admin page (sidebar "Announcements", form with live preview, list with edit / turn off / delete)
  and student banners in the `(site)` layout. Umair asked for quick, important-only testing: type
  check and one e2e check (§2 "Last verified").
- **2026-10-09 — Landing page redesign (Umair, from Claude Design).** Page moved to
  `app/(landing)/` with its own layout (full-bleed hero, Footer); `Nav` gained a `tone` prop
  ("light" default, "brand" for the blue hero); `HomeActions` restyled for blue; new
  `landing-test-demo.tsx`; landing animations in `globals.css` (off with prefers-reduced-motion).
  Same content and behaviour as before (signed-in visitors get "Go to your dashboard" / "Open the
  admin portal"; others "Create a free account" and "See plans"). Design's "NEW" pill became
  "ADAPTIVE" (nothing here is new); the three features the design dropped (review, report,
  extended time) are kept as compact cards. Checked: web type check (only stale
  `apps/web/.next/types/app/(site)/page.ts` from the running dev server fails; it regenerates),
  screenshots at 1440/820/390px with no horizontal overflow, answer pick and mark-for-review work.
- **2026-10-09 — Log in / sign up redesign (Umair, from Claude Design).** `/login`, `/register`,
  `/forgot-password`, `/reset-password` moved from `(site)` to a new `app/(auth)/` group with its
  own layout (Plus Jakarta Sans, Footer, no site nav). `components/auth-ui.tsx` rebuilt: brand pane
  (≥1024px), compact blue bar with logo and links on smaller screens, form card with a Log in |
  Sign up switch, fields with icons, larger buttons. Kept from before: all validation, the country
  list and region hint, Terms/Privacy agreement line (the design's "Free to start · No card needed"
  line was not added), forgot-password link, `?next=` and `?reset=1`. Checked: web type check;
  screenshots of all four pages at 1440/820/390px with no horizontal overflow; register validation,
  show-password toggle and country list (251 options) on a phone. Pushed to `origin` and `client`.
- **2026-10-09 — Nav hydration error fixed.** Cause and fix in §8 ("Hydration and the remembered
  account"); one change in `apps/web/src/lib/auth.ts`. Checked: type check; with a made-up
  remembered account in `localStorage` (no real account used), `/`, `/login`, `/register`,
  `/pricing`, `/dashboard` logged "Hydration failed" once each before the fix and none after; with
  the session check delayed 4 s the nav shows the remembered account at 1.5 s, then follows the
  server's answer. Pushed to `origin` and `client`.
- **2026-10-11 — FAQ, SAT dates, countdown, WhatsApp (Umair).** Added as in §2 (FAQ, SAT dates,
  Dashboard countdown, WhatsApp button). Dates and fees checked on College Board's site the same
  day (fees "through June 2027": $68, late +$38; Pakistan ID: original passport or national ID
  card). Checked: type check (all workspaces); 13 logic checks on the dates schema and the
  next-date / registration-status helpers; headless Chrome screenshots of `/dashboard`,
  `/sat-dates`, `/faq`, `/admin/sat-dates` at 1440/390px, the landing FAQ and `/login`: no
  horizontal overflow, WhatsApp shown except on admin, admin add-and-save works. The in-memory
  e2e API could not start at first (VC++ runtime missing again, §8), so the first screenshots
  used a throwaway stub API. Umair then allowed installing what testing needs: VC++ runtime
  reinstalled with winget; new e2e check (17 pass) and 11 browser checks against the real test API
  (§2 "Last verified"). The browser run found the WhatsApp button covering the footer's last link
  on wide screens; fixed with footer right padding. Not committed.
- **2026-10-11 — WhatsApp button smaller, with a message (Umair).** 56/64px → 48/56px; the chat
  opens with a general help message typed in. Footer right padding reduced to match. Checked: type
  check; headless Chrome at 1440/820/390px: sizes, number and decoded message correct, no footer
  link covered. Not committed.
- **2026-10-11 — Scores instead of "Pending" (Umair).** A finished full test showed "Pending"
  because no conversion tables were entered. Added `DEFAULT_CONVERSION_TABLES` (estimated curves,
  packages/types); `settingsService.getConversionTables` fills any route without an entered table
  with it; `sectionScore` scales the raw count when a section has another question count. Old
  finished attempts and full tests get their score the next time they are opened (existing
  `withScore` / full-test re-total). Admin Settings and the results notices reworded. Checked: type
  check; 51 unit tests (2 new). Not checked in a browser. Committed and pushed to both remotes.
- **2026-10-12 — One device at a time (client via Umair).** Students: a new login signs out the
  other device (user `sessionId`, token `sid`, check in `middleware/auth.ts`, 401
  `signed_in_elsewhere`); login page explains it. Checked: type check; 51 unit tests; **18 e2e
  checks** (new: laptop signed out by a phone login with the right code, laptop takes it back,
  admins keep both sessions). Login-page message not checked in a browser. Pushed to both remotes.
- **2026-10-12 — Hidden developer accounts (Umair).** `hidden` user field, filtered out of every
  admin user list/count/lookup and the stats; `create:admin` gained `--hidden`, `--role student`,
  `--paid`. Created on Atlas: `dev-admin@satsharks.invalid` (admin) and
  `dev-student@satsharks.invalid` (paid student). Checked: type check; 51 unit tests; **19 e2e
  checks** (new: hidden account absent from list, search, counts and stats; 404 on view/edit; it
  still logs in with its paid plan). **Until the API is redeployed, the live Users page still
  lists both accounts.** Pushed to both remotes. Umair asked for simpler passwords; the change was
  blocked by the session's safety check, so he was given the command to run himself.
- **2026-10-14 — Week 3 of the proposal + student panel (Umair).** Started from the wrong proposal
  (v2, counseling/essays/payments: the v4 PDF was missing); Umair stopped it, the only change
  (types) was reverted, and he attached the v4 PDF. Built 3.1–3.3 and the student panel as in §2.
  New collections `questionlogs`, `mistakes`, `dailystats`; new fields on users (`engagement`,
  `streak`, `totalPoints`, `friendCode`, `friends`, `lastStreakReminderDay`, `lastWeeklyEmailWeek`),
  attempts (`origin`, `removedAt`, `m1TimedOut`, `timedOut`, `items.answers`) and full tests
  (`removedAt`); env `ENGAGEMENT_EMAILS`. Checked: type check (only stale `apps/web/.next/types` of
  the moved pages fail; they regenerate); **62 unit tests** (11 new for the rules); **20 e2e checks**
  (new: drill by skill, check-time and end-time logging, changed answer, points and day totals,
  mistake bank and retry waits 1→3 days, fixed on a right answer, nothing for random clicking,
  removed drill kept in history, history filters, prediction capped at +50, test history changes,
  goal → streak, bad settings refused, leaderboards and friends, opt-out, locked free view, share
  card). Headless Chrome against the e2e `--serve 4100` API and a `.next-test` web on 3100 with
  seeded activity: dashboard, history, mistakes, analytics, goals, leaderboard, my tests at
  1440/390px, no console errors; History and Leaderboard scrolled sideways on phones (fixed, re-checked);
  empty pace chart from a test with no questions (query fixed). **Not tested:** real emails (no
  Resend here), `next build`. Not committed.
- **2026-10-14 — Student home back as it was (Umair).** The panel made the home page crowded.
  `/dashboard` restored to the committed version (outside the panel, no strip); new `/portal`
  page (sidebar row "Dashboard") holds the strip and links; nav button "Dashboard" opens it; time
  zone sync moved to the nav (`timeZone` added to `/api/auth/me`). Checked: type check; headless
  Chrome of `/dashboard` and `/portal` at 1440/390px, no overflow, no console errors. Not committed.
- **2026-10-15 — Week 3 pushed to the client repo.** Umair had committed the Week 3 work as
  `a5ed021` "phase 3" and pushed it to `origin` only; Claude pushed `main` to `client`
  (`3190fe8..a5ed021`, fast-forward). This should start the Vercel and Railway deploys; the live
  site was not checked.
- **2026-10-16 — Leaderboard country, target score, clearing deleted accounts (Umair).**
  (1) "My country" was empty for a student whose account has no country (made before sign-up asked;
  a read-only count on Atlas found one such student among this week's point earners; five PK
  students had points). The board now tells such a student to choose a country (saved once, sets
  the region) and then shows that country's board. (2) Target score could not be typed: the box
  rounded to 10 on every key ("4" → 0). New `NumberField` on Goals & streaks rounds/limits on
  leaving the box (400–1600, steps of 10); the daily-goal amount box had the same fault (5–300).
  (3) Admin → Users, Deleted tab: "Delete all permanently" with a confirmation (see §2). Checked:
  type check (only the stale `apps/web/.next/types` dashboard file fails); 62 unit tests; **21 e2e
  checks** (new: no-country board empty → country chosen → PK board for week and all time, bad code
  400, second choice 409; purge 403 for students, removes the deleted account, its day totals and
  friend link, keeps a restored account, second run removes 0). **Not checked in a browser.**
  Not committed.
- **2026-10-16 — "Till Test Day" plan removed (client via Umair).** Only Free, Monthly and 3 Months,
  for PKR and USD. `PAID_PLANS` = monthly, three_months; `till_test_day` kept as `LEGACY_PAID_PLANS`
  (user model enum, no access change). `DEFAULT_PRICING` and the pricing validation have three plans;
  saved pricing (live has four, read-only check) drops the old plan on read. Pricing page: three
  columns from 1024px (max 6xl wide); Admin → Settings editor three columns. `create:admin --paid`
  now gives `three_months`. Checked: type check (stale `.next/types` only); 62 unit tests; **22 e2e
  checks** (new: `/api/pricing` has three plans; old four-plan saved pricing keeps its edited price
  without the old plan; saving four plans refused; an account on `till_test_day` stays paid, shows
  plain Paid, cannot be given it again, can be moved to 3 Months). **Not checked in a browser.**
  Not committed.
- **2026-10-16 — Full names on the leaderboard (client via Umair).** Boards, the friends list and the
  "is now your friend" message show the name as given at sign-up (`boardName`), not "Ayesha R.", so
  students see who is on top. The share card (posted outside the site) keeps first name + initial.
  Footer text on the page changed; opting out on Goals & streaks still hides a student. Checked: type
  check; 22 e2e checks (leaderboard name expectations updated). Not checked in a browser. Not committed.
- **2026-10-16 — Committed and pushed** the five changes above (one commit) to `origin` and `client`
  at Umair's request.
- **2026-10-19 — Week 4 of the proposal (Umair: "implement week 4, skip what exists").** Checked
  first what existed (pricing PKR/USD, access by plan, users admin, publish/hide, reports, staff,
  announcements) and built the rest as in §2 "Week 4". New collection `payments`; new user fields
  `phone`, `deletedAt`, `autoRenew`, `exitOfferUsedAt`, `inviteKeys`, `referredBy`,
  `referralQualifiedAt`, `referralRewards`, `lastRenewalReminderFor`, `lastWinbackFor`; paper
  `publishAt`; test upload `activateAt`; question-log index on `answeredAt`; access rules gain
  `inviteCode`, `pinned`, `label`, settings `freeDrillQuestionsPerDay`; setting `payments`; env
  `PAYMENT_ALERT_EMAIL`, `PAYMENTS_TEST_GATEWAY`, `SCHEDULER`, `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`. Checked: type check (all
  workspaces); **71 unit tests** (9 new: prices, periods, offers, receipts, referral weeks, CSV,
  local midnight, invite/limit access, sign-up and payment-settings validation); **25 e2e checks**
  (3 new: transfer → approve/reject, duplicate and one-at-a-time rules, badge and seen, revenue, card
  via test gateway with renewal after the running plan, exit offer once, receipts own-only, cancel
  renewal; invite code, pins/labels, daily drill limit 8 → cut then 403, paper scheduling; friend
  invites → free week once, phone search, CSV, 30-day window and purge, public proof); `next build`
  in a separate folder (50 routes; robots/sitemap/llms.txt checked); **54/55 browser checks**
  (headless Chrome, e2e API on 4100 + `.next-test` web on 3100, 1440/390px, no sideways scroll, no
  console errors) — the one miss was the check itself (no "Hard" exam in that database). Fixed
  during testing: staff could read any receipt via the student endpoint. **Not tested:** real
  emails (no Resend here), a real gateway, the live site. Not committed.
- **2026-10-19 — Two fixes (Umair).** (1) A new account with no test date saw "Your test is in 19
  days": Home now says "The next SAT is in N days" with a "Set your test date" link, and the nav chip
  "Next SAT in N days"; "Your test" / "Test in N days" only for a date the student chose. (2) Pricing
  for a signed-in student shows only their account's currency (country at sign-up), without the
  PKR/USD switch; visitors keep the IP-based default and the switch. Asked: country or IP? Answer
  given: account country for students, IP only for visitors (see §6). Checked: web type check only.
  Not committed.
- **2026-10-20 — Four changes (client via Umair).** (1) Admin → Users: select (row, page, all
  matching) and delete / restore / delete permanently in bulk; admins and yourself skipped (§2).
  (2) "Premium member" / "Free member" badge under Student portal (§2). (3) Reports: the admin said a
  reported graph did not show. The code paths match the student's (same `viz`/`assets`, same
  components), and Atlas could not be reached from this session (DNS timeout), so the exact report
  was not found; the report page now shows the question full width exactly as on the test screen,
  plus the stored data of any figure kind the site cannot draw. **Ask Umair which report it was** if
  the graph is still missing there. (4) Desmos docked on the left like Bluebook so it no longer covers
  the question (§2 Test screen tools); web search could not confirm Bluebook's exact pixel sizes, so
  the sizes are a close match, adjustable in `calculator-dock.tsx`. Checked: type check (all
  workspaces); 71 unit tests; **26 e2e checks** (new: bulk 403/400, ticked delete skips an admin and
  yourself, restore and delete by filter, purge only deleted accounts). **Not checked in a
  browser** (users page, badge, report card, calculator dock). Not committed.
- **2026-10-20 — The missing graph found (Umair's screenshots: report on #6676).** Atlas was reachable
  this time (read-only). #6676 "Which graph represents this relationship?" has four choices with **no
  text and no figure**: the source's choice graphs were never imported (the parser keeps only an
  option's `text` and `viz_data`; the graphs are probably images in another field, not checked
  without a source token). Students and the admin both saw blank A–D. **Five published questions**,
  all "which graph" Math questions with A–D empty: #5068 and #6545 (SAT March 08, 2025), #5234
  (October 05, 2024), #3275 (August 24, 2024), #6676 (May 04, 2024). Such a question could not even
  be saved in the editor (every choice had to be filled). Built answer-choice images (§2) so an admin
  can add the four graphs. **To do (Umair/admin):** add the graphs to these five, or hide them; with
  a fresh source token the collector could be taught the option image field. Checked: type check;
  71 unit tests; **27 e2e checks** (new: empty choices named, foreign URL refused, three choice images
  saved, a drawn figure kept with null, left out keeps, null removes). Not checked in a browser. Not
  committed.
- **2026-10-20 — The five graph questions fixed, and the whole bank checked (Umair: "fix them
  yourself, the client will not spend time on it").** Drew four SAT-style graphs per question (SVG,
  300×300, grid, axes, ticks; correct graph on the **stored** answer key; wrong ones from typical
  mistakes) and wrote them to Atlas: 20 assets (`sourceUrl: generated:<key>`, `image/svg+xml`) and
  each choice's `viz = { type: "image", url }`, only for choices that were still empty. #5068 C =
  line through (2, 8); #6545 D = lines meeting at (5, 5); #5234 A = $y=x^2+1.7$ with $y=1.7-x$;
  #3275 A = zeros at −5 and 7; #6676 B = segment (0, 20)–(15, 0), axes "Oak trees" / "Pine trees".
  Generator and a backup of the old data: scratchpad of that session (not in the repo). **Students
  see the graphs only once this code is deployed** (the live site cannot draw `type: "image"` yet;
  until then each choice says "cannot be displayed yet").
  **Bank audit** (read-only script following the renderer's rules; collection names: `questions`,
  `paper` (singular), `assets`): 10,221 questions (9,927 published). Clean: every formula renders
  with KaTeX, no unclosed `$`, no LaTeX/HTML shown raw, every MCQ has 4 distinct filled choices and a
  valid key, every grid-in has a typeable accepted answer (grading compares numbers, so `.0029` is
  right for 0.0029), every image exists in `assets`, no `{viz}` without a figure, and **no question
  refers to a figure it lacks** (control: 763 that do have theirs match the same wording). Found:
  (1) **#6120** (published) — its four frequency-table choices were stored without `type`, so they
  showed "cannot be displayed"; fixed in code (`viz.tsx` draws headers+rows without a type as a
  table; the database write was refused by the session's safety check, as it was outside the five).
  (2) 219 questions still carry the source's "[bluebooky.com]" text (client decision pending, §9).
  (3) 572 published questions repeat another question's text (the source reuses questions across
  administrations), so "All exams" drills can show one twice. (4) 132 without a skill = hidden
  uploaded full-test questions (expected).
- **2026-10-21 — Pushed to the client repo (Umair asked).** `main` was 2 commits ahead of
  `client/main` (`a61f316` "week 4 implemented", `9df5d33` "new changes and few improvements"),
  none behind; `git push client main` fast-forwarded `b84f8b1..9df5d33`. `origin` already had both.
  Vercel/Railway should redeploy from it; the live site was not checked.
- **2026-10-21 — "No route for GET /api/billing" on Plan & billing (Umair's screenshot).** Cause:
  the live Railway API is the 2026-10-15 build, i.e. `b84f8b1` (`/api/health` uptime ~5.9 days;
  `/api/billing` and `/api/offers` 404) while Vercel serves the Week 4 web. Week 4 only reached the
  client repo today, and Railway builds are paused by a Railway-wide outage (Umair's screenshots).
  The code is fine (route in `billing.routes.ts`, API typecheck clean, the new env vars are all
  optional). Needs the Railway build once the outage ends (§9 item 00). Also: live `NODE_ENV` reads `development`. Code change: when the plan cannot
  load, `/billing` now shows a "message SAT Sharks on WhatsApp (0306 6595745)" card with
  Message SAT Sharks and See plans buttons instead of the raw error. Web typecheck clean; not
  checked in a browser; not committed.
- **2026-10-23 — Railway back after the outage; Week 4 API deployed.** `git push client main`
  (`9df5d33..dfddff0`, Umair asked; `origin` already had it). Railway marked it **Skipped** ("No
  changes to watched files": `dfddff0` only touches `apps/web` and docs), so `9df5d33` was still
  unbuilt. Umair started a manual deploy in Railway; the new API came up ~06:03 UTC (`/api/health`
  uptime reset). Checked: `/api/billing` now 401 (route exists, needs login; was 404),
  `/api/public/offers` 200. `NODE_ENV` still `development`. Umair then confirmed the live website
  works.
- **2026-10-23 — Security pass (Umair: "make the website fully secure, add rate limiting").**
  Found: (1) **rate limits counted Vercel's servers, not visitors**: browsers reach the API through
  the Vercel `/api` rewrite, so `req.ip` is a Vercel address shared by everyone (one person's failed
  logins could block logins for all; busy hours could hit the shared 300/min). Faking
  `X-Forwarded-For`/`X-Real-IP` straight to Railway did not change the counter (checked live).
  (2) **`npm audit`: Next 15.5.27 critical** (image-optimizer RCE, Server Actions DoS).
  (3) Live `NODE_ENV=development` → auth cookie without `Secure`. (4) Logout did not end the session
  server-side. (5) The 2 MB JSON parser for test uploads ran before the sign-in check.
  Changes: `apps/web/src/middleware.ts` (new; `/api/*`: adds the visitor IP + `PROXY_SECRET`
  headers, nothing without the secret) and `apps/api/src/utils/client-ip.ts` (new; trusts the IP
  only with a matching secret, timing-safe); every limiter keys on it (`rate-limit.ts` rewritten
  around one `limiter()` helper). New limits: failed logins per address (successes not counted) and
  per account (10/15 min), starting tests/mocks/drills/full tests 60/10 min per account, adding
  friends 30/h per account. `app.ts`: general limit before body parsing, large parser moved behind
  admin sign-in (`admin.routes.ts`), production log line shows the visitor IP. Cookie `Secure` also
  on any HTTPS request (`authCookieOptions(req)`). Logout replaces a student's `sessionId`
  (`authService.endSession`). Web pages: security headers in `next.config.ts` (frame-ancestors,
  XFO, nosniff, Referrer-Policy, HSTS, Permissions-Policy; no script-src) and no `X-Powered-By`.
  `next` → `^15.5.28` (`apps/web/package.json`, lockfile). `PROXY_SECRET` added to
  `packages/config` (optional, 32+ chars) and `.env.example`; `docs/security.md` updated (limits
  table, headers, dependencies). Checked: typecheck clean; API tests 57/57; local API (no database)
  + `next dev` on 4100/3100: wrong secret ignored, right secret used, IP passes through the rewrite,
  a browser-sent IP header is replaced, 20 failed logins → 429 for that visitor only, headers on
  pages; clean-clone build in `apps/web` (Vercel-style) passes on Next 15.5.28 with middleware.
  Not checked on Vercel itself. Needs `PROXY_SECRET` in Vercel + Railway (§9 item 00). Remaining
  audit: PostCSS inside Next 15 (build-time, own CSS only; fix is Next 16). Not committed.
- **2026-10-30 — Four client requests (Umair): no repeats, Bluebook pattern, Highlights & Notes,
  premium-only counts.** Found first: a mock's Module 1 never looked at earlier attempts; drills'
  "exclude answered" was off by default and only skipped answered ones; 445 twin groups inside one
  exam; no highlighter existed (only Mark for Review, which was fine); counts shown to everyone.
  Built as in §2 (No repeats, Adaptive mocks, Highlights & Notes, counts). Pattern research:
  College Board practice tests 4–10 (PDFs) classified by stem, 14 R&W modules; checked against the
  bank's skill mix (read-only Atlas query) and College Board's domain ranges; details in
  `docs/adaptive-testing.md`. A domain short of new questions takes new ones from elsewhere before
  any repeat (found by the new e2e check). New: `contentKey` on questions, `items.annotations`,
  `AdaptiveSettings.officialPattern`, `MODULE_PATTERN` / `MATH_SPR_POSITIONS` / annotation types
  (packages/types), `saveAnnotationsSchema`, backfill CLI. **Atlas write (Umair allowed):**
  `contentKey` set on all 10,221 questions (dry run first; second run sets 0). Checked: type check
  (all workspaces); **80 unit tests** (9 new for the pattern, repeats and twins); **28 e2e checks**
  (new: pattern counts and order in both modules, 2 of 4 evidence on a table, no twin twice, mock 2
  shares nothing with mock 1, mock 3 uses the 2 unseen then only the oldest mock's, highlights save
  / reload / 400 / 404 / 409 after submit and end, drills new-first then oldest, pattern switch);
  **17 browser checks** (e2e API on 4100 + `.next-test` web on 3100, headless Chrome): free
  dashboard without counts, premium with; select → toolbar → yellow, change to blue + underline,
  away to other questions and back (Next/Back and the question menu), reload, click a highlight,
  note saved, delete, phone 390px with no sideways scroll, no console errors. Not committed.
  **Follow-up the same day (client: an exam with zero Math must still give both Math modules):**
  top-up of small exams as in §2. Checked: type check; **82 unit tests** (2 new: chosen exam's new
  questions before other exams', an exam with none); e2e check extended (10-question Math exam →
  44 distinct, all 10 used, none of the seen exam, Module 2 from the top-up; full test on an exam
  without Math → Math 22 + 22), **28 e2e checks pass**; 5 browser checks (dialog explains, no error,
  Start enabled, full test starts, no console errors). Then the dialog's note was removed at the
  client's request (web type check only). Not committed.
- **2026-10-31 — Areas to improve per section (client via Umair).** The client said the areas to
  improve showed Math only. **Not so:** read-only Atlas counts (no names or ids read) found 4,485
  answered R&W logs and 2,751 answered Math, all with a skill; of 30 students with logs, 26 have R&W
  in the top 3 skills (16 only R&W) and 4 only Math (3 of them never touched R&W, the fourth answered
  one R&W question). It read as Math because one list mixed both, with 19 Math skills to 10 R&W and
  the section only in small grey text. The site has no "Areas to improve" wording; the client means
  the "Skills breakdown" card on Analytics. Built the selector as in §2: `analytics.service.ts` (`skillStep`,
  free view top 3 per section), `Analytics.skillSteps`, analytics page; pricing defaults reworded.
  Checked: type check; 82 unit tests; **28 e2e checks** (week 3 check extended: each section's own
  skills and next step, free view at most 3 per section); **17 browser checks** (e2e API on 4100 +
  `.next-test` web on 3100, seeded in memory): each tab lists only its section, next step and drill
  follow the tab, Math-only student opens on Math, empty tab explains itself, free view 3 per tab,
  390px without sideways scroll, no console errors. Afterwards Umair asked to keep the old name:
  the card and the default pricing row say "Skills breakdown" again (type check only). Not committed.
