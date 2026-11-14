# Uploaded practice tests (full-test PDF upload)

An admin uploads one fixed adaptive Digital SAT test as two PDFs, English (Reading & Writing) and
Math. Each PDF has Module 1, Module 2 Easy and Module 2 Hard. Students sit it through the ordinary
full-test flow (R&W, 10-minute break, Math); Module 2 of each section is chosen by the same routing
rule as every adaptive mock (Module 1 correct ≥ ⌈size × threshold⌉, threshold an admin setting, 65%).

Ported from the other SAT Sharks site (kit in `docs/prompts/full-test-port-kit/`) and adapted: that
site stores fixed 6-module tests; this one builds mocks from the bank, so a published upload becomes
**two papers** with `m1` / `m2_easy` / `m2_hard` modules and the mock engine gained a fixed-module mode.

**Practice test or exam (`kind`).** The upload dialog asks where the test goes; Edit details can
change it later, also after publishing.

- **Practice test** (default): year + test number; listed under Full-Length Practice Tests on Home;
  its questions stay in the test (below).
- **Exam**: a real SAT administration (e.g. the December SAT): title + exam date. The year comes
  from the date; the server gives it the next free number from 1001 in that year (never shown), so
  practice-test numbers stay free. Once active it is an ordinary card under **Exams** (year/season
  filters from the date; Start Exam = drill), its questions join drills, the topic lists and random
  mocks, and the card also has **Take Full Test** (the fixed adaptive test, as for a practice test).
  Its papers have `source: "pdf-upload-exam"` and `sourceMetadata { examId: "upload:<id>",
  examName, examDate }`, which the catalog groups into one card with `testUploadId`.

## Admin flow

1. **Admin → Full tests → Upload test**: title, year (2000–2100), test number, one or both PDFs.
   Each PDF is read during the request (never stored: Railway wipes local files on deploy). A PDF
   that breaks a rule is stored as *failed* with every reason; re-upload just that section.
2. **Review** each section (`/admin/tests/<id>/review/<section>`): module tabs, a numbered navigator
   (red = must be fixed), the question as students see it beside the editor. The same rules as the
   server run live; **Save & mark reviewed** is disabled while any question breaks one.
3. **Publish** (both sections reviewed; everything is checked again): creates two papers
   (`source: "pdf-upload"`, hidden) and their questions (hidden, tagged).
4. Open questions from the test page to add a graph/image or fix anything (the question editor:
   image drag-and-drop, symbol bar, visual equation editor, type switch, choices, answers).
5. **Activate**: refused unless all six modules have questions with answer keys. Deactivating hides
   it from new sittings; anyone mid-test can finish. A published test cannot be deleted (results
   point at it); a draft can.

## PDF format

Admin-facing guide and printable builder: `apps/web/public/full-test/format.html` (served at
`/full-test/format.html`); samples `sample-math.pdf`, `sample-english.pdf` next to it.

```text
SECTION: MATH                 once, before MODULE 1 (READING_WRITING or MATH)
MODULE 1                      also MODULE 2 EASY / MODULE 2 HARD (EASIER / HARDER accepted)
QUESTION 1                    numbering restarts at 1 per module, consecutive
CATEGORY: Algebra             exact question-bank domain for this section
SKILL: Linear equations in one variable
                              required exact skill belonging to CATEGORY
DIFFICULTY: MEDIUM            EASY | MEDIUM | HARD
TYPE: GRID_IN                 optional; MULTIPLE_CHOICE (default) or GRID_IN (Math only)
PASSAGE: ...                  optional (Math: shown as the start of the question text)
PROMPT: ...
A: ... B: ... C: ... D: ...   multiple choice only
ANSWER: B                     A–D, or grid-in forms separated by "or": 0.5 or 1/2
EXPLANATION: ...              required
END QUESTION
END MODULE
```

Rules beyond the original spec, because of how this site works:

- **Math: plain text or LaTeX, per file.** A file with no LaTeX command in which every `$` is a
  dollar amount (`$` + digit) is plain text, as the other site's PDFs are (`x^2`, `$90`, `3/14`): on
  upload `$` is stored as `\$` (shown as a plain `$`), simple powers become Unicode superscripts
  (`x^2` → x², `(x^4)^3` → (x⁴)³, `x^(n+1)` → x⁽ⁿ⁺¹⁾), and ` * ` becomes `·`; a warning says so.
  Otherwise the file is LaTeX between `$…$`, like the 2,207 bank questions (`$$…$$` on its own line,
  money `$\$78$`): an unpaired `$` and any formula KaTeX cannot render reject the file, and
  math-looking text outside `$…$` only warns. The renderer shows `\$` outside a formula as `$`.
- **CATEGORY and SKILL are both required.** `CATEGORY` names the domain (for example `Algebra` or
  `Craft and Structure`), and `SKILL` names one exact skill under it (for example
  `Linear equations in one variable` or `Words in Context`). Matching ignores letter case and
  stores the bank's canonical spelling. Missing labels, unknown labels, and a skill that belongs
  to another domain reject the PDF with grouped errors. The importer never guesses a skill from
  question wording. This keeps drills, mock assembly and student analytics complete and accurate.
  See `docs/full-test-pdf-format.md` for the admin-facing template.
- **Grid-in answers** must be typeable in the answer box: digits, `.`, `/`, `-`, 5 characters
  (6 if negative). Split on ` or `, `;` and `, ` (so `1,000` is one value, and rejected).
- R&W passage and prompt are stored separately (this site has both fields).
- Module sizes other than 27/22 only warn; scaled scores need official sizes (`scoring.ts`).

### Reading the PDF text

`apps/api/src/services/pdf-text.ts` uses pdf.js directly (`pdfjs-dist`). Plain extraction (pdf-parse,
which the other site used) returns one line per visual line and **drops blank lines**, so paragraphs
would merge. Lines are rebuilt from text positions and a gap clearly larger than the page's usual
line spacing becomes an empty line (works for single, 1.5 and double spacing).
`test-upload-parser.ts` then joins wrapped lines back into paragraphs in **both** sections: a new
paragraph starts at a blank line, a list item (`•`, `-`, `*`, `1.`), a `$$` formula, or a lone
`Text 1` / `Text 2` heading. Joining Math too is deliberate: keeping raw line breaks splits a `$…$`
that wrapped and leaves a broken line break mid-sentence (the other site shows this bug).

## Keeping the questions to their test

Practice-test questions get `tags: ["full-test", "full-test:<uploadId>"]` (an exam's get
`["uploaded-exam", "full-test:<uploadId>"]` and are not excluded). Excluded from: the practice catalog
(exam list and topic/skill lists), drill creation, the random mock / full-test pool, and the exam
check of a mock. Upload papers of both kinds are left out of Admin → Papers and its bulk
publish/hide, and a single-paper status change on one is refused: they are shown and hidden only by
activating the test. Changing the kind of a published test rewrites its papers' source and
metadata and its questions' tags at once; students' past attempts are kept. They do appear in the admin question bank.

## Code

| Where | What |
| --- | --- |
| `packages/types` | `UploadQuestion`, `TestUploadSummary`, `PracticeTestListing`, tag constants, `uploadQuestionProblems` (rules shared by API and review screen), `latexSegments`, `splitAcceptedValues`, `sprValueProblem` |
| `packages/db/.../test-upload.model.ts` | `testuploads` collection (unique year + test number) |
| `apps/api/src/services/test-upload.service.ts` | upload, review save, publish, activate, delete, student listing |
| `apps/api/src/services/practice.service.ts` | `fixedModule`, `MockSource`, `createPracticeTest`; tag/source exclusions |
| `apps/api/src/services/admin.service.ts` | question edit now covers type, choices and images; `uploadImage` |
| `apps/web/.../admin/tests/**` | list + upload dialog, test page, review page |
| `apps/web/src/components/question-form.tsx`, `math-input.tsx` | shared question form, symbol bar, MathLive visual editor (fonts in `public/mathlive/fonts`) |
| `apps/web/src/components/practice-tests.tsx` | "Full-Length Practice Tests" on Home |

## Verification

- `npm test`: parser and rule tests in `apps/api/test/test-upload-parser.test.ts`.
- End to end against a throwaway in-memory MongoDB (refuses any non-local URI):
  `node apps/api/test/e2e/make-test-pdfs.mjs <dir>` then `npx tsx apps/api/test/e2e/test-uploads.e2e.ts <dir>`
  (14 checks; copy the kit's `SAT-Sharks-Demo-Full-Test-*.pdf` into the folder as
  `other-site-english.pdf` / `other-site-math.pdf` to include the other-site check). Add `--serve 4100` to keep the seeded API running for a browser session
  (web: `API_URL=http://localhost:4100 NEXT_DIST_DIR=.next-test npx next dev -p 3100` in `apps/web`,
  with its own build folder so it never disturbs the normal dev server).
