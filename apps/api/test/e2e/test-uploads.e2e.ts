// End-to-end check of uploaded practice tests against a throwaway in-memory MongoDB. Never touches
// the database in .env: MONGODB_URI is replaced before the app loads, and the run stops if it is
// not a local in-memory server.
//
//   npx tsx apps/api/test/e2e/test-uploads.e2e.ts <folder with the test PDFs>
//   npx tsx apps/api/test/e2e/test-uploads.e2e.ts <folder> --serve 4100   (seed, then keep serving)
//
// The PDFs come from make-test-pdfs.mjs in this folder.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DEFAULT_SAT_DATES } from "@satsharks/types";

const folder = process.argv[2];
if (!folder) throw new Error("Pass the folder with the test PDFs");
const serveIndex = process.argv.indexOf("--serve");
const servePort = serveIndex > 0 ? Number(process.argv[serveIndex + 1] ?? 4100) : null;

const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 120_000 } });
const uri = mongo.getUri("satsharks-e2e");
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw new Error(`Refusing to run against ${uri}`);
process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = "e2e-secret-that-is-long-enough-0123456789";
process.env.NODE_ENV = "test";
// The pretend card gateway (no money), the payment checks use it.
process.env.PAYMENTS_TEST_GATEWAY = "on";
// No emails from a test run (and no Resend key here anyway).
process.env.RESEND_API_KEY = "";

const { connectMongo, PaperModel, QuestionModel, TestUploadModel, UserModel, AttemptModel, QuestionLogModel, MistakeModel, DailyStatModel, trusted } = await import("@satsharks/db");
const { createApp } = await import("../../src/app");
await connectMongo(uri);
assert.equal((await import("mongoose")).default.connection.host, "127.0.0.1");

// ---------- seed: a small bank with the real domains and skills ----------
const VOCABULARY: [string, string, string][] = [
  ["math", "Algebra", "Linear equations in one variable"],
  ["math", "Algebra", "Linear functions"],
  ["math", "Algebra", "Systems of two linear equations in two variables"],
  ["math", "Advanced Math", "Equivalent expressions"],
  ["math", "Advanced Math", "Nonlinear functions"],
  ["math", "Problem-Solving and Data Analysis", "Percentages"],
  ["math", "Geometry and Trigonometry", "Circles"],
  ["math", "Geometry and Trigonometry", "Area and volume"],
  // Every Reading & Writing skill of the real bank.
  ["reading_writing", "Craft and Structure", "Words in Context"],
  ["reading_writing", "Craft and Structure", "Cross-Text Connections"],
  ["reading_writing", "Craft and Structure", "Text Structure and Purpose"],
  ["reading_writing", "Information and Ideas", "Central Ideas and Details"],
  ["reading_writing", "Information and Ideas", "Command of Evidence"],
  ["reading_writing", "Information and Ideas", "Inferences"],
  ["reading_writing", "Standard English Conventions", "Boundaries"],
  ["reading_writing", "Standard English Conventions", "Form, Structure, and Sense"],
  ["reading_writing", "Expression of Ideas", "Rhetorical Synthesis"],
  ["reading_writing", "Expression of Ideas", "Transitions"],
];
for (const section of ["math", "reading_writing"] as const) {
  const paper = await PaperModel.create({ title: `Bank exam — ${section}`, source: "bluecorn", sourcePaperId: `bank-${section}`, status: "published", sections: [section], questionCount: 64 });
  const triples = VOCABULARY.filter(([s]) => s === section);
  await QuestionModel.insertMany(
    Array.from({ length: 64 }, (_, i) => {
      const [, topic, skill] = triples[i % triples.length]!;
      return {
        paperId: paper._id, source: "bluecorn", sourceQuestionId: `${section}-${i}`, section, moduleType: "none", questionNumber: i + 1, questionType: "mcq",
        difficulty: ["easy", "medium", "hard"][i % 3], topic, skill, prompt: `Bank question ${i}`, passage: null,
        choices: ["A", "B", "C", "D"].map((key) => ({ key, text: key })), correctAnswer: { choiceKey: "A", acceptedValues: [] }, status: "published",
      };
    }),
  );
}

const server = createApp().listen(servePort ?? 0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// ---------- a tiny client with a cookie per user ----------
type Json = { ok: boolean; data?: any; error?: { code: string; message: string } };
function client() {
  let cookie = "";
  async function call(method: string, path: string, body?: unknown, form?: FormData): Promise<{ status: number; json: Json }> {
    const response = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return { status: response.status, json: (await response.json()) as Json };
  }
  // Non-JSON answers (CSV).
  async function text(path: string): Promise<{ status: number; type: string | null; body: string }> {
    const response = await fetch(base + path, { headers: cookie ? { cookie } : {} });
    return { status: response.status, type: response.headers.get("content-type"), body: await response.text() };
  }
  return { call, text };
}
const pdf = (name: string) => new Blob([readFileSync(join(folder, name))], { type: "application/pdf" });

const admin = client();
const student = client();
await admin.call("POST", "/api/auth/register", { name: "E2E Admin", email: "phase1-test-admin@example.com", password: "password-123", country: "PK" });
await UserModel.updateOne({ email: "phase1-test-admin@example.com" }, { $set: { role: "admin" } });
await admin.call("POST", "/api/auth/login", { email: "phase1-test-admin@example.com", password: "password-123" });
await student.call("POST", "/api/auth/register", { name: "E2E Student", email: "phase1-test-student@example.com", password: "password-123", country: "PK" });

if (servePort) {
  console.log(`Serving on ${base} with ${uri}. Admin phase1-test-admin@example.com / password-123, student phase1-test-student@example.com / password-123. Ctrl+C to stop.`);
} else {
  await run();
  server.close();
  await (await import("mongoose")).default.disconnect();
  await mongo.stop();
}

async function run() {
  let passed = 0;
  const check = async (name: string, body: () => Promise<void>) => {
    await body();
    passed += 1;
    console.log(`  ok  ${name}`);
  };
  const upload = (fields: Record<string, string>, files: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const [key, name] of Object.entries(files)) form.append(key, pdf(name), name);
    return admin.call("POST", "/api/admin/test-uploads", undefined, form);
  };
  const replace = (id: string, section: string, name: string) => {
    const form = new FormData();
    form.append("file", pdf(name), name);
    return admin.call("POST", `/api/admin/test-uploads/${id}/sections/${section}/file`, undefined, form);
  };

  let id = "";
  await check("invalid upload input is refused", async () => {
    assert.equal((await upload({ title: "", year: "2026", testNumber: "1" }, { math: "demo-math.pdf" })).status, 400);
    assert.equal((await upload({ title: "T", year: "1999", testNumber: "1" }, { math: "demo-math.pdf" })).status, 400);
    assert.equal((await upload({ title: "T", year: "2026", testNumber: "0" }, { math: "demo-math.pdf" })).status, 400);
    const none = await upload({ title: "T", year: "2026", testNumber: "1" });
    assert.equal(none.status, 400);
    assert.match(none.json.error!.message, /Choose the English PDF/);
    assert.equal((await student.call("GET", "/api/admin/test-uploads")).status, 403);
  });

  await check("both PDFs are read during the upload with exact module counts", async () => {
    const created = await upload({ title: "E2E Practice Test 1", year: "2026", testNumber: "1" }, { readingWriting: "demo-english.pdf", math: "demo-math.pdf" });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const data = created.json.data.upload;
    id = data.id;
    assert.equal(data.readingWriting.status, "extracted", data.readingWriting.errorMessage);
    assert.equal(data.math.status, "extracted", data.math.errorMessage);
    assert.deepEqual(data.readingWriting.moduleCounts, { m1: 27, m2_easy: 27, m2_hard: 27 });
    assert.deepEqual(data.math.moduleCounts, { m1: 22, m2_easy: 22, m2_hard: 22 });
    assert.deepEqual(data.readingWriting.warnings, []);
    assert.deepEqual(data.math.warnings, []);
  });

  await check("a duplicate year and test number is refused", async () => {
    const duplicate = await upload({ title: "Again", year: "2026", testNumber: "1" }, { math: "demo-math.pdf" });
    assert.equal(duplicate.status, 409);
  });

  await check("the stored questions keep formulas, money, paragraphs and grid-in answers", async () => {
    const { json } = await admin.call("GET", `/api/admin/test-uploads/${id}`);
    const math = json.data.upload.math.questions;
    const rw = json.data.upload.readingWriting.questions;
    assert.equal(math[1].prompt.includes("$\\$"), true);
    assert.match(math[3].prompt, /\n\$\$x \+ y = \d+\$\$\n/);
    assert.equal(math[2].questionType, "spr");
    assert.deepEqual(math[2].choices, []);
    assert.equal(math[0].topic, "Algebra");
    assert.equal(math[0].skill, "Linear equations in one variable");
    assert.match(rw[1].passage, /^Text 1\n.+\nText 2\n/);
    assert.match(rw[3].passage, /\n• The Atacama/);
    assert.ok(json.data.topics.math.some((topic: { topic: string }) => topic.topic === "Geometry and Trigonometry"));
  });

  await check("a wrong or broken PDF fails with the reasons, and only that section is replaced", async () => {
    const wrong = await replace(id, "math", "demo-english.pdf");
    assert.equal(wrong.json.data.upload.math.status, "failed");
    assert.match(wrong.json.data.upload.math.errorMessage, /says SECTION: READING_WRITING, but it was uploaded as the Math file/);
    assert.equal(wrong.json.data.upload.readingWriting.status, "extracted");
    const broken = await replace(id, "math", "bad-math.pdf");
    assert.match(broken.json.data.upload.math.errorMessage, /Module 2 \(harder\) is missing/);
    const category = await replace(id, "math", "bad-category.pdf");
    assert.match(category.json.data.upload.math.errorMessage, /CATEGORY "Calculus" \(\d+ questions\) is not a domain or skill/);
    assert.match(category.json.data.upload.math.errorMessage, /cannot be displayed/);
    const money = await replace(id, "math", "bad-money.pdf");
    assert.match(money.json.data.upload.math.errorMessage, /no closing "\$"/);
    const fixed = await replace(id, "math", "demo-math.pdf");
    assert.equal(fixed.json.data.upload.math.status, "extracted");
    const notPdf = new FormData();
    notPdf.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
    assert.equal((await admin.call("POST", `/api/admin/test-uploads/${id}/sections/math/file`, undefined, notPdf)).status, 400);
  });

  await check("publishing needs both sections reviewed", async () => {
    const early = await admin.call("POST", `/api/admin/test-uploads/${id}/publish`);
    assert.equal(early.status, 400);
    assert.match(early.json.error!.message, /Review and save/);
  });

  await check("review saves are validated with the same rules", async () => {
    const { json } = await admin.call("GET", `/api/admin/test-uploads/${id}`);
    for (const [section, field] of [["reading_writing", "readingWriting"], ["math", "math"]] as const) {
      const questions = json.data.upload[field].questions.map(({ questionNumber: _n, ...rest }: Record<string, unknown>) => rest);
      const bad = structuredClone(questions);
      bad[0].choiceKey = "E";
      bad[1].topic = "Not a domain";
      const refused = await admin.call("PUT", `/api/admin/test-uploads/${id}/sections/${section}`, { questions: bad });
      assert.equal(refused.status, 400);
      assert.match(refused.json.error!.message, /ANSWER must be A, B, C or D/);
      assert.match(refused.json.error!.message, /"Not a domain" is not a/);
      if (section === "math") {
        const untypeable = structuredClone(questions);
        untypeable[2].acceptedValues = ["x=1/2"];
        assert.match((await admin.call("PUT", `/api/admin/test-uploads/${id}/sections/math`, { questions: untypeable })).json.error!.message, /cannot be typed/);
        // An edit made in review.
        questions[0].explanation = `${questions[0].explanation} Check: substitute back.`;
      }
      const saved = await admin.call("PUT", `/api/admin/test-uploads/${id}/sections/${section}`, { questions });
      assert.equal(saved.status, 200, JSON.stringify(saved.json.error));
      assert.equal(saved.json.data.upload[field].status, "reviewed");
    }
  });

  let paperIds: Record<string, string> = {};
  await check("publish creates two hidden papers with tagged questions in module order", async () => {
    const published = await admin.call("POST", `/api/admin/test-uploads/${id}/publish`);
    assert.equal(published.status, 200, JSON.stringify(published.json.error));
    const data = published.json.data.upload;
    assert.equal(data.status, "published");
    assert.equal(data.active, false);
    paperIds = data.paperIds;
    const papers = await PaperModel.find({ source: "pdf-upload" }).lean();
    assert.equal(papers.length, 2);
    assert.ok(papers.every((paper) => paper.status === "hidden"));
    assert.deepEqual(papers.find((p) => p.sections[0] === "math")!.modules.map((m) => [m.moduleType, m.questionCount]), [["m1", 22], ["m2_easy", 22], ["m2_hard", 22]]);
    const questions = await QuestionModel.find({ tags: `full-test:${id}` }).select("+correctAnswer").lean();
    assert.equal(questions.length, 81 + 66);
    assert.ok(questions.every((q) => q.tags.includes("full-test") && q.status === "hidden"));
    const spr = questions.filter((q) => q.questionType === "spr");
    assert.ok(spr.length > 0 && spr.every((q) => q.choices.length === 0 && q.correctAnswer!.acceptedValues.length > 0));
    assert.equal((await admin.call("POST", `/api/admin/test-uploads/${id}/publish`)).status, 409);
    assert.equal((await replace(id, "math", "demo-math.pdf")).status, 409);
    assert.equal((await admin.call("DELETE", `/api/admin/test-uploads/${id}`)).status, 409);
  });

  await check("uploaded questions stay out of the catalog, drills, random mocks and bulk publishing", async () => {
    assert.equal((await admin.call("POST", "/api/admin/papers/status", { status: "published" })).status, 200);
    assert.equal((await PaperModel.countDocuments({ source: "pdf-upload", status: "published" })), 0);
    assert.equal((await admin.call("PATCH", `/api/admin/papers/${paperIds.math}/status`, { status: "published" })).status, 400);
    const papers = await admin.call("GET", "/api/admin/papers");
    assert.ok(papers.json.data.papers.every((paper: { source: string }) => paper.source !== "pdf-upload"));

    // Even once the test is active (its questions published), the bank queries leave them out.
    assert.equal((await admin.call("POST", `/api/admin/test-uploads/${id}/active`, { active: true })).status, 200);
    const catalog = await student.call("GET", "/api/practice/catalog");
    const examPaperIds = catalog.json.data.exams.flatMap((exam: { sections: Record<string, { paperId: string }> }) => Object.values(exam.sections).map((s) => s.paperId));
    assert.ok(!examPaperIds.includes(paperIds.math) && !examPaperIds.includes(paperIds.reading_writing));
    assert.equal((await student.call("POST", "/api/practice/attempts", { paperId: paperIds.math })).status, 404);
    const tagged = new Set((await QuestionModel.find({ tags: "full-test" }).select("_id").lean()).map((q) => String(q._id)));
    for (const section of ["math", "reading_writing"]) {
      const mock = await student.call("POST", "/api/practice/mocks", { section, paperIds: [] });
      assert.equal(mock.status, 201, JSON.stringify(mock.json.error));
      const attempt = await AttemptModel.findById(mock.json.data.attempt.id).lean();
      assert.ok(attempt!.items.every((item) => !tagged.has(String(item.questionId))));
      await student.call("DELETE", `/api/practice/attempts/${mock.json.data.attempt.id}`);
    }
    const mockFromTest = await student.call("POST", "/api/practice/mocks", { section: "math", paperIds: [paperIds.math] });
    assert.equal(mockFromTest.status, 400);
    assert.equal((await admin.call("POST", `/api/admin/test-uploads/${id}/active`, { active: false })).status, 200);
  });

  await check("a test can only be activated when all six modules have questions", async () => {
    assert.deepEqual((await student.call("GET", "/api/practice/tests")).json.data.tests, []);
    assert.equal((await student.call("POST", "/api/practice/full-tests", { testUploadId: id })).status, 404);
    await QuestionModel.updateMany({ paperId: paperIds.math, moduleType: "m2_hard" }, { $set: { moduleType: "unknown" } });
    const refused = await admin.call("POST", `/api/admin/test-uploads/${id}/active`, { active: true });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error!.message, /Empty: Math Module 2 \(harder\)/);
    await QuestionModel.updateMany({ paperId: paperIds.math, moduleType: "unknown" }, { $set: { moduleType: "m2_hard" } });
    const activated = await admin.call("POST", `/api/admin/test-uploads/${id}/active`, { active: true });
    assert.equal(activated.status, 200);
    const listed = (await student.call("GET", "/api/practice/tests")).json.data.tests;
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0].moduleCounts.reading_writing, { m1: 27, m2_easy: 27, m2_hard: 27 });
  });

  // Answers the current module: `correct` of them right, the rest wrong.
  async function answerModule(attemptId: string, correct: number, gridInForm?: (values: string[]) => string) {
    const { json } = await student.call("GET", `/api/practice/attempts/${attemptId}`);
    const { moduleStart, moduleQuestionCount } = json.data.attempt.mock;
    const attempt = await AttemptModel.findById(attemptId).lean();
    for (let offset = 0; offset < moduleQuestionCount; offset += 1) {
      const position = moduleStart + offset;
      const question = await QuestionModel.findById(attempt!.items[position - 1]!.questionId).select("+correctAnswer").lean();
      const key = question!.correctAnswer!;
      const right = offset < correct;
      const answer = question!.questionType === "mcq" ? (right ? key.choiceKey! : "ABCD".replace(key.choiceKey!, "")[0]!) : right ? (gridInForm ?? ((v) => v[0]!))(key.acceptedValues) : "9999";
      const saved = await student.call("PATCH", `/api/practice/attempts/${attemptId}/questions/${position}`, { answer });
      assert.equal(saved.status, 200, JSON.stringify(saved.json.error));
    }
    return { moduleStart, moduleQuestionCount };
  }

  await check("a student sits the test: English routed hard (27/27), Math routed easy (11/22 < 15)", async () => {
    const started = await student.call("POST", "/api/practice/full-tests", { testUploadId: id, timed: true });
    assert.equal(started.status, 201, JSON.stringify(started.json.error));
    const fullTest = started.json.data.fullTest;
    assert.equal(fullTest.name, "E2E Practice Test 1");
    const rwId = fullTest.readingWriting.id;
    const rwModules = await QuestionModel.find({ paperId: paperIds.reading_writing }).sort({ questionNumber: 1 }).lean();
    let attempt = await AttemptModel.findById(rwId).lean();
    assert.deepEqual(attempt!.items.map((item) => String(item.questionId)), rwModules.filter((q) => q.moduleType === "m1").map((q) => String(q._id)));
    assert.equal(attempt!.timeLimitSeconds, 32 * 60);

    await answerModule(rwId, 27);
    const routed = await student.call("POST", `/api/practice/attempts/${rwId}/submit-module`);
    assert.equal(routed.json.data.attempt.mock.m2Type, "m2_hard");
    assert.equal(routed.json.data.attempt.mock.routingRequiredCorrect, 18);
    attempt = await AttemptModel.findById(rwId).lean();
    assert.deepEqual(attempt!.items.slice(27).map((item) => String(item.questionId)), rwModules.filter((q) => q.moduleType === "m2_hard").map((q) => String(q._id)));
    await answerModule(rwId, 10);
    assert.equal((await student.call("POST", `/api/practice/attempts/${rwId}/end`)).status, 200);

    const continued = await student.call("POST", `/api/practice/full-tests/${fullTest.id}/continue`);
    assert.equal(continued.status, 200, JSON.stringify(continued.json.error));
    const mathId = continued.json.data.fullTest.math.id;
    await answerModule(mathId, 11);
    const mathRouted = await student.call("POST", `/api/practice/attempts/${mathId}/submit-module`);
    assert.equal(mathRouted.json.data.attempt.mock.m1Correct, 11);
    assert.equal(mathRouted.json.data.attempt.mock.routingRequiredCorrect, 15);
    assert.equal(mathRouted.json.data.attempt.mock.m2Type, "m2_easy");
    // Grid-ins answered with the last accepted form (e.g. the fraction instead of the decimal).
    await answerModule(mathId, 22, (values) => values[values.length - 1]!);
    await student.call("POST", `/api/practice/attempts/${mathId}/end`);
    const result = await student.call("GET", `/api/practice/attempts/${mathId}/result`);
    const module2 = result.json.data.questions.filter((q: { module: string }) => q.module === "m2_easy");
    assert.equal(module2.length, 22);
    assert.ok(module2.filter((q: { questionType: string }) => q.questionType === "spr").length > 0);
    assert.ok(module2.every((q: { result: { correct: boolean } }) => q.result.correct === true));
    const done = await student.call("GET", `/api/practice/full-tests/${fullTest.id}`);
    assert.equal(done.json.data.fullTest.stage, "done");
  });

  await check("questions are edited in the bank afterwards: text, choices, type and an image", async () => {
    const question = await QuestionModel.findOne({ paperId: paperIds.math, moduleType: "m1", questionNumber: 1 }).lean();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "graph.png");
    const image = await admin.call("POST", "/api/admin/assets", undefined, form);
    assert.equal(image.status, 201, JSON.stringify(image.json.error));
    const fake = new FormData();
    fake.append("image", new Blob(["<svg onload=alert(1)>"], { type: "image/png" }), "x.png");
    assert.equal((await admin.call("POST", "/api/admin/assets", undefined, fake)).status, 400);

    const patched = await admin.call("PATCH", `/api/admin/questions/${question!._id}`, {
      prompt: "If $3x = 12$, what is $x$? {viz}",
      choices: [{ key: "A", text: "$4$" }, { key: "B", text: "$5$" }, { key: "C", text: "$6$" }, { key: "D", text: "$\\frac{1}{2}$" }],
      correctAnswer: { choiceKey: "A", acceptedValues: [] },
      assets: [{ url: image.json.data.url, maxWidth: 300 }],
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.json.error));
    assert.equal(patched.json.data.question.assets[0].url, image.json.data.url);
    assert.equal(patched.json.data.question.testUploadId, id);
    const stored = await QuestionModel.findById(question!._id).lean();
    assert.ok(stored!.tags.includes("full-test"));
    assert.equal(stored!.status, "published");

    const notOurs = await admin.call("PATCH", `/api/admin/questions/${question!._id}`, { assets: [{ url: "https://example.com/x.png", maxWidth: null }] });
    assert.equal(notOurs.status, 400);
    const toGridIn = await admin.call("PATCH", `/api/admin/questions/${question!._id}`, { questionType: "spr", correctAnswer: { choiceKey: null, acceptedValues: ["4"] } });
    assert.equal(toGridIn.status, 200);
    assert.deepEqual(toGridIn.json.data.question.choices, []);
    const noAnswer = await admin.call("PATCH", `/api/admin/questions/${question!._id}`, { questionType: "mcq" });
    assert.equal(noAnswer.status, 400);
  });

  // The other SAT Sharks site's own demo PDFs (its category names, plain-text Math with $ amounts and
  // x^2), copied into the folder as other-site-english.pdf / other-site-math.pdf when available.
  if (existsSync(join(folder!, "other-site-math.pdf"))) {
    await check("the other site's PDFs upload unchanged: categories mapped, plain-text Math converted", async () => {
      const created = await upload({ title: "Other site demo", year: "2026", testNumber: "50" }, { readingWriting: "other-site-english.pdf", math: "other-site-math.pdf" });
      const data = created.json.data.upload;
      assert.equal(data.readingWriting.status, "extracted", data.readingWriting.errorMessage);
      assert.equal(data.math.status, "extracted", data.math.errorMessage);
      assert.deepEqual(data.readingWriting.moduleCounts, { m1: 27, m2_easy: 27, m2_hard: 27 });
      assert.deepEqual(data.math.moduleCounts, { m1: 22, m2_easy: 22, m2_hard: 22 });
      assert.match(data.math.warnings[0], /plain text/);
      const { json } = await admin.call("GET", `/api/admin/test-uploads/${data.id}`);
      const rw = json.data.upload.readingWriting.questions;
      const math = json.data.upload.math.questions;
      const at = (number: number) => rw.find((q: { module: string; questionNumber: number }) => q.module === "m1" && q.questionNumber === number);
      assert.deepEqual([at(1).topic, at(1).skill], ["Craft and Structure", "Words in Context"]);
      assert.deepEqual([at(8).topic, at(8).skill], ["Information and Ideas", "Central Ideas and Details"]);
      assert.equal(at(14).topic, "Standard English Conventions");
      assert.equal(at(20).skill, "Transitions");
      assert.equal(at(25).skill, "Rhetorical Synthesis");
      assert.equal(math[0].topic, "Algebra");
      assert.equal(math[1].topic, "Problem-Solving and Data Analysis");
      assert.equal(math[2].topic, "Geometry and Trigonometry");
      assert.match(math[3].prompt, /one-time fee of \\\$90 plus \\\$24/);
      assert.match(math[4].prompt, /3x² - 3x \+ 6/);
      assert.match(math[9].choices[3].text, /25π/);
      // Every question passes the review rules as extracted, so it can be saved straight away.
      for (const [section, field] of [["reading_writing", "readingWriting"], ["math", "math"]] as const) {
        const questions = json.data.upload[field].questions.map(({ questionNumber: _n, ...rest }: Record<string, unknown>) => rest);
        const saved = await admin.call("PUT", `/api/admin/test-uploads/${data.id}/sections/${section}`, { questions });
        assert.equal(saved.status, 200, JSON.stringify(saved.json.error));
      }
      assert.equal((await admin.call("DELETE", `/api/admin/test-uploads/${data.id}`)).status, 200);
    });
  }

  await check("deactivating hides the test; a draft can be deleted, a published test cannot", async () => {
    await admin.call("POST", `/api/admin/test-uploads/${id}/active`, { active: false });
    assert.deepEqual((await student.call("GET", "/api/practice/tests")).json.data.tests, []);
    assert.equal((await admin.call("DELETE", `/api/admin/test-uploads/${id}`)).status, 409);
    const draft = await upload({ title: "Draft only", year: "2026", testNumber: "2" }, { math: "demo-math.pdf" });
    assert.equal((await admin.call("DELETE", `/api/admin/test-uploads/${draft.json.data.upload.id}`)).status, 200);
    assert.equal(await TestUploadModel.countDocuments(), 1);
    assert.equal(await PaperModel.countDocuments({ source: "pdf-upload" }), 2);
  });

  // A real administration uploaded as an exam: listed under Exams (drills, random mocks) and also
  // takeable whole; moving it to the practice tests takes it out of the bank again.
  await check("an uploaded exam joins the Exams list, drills and mocks, and can be moved to practice tests", async () => {
    const examTitle = "SAT December 05, 2026 Administration";
    assert.equal((await upload({ kind: "exam", title: examTitle }, { math: "demo-math.pdf" })).status, 400);
    const created = await upload({ kind: "exam", title: examTitle, examDate: "2026-12-05" }, { readingWriting: "demo-english.pdf", math: "demo-math.pdf" });
    assert.equal(created.status, 201, JSON.stringify(created.json.error));
    const exam = created.json.data.upload;
    assert.deepEqual([exam.kind, exam.year, exam.examDate], ["exam", 2026, "2026-12-05"]);
    assert.ok(exam.testNumber >= 1001);
    const { json } = await admin.call("GET", `/api/admin/test-uploads/${exam.id}`);
    for (const [section, field] of [["reading_writing", "readingWriting"], ["math", "math"]] as const) {
      const questions = json.data.upload[field].questions.map(({ questionNumber: _n, ...rest }: Record<string, unknown>) => rest);
      assert.equal((await admin.call("PUT", `/api/admin/test-uploads/${exam.id}/sections/${section}`, { questions })).status, 200);
    }
    const published = await admin.call("POST", `/api/admin/test-uploads/${exam.id}/publish`);
    assert.equal(published.status, 200, JSON.stringify(published.json.error));
    const examPapers = published.json.data.upload.paperIds;
    const papers = await PaperModel.find({ source: "pdf-upload-exam" }).lean();
    assert.equal(papers.length, 2);
    assert.ok(papers.every((paper) => paper.sourceMetadata.examId === `upload:${exam.id}` && paper.sourceMetadata.examDate === "2026-12-05"));
    const questions = await QuestionModel.find({ tags: `full-test:${exam.id}` }).lean();
    assert.equal(questions.length, 81 + 66);
    assert.ok(questions.every((q) => q.tags.includes("uploaded-exam") && !q.tags.includes("full-test")));

    // Still managed only on its own page.
    await admin.call("POST", "/api/admin/papers/status", { status: "published" });
    assert.equal(await PaperModel.countDocuments({ source: "pdf-upload-exam", status: "published" }), 0);
    assert.equal((await admin.call("PATCH", `/api/admin/papers/${examPapers.math}/status`, { status: "published" })).status, 400);
    assert.ok((await admin.call("GET", "/api/admin/papers")).json.data.papers.every((paper: { source: string }) => paper.source !== "pdf-upload-exam"));

    const examCard = async () =>
      (await student.call("GET", "/api/practice/catalog")).json.data.exams.find((entry: { testUploadId: string | null }) => entry.testUploadId === exam.id);
    assert.equal(await examCard(), undefined);
    assert.equal((await admin.call("POST", `/api/admin/test-uploads/${exam.id}/active`, { active: true })).status, 200);
    const card = await examCard();
    assert.ok(card, "the active exam is in the catalog");
    assert.deepEqual([card.name, card.examDate, card.sections.math.paperId, card.sections.reading_writing.paperId], [examTitle, "2026-12-05", examPapers.math, examPapers.reading_writing]);

    const drill = await student.call("POST", "/api/practice/attempts", { paperId: examPapers.math, limit: 10 });
    assert.equal(drill.status, 201, JSON.stringify(drill.json.error));
    const mock = await student.call("POST", "/api/practice/mocks", { section: "math", paperIds: [examPapers.math] });
    assert.equal(mock.status, 201, JSON.stringify(mock.json.error));
    const listed = (await student.call("GET", "/api/practice/tests")).json.data.tests;
    assert.deepEqual(listed.map((test: { id: string; kind: string }) => [test.id, test.kind]), [[exam.id, "exam"]]);
    const whole = await student.call("POST", "/api/practice/full-tests", { testUploadId: exam.id });
    assert.equal(whole.status, 201, JSON.stringify(whole.json.error));
    const firstModule = await AttemptModel.findById(whole.json.data.fullTest.readingWriting.id).lean();
    const m1 = questions.filter((q) => q.section === "reading_writing" && q.moduleType === "m1").sort((a, b) => a.questionNumber - b.questionNumber);
    assert.deepEqual(firstModule!.items.map((item) => String(item.questionId)), m1.map((q) => String(q._id)));
    for (const attemptId of [drill.json.data.attempt.id, mock.json.data.attempt.id]) await student.call("DELETE", `/api/practice/attempts/${attemptId}`);
    await student.call("DELETE", `/api/practice/full-tests/${whole.json.data.fullTest.id}`);

    // Moved to the practice tests: a practice test number is needed and must be free.
    const taken = await admin.call("PATCH", `/api/admin/test-uploads/${exam.id}`, { kind: "practice", title: "December practice", year: 2026, testNumber: 1 });
    assert.equal(taken.status, 409);
    assert.match(taken.json.error!.message, /already used by "E2E Practice Test 1"/);
    const moved = await admin.call("PATCH", `/api/admin/test-uploads/${exam.id}`, { kind: "practice", title: "December practice", year: 2026, testNumber: 3 });
    assert.equal(moved.status, 200, JSON.stringify(moved.json.error));
    assert.deepEqual([moved.json.data.upload.kind, moved.json.data.upload.examDate], ["practice", null]);
    assert.equal(await examCard(), undefined);
    assert.equal(await PaperModel.countDocuments({ _id: trusted({ $in: Object.values(examPapers) }), source: "pdf-upload", sourceMetadata: {} }), 2);
    assert.ok((await QuestionModel.find({ tags: `full-test:${exam.id}` }).lean()).every((q) => q.tags.includes("full-test") && !q.tags.includes("uploaded-exam")));
    assert.equal((await student.call("POST", "/api/practice/attempts", { paperId: examPapers.math })).status, 404);
    assert.deepEqual((await student.call("GET", "/api/practice/tests")).json.data.tests.map((test: { kind: string }) => test.kind), ["practice"]);

    // ...and back to Exams.
    const back = await admin.call("PATCH", `/api/admin/test-uploads/${exam.id}`, { kind: "exam", title: examTitle, examDate: "2026-12-05" });
    assert.equal(back.status, 200, JSON.stringify(back.json.error));
    assert.ok(await examCard());
  });

  // Admin → Access: what free accounts may open. Paid accounts (and expired ones, which count as
  // free) and a test begun before a downgrade.
  await check("access by plan: free accounts open only what is free, paid accounts everything", async () => {
    const catalog = async () => (await student.call("GET", "/api/practice/catalog")).json.data;
    const before = await catalog();
    assert.ok(before.exams.every((exam: { locked: boolean }) => !exam.locked), "everything is open until an admin saves");
    assert.deepEqual(before.access, { paid: false, features: { drills: true, mocks: true, full_tests: true, analytics: true }, dailyDrill: null });

    assert.equal((await student.call("GET", "/api/admin/settings/access")).status, 403);
    const { json } = await admin.call("GET", "/api/admin/settings/access");
    const items = json.data.items as { key: string; kind: string; active: boolean }[];
    const bankMath = (await PaperModel.findOne({ sourcePaperId: "bank-math" }).lean())!;
    const bankRw = (await PaperModel.findOne({ sourcePaperId: "bank-reading_writing" }).lean())!;
    const exam = (await TestUploadModel.findOne({ kind: "exam" }).lean())!;
    const keys = { math: String(bankMath._id), rw: String(bankRw._id), exam: `upload:${exam._id}`, practice: `upload:${id}` };
    assert.deepEqual(
      items.map((item) => [item.key, item.kind, item.active]).sort(),
      [[keys.math, "exam", true], [keys.rw, "exam", true], [keys.exam, "exam", true], [keys.practice, "practice", false]].sort(),
    );
    const duplicate = await admin.call("PUT", "/api/admin/settings/access", { features: { drills: "free", mocks: "free", full_tests: "free" }, content: [{ key: "a", level: "free" }, { key: "a", level: "paid" }], newContent: "free" });
    assert.equal(duplicate.status, 400);

    // Only the bank's Reading & Writing exam is free; everything without a rule follows newContent.
    const saved = await admin.call("PUT", "/api/admin/settings/access", {
      features: { drills: "free", mocks: "free", full_tests: "paid" },
      content: [{ key: keys.rw, level: "free" }, { key: keys.math, level: "paid" }],
      newContent: "paid",
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json.error));
    await admin.call("POST", `/api/admin/test-uploads/${id}/active`, { active: true });

    const free = await catalog();
    const lockedOf = (key: string) => free.exams.find((exam: { examId: string }) => exam.examId === key)?.locked;
    assert.deepEqual([lockedOf(keys.rw), lockedOf(keys.math), lockedOf(keys.exam)], [false, true, true]);
    assert.equal(free.access.features.full_tests, false);
    const tests = (await student.call("GET", "/api/practice/tests")).json.data.tests;
    assert.ok(tests.length === 2 && tests.every((test: { locked: boolean }) => test.locked));

    const lockedDrill = await student.call("POST", "/api/practice/attempts", { paperId: keys.math, limit: 5 });
    assert.equal(lockedDrill.status, 403);
    assert.match(lockedDrill.json.error!.message, /This exam is only available on the paid plans/);
    assert.equal((await student.call("POST", "/api/practice/attempts", { paperId: keys.rw, limit: 5 })).status, 201);
    // "All exams" for a free account = the open ones: none for Math, the bank's for Reading & Writing.
    assert.equal((await student.call("POST", "/api/practice/mocks", { section: "math", paperIds: [] })).status, 403);
    assert.equal((await student.call("POST", "/api/practice/mocks", { section: "math", paperIds: [String(exam.paperIds.math)] })).status, 403);
    const rwMock = await student.call("POST", "/api/practice/mocks", { section: "reading_writing", paperIds: [] });
    assert.equal(rwMock.status, 201, JSON.stringify(rwMock.json.error));
    assert.deepEqual((await AttemptModel.findById(rwMock.json.data.attempt.id).lean())!.paperIds.map(String), [keys.rw]);
    assert.equal((await student.call("POST", "/api/practice/full-tests", { paperIds: { reading_writing: [], math: [] } })).status, 403);
    assert.equal((await student.call("POST", "/api/practice/full-tests", { testUploadId: String(exam._id) })).status, 403);
    assert.equal((await student.call("POST", "/api/practice/full-tests", { testUploadId: id })).status, 403);

    // A paid plan opens everything; a full test begun on it can be finished after the plan ends.
    await UserModel.updateOne({ email: "phase1-test-student@example.com" }, { $set: { plan: "paid", paidPlan: "monthly", planExpiresAt: null } });
    const paid = await catalog();
    assert.ok(paid.access.paid && paid.exams.every((exam: { locked: boolean }) => !exam.locked));
    assert.ok((await student.call("GET", "/api/practice/tests")).json.data.tests.every((test: { locked: boolean }) => !test.locked));
    assert.equal((await student.call("POST", "/api/practice/attempts", { paperId: keys.math, limit: 5 })).status, 201);
    const full = await student.call("POST", "/api/practice/full-tests", { paperIds: { reading_writing: [], math: [] } });
    assert.equal(full.status, 201, JSON.stringify(full.json.error));
    await UserModel.updateOne({ email: "phase1-test-student@example.com" }, { $set: { planExpiresAt: new Date(Date.now() - 60_000) } });
    assert.equal((await catalog()).access.paid, false, "an expired paid plan counts as free");
    await student.call("POST", `/api/practice/attempts/${full.json.data.fullTest.readingWriting.id}/end`);
    const continued = await student.call("POST", `/api/practice/full-tests/${full.json.data.fullTest.id}/continue`);
    assert.equal(continued.status, 200, JSON.stringify(continued.json.error));
    assert.equal((await student.call("POST", "/api/practice/full-tests", { paperIds: { reading_writing: [], math: [] } })).status, 403);

    // Staff and admins are never locked out.
    assert.ok((await admin.call("GET", "/api/practice/catalog")).json.data.exams.every((exam: { locked: boolean }) => !exam.locked));
  });

  await check("announcements reach only their audience, end on time, and only admins write them", async () => {
    const body = (title: string, audience: string, extra: Record<string, unknown> = {}) => ({ title, message: "Hello", audience, tone: "info", active: true, endsAt: null, ...extra });
    assert.equal((await student.call("POST", "/api/admin/announcements", body("x", "all"))).status, 403);
    assert.equal((await admin.call("POST", "/api/admin/announcements", body("", "all"))).status, 400);
    assert.equal((await admin.call("POST", "/api/admin/announcements", body("x", "everyone"))).status, 400);
    const ids: Record<string, string> = {};
    for (const [title, audience, extra] of [
      ["To all", "all", {}],
      ["To free", "free", {}],
      ["To paid", "paid", {}],
      ["Off", "all", { active: false }],
      ["Ended", "all", { endsAt: new Date(Date.now() - 60_000).toISOString() }],
      ["Ends later", "all", { endsAt: new Date(Date.now() + 3_600_000).toISOString() }],
    ] as const) {
      const created = await admin.call("POST", "/api/admin/announcements", body(title, audience, extra));
      assert.equal(created.status, 201, JSON.stringify(created.json.error));
      ids[title] = created.json.data.announcement.id;
    }
    const seen = async () => ((await student.call("GET", "/api/announcements")).json.data.announcements as { title: string }[]).map((a) => a.title).sort();
    // The student's paid plan expired in the access check, so it is free now.
    assert.deepEqual(await seen(), ["Ends later", "To all", "To free"]);
    await UserModel.updateOne({ email: "phase1-test-student@example.com" }, { $set: { planExpiresAt: null } });
    assert.deepEqual(await seen(), ["Ends later", "To all", "To paid"]);

    const turnedOn = await admin.call("PUT", `/api/admin/announcements/${ids.Off}`, body("Off", "paid", { active: true }));
    assert.equal(turnedOn.status, 200);
    assert.deepEqual(await seen(), ["Ends later", "Off", "To all", "To paid"]);
    assert.equal((await admin.call("DELETE", `/api/admin/announcements/${ids["To all"]}`)).status, 200);
    assert.equal((await admin.call("DELETE", `/api/admin/announcements/${ids["To all"]}`)).status, 404);
    assert.equal((await admin.call("GET", "/api/admin/announcements")).json.data.announcements.length, 5);
    assert.equal((await student.call("GET", "/api/admin/announcements")).status, 403);
  });

  await check("SAT dates are public, default to College Board's, and only admins change them", async () => {
    const visitor = client();
    const defaults = await visitor.call("GET", "/api/sat-dates");
    assert.equal(defaults.status, 200);
    assert.deepEqual(defaults.json.data, DEFAULT_SAT_DATES);
    const entry = (date: string, registrationDeadline: string, lateDeadline: string | null = null, note = "") => ({ date, registrationDeadline, lateDeadline, note });
    const save = (who: ReturnType<typeof client>, dates: unknown[]) => who.call("PUT", "/api/admin/settings/sat-dates", { dates });

    assert.equal((await save(student, [entry("2027-08-21", "2027-08-06")])).status, 403);
    assert.equal((await visitor.call("PUT", "/api/admin/settings/sat-dates", { dates: [] })).status, 401);
    for (const bad of [
      [entry("2027-8-21", "2027-08-06")],
      [entry("2027-02-30", "2027-02-01")],
      [entry("2027-08-21", "2027-08-22")],
      [entry("2027-08-21", "2027-08-06", "2027-08-01")],
      [entry("2027-08-21", "2027-08-06", "2027-08-21")],
      [entry("2027-08-21", "2027-08-06"), entry("2027-08-21", "2027-08-07")],
    ]) {
      const refused = await save(admin, bad);
      assert.equal(refused.status, 400, JSON.stringify(bad));
      assert.ok(refused.json.error?.message, "a reason is given");
    }
    // Saved in date order; notes trimmed; the public endpoint follows at once.
    const saved = await save(admin, [entry("2027-10-02", "2027-09-17", "2027-09-21", "  Scores out Oct 15 "), entry("2027-08-21", "2027-08-06")]);
    assert.equal(saved.status, 200, JSON.stringify(saved.json.error));
    assert.deepEqual(saved.json.data.dates.map((d: { date: string }) => d.date), ["2027-08-21", "2027-10-02"]);
    assert.equal(saved.json.data.dates[1].note, "Scores out Oct 15");
    assert.deepEqual((await visitor.call("GET", "/api/sat-dates")).json.data, saved.json.data);
    assert.deepEqual((await admin.call("GET", "/api/admin/settings/sat-dates")).json.data, saved.json.data);
    // An empty list is allowed (the page then says "not announced yet"); restore the defaults after.
    assert.deepEqual((await save(admin, [])).json.data.dates, []);
    assert.equal((await save(admin, DEFAULT_SAT_DATES.dates)).status, 200);
  });

  await check("a student is signed in on one device at a time; staff and admins are not limited", async () => {
    const login = { email: "phase1-test-device@example.com", password: "password-123" };
    const laptop = client();
    assert.equal((await laptop.call("POST", "/api/auth/register", { name: "E2E Device", ...login, country: "PK" })).status, 201);
    assert.equal((await laptop.call("GET", "/api/auth/me")).status, 200);

    // Logging in on a phone signs the laptop out, with a reason the web app can show.
    const phone = client();
    assert.equal((await phone.call("POST", "/api/auth/login", login)).status, 200);
    assert.equal((await phone.call("GET", "/api/auth/me")).status, 200);
    const kicked = await laptop.call("GET", "/api/auth/me");
    assert.equal(kicked.status, 401);
    assert.equal(kicked.json.error?.code, "signed_in_elsewhere");
    assert.equal((await laptop.call("GET", "/api/practice/attempts")).status, 401);

    // Logging in again on the laptop takes the account back; now the phone is out.
    assert.equal((await laptop.call("POST", "/api/auth/login", login)).status, 200);
    assert.equal((await laptop.call("GET", "/api/auth/me")).status, 200);
    assert.equal((await phone.call("GET", "/api/auth/me")).status, 401);

    // Admins keep every session.
    const adminPhone = client();
    assert.equal((await adminPhone.call("POST", "/api/auth/login", { email: "phase1-test-admin@example.com", password: "password-123" })).status, 200);
    assert.equal((await adminPhone.call("GET", "/api/auth/me")).status, 200);
    assert.equal((await admin.call("GET", "/api/auth/me")).status, 200);
    await UserModel.deleteOne({ email: login.email });
  });

  await check("hidden developer accounts are left out of the Users page, its counts and the stats", async () => {
    const before = (await admin.call("GET", "/api/admin/users")).json.data;
    const statsBefore = (await admin.call("GET", "/api/admin/stats")).json.data;
    const dev = client();
    const login = { email: "phase1-test-hidden@example.com", password: "password-123" };
    await dev.call("POST", "/api/auth/register", { name: "E2E Hidden", ...login, country: "PK" });
    const made = await UserModel.findOneAndUpdate({ email: login.email }, { $set: { hidden: true, plan: "paid", paidPlan: "three_months" } }, { new: true });
    const id = String(made!._id);

    const after = (await admin.call("GET", "/api/admin/users")).json.data;
    assert.equal(after.total, before.total);
    assert.deepEqual(after.counts, before.counts);
    assert.ok(!after.users.some((user: { id: string }) => user.id === id));
    assert.equal((await admin.call("GET", `/api/admin/users?search=${encodeURIComponent("phase1-test-hidden")}`)).json.data.total, 0);
    assert.equal((await admin.call("GET", `/api/admin/users/${id}`)).status, 404);
    assert.equal((await admin.call("PATCH", `/api/admin/users/${id}`, { status: "blocked" })).status, 404);
    const statsAfter = (await admin.call("GET", "/api/admin/stats")).json.data;
    assert.equal(statsAfter.users, statsBefore.users);
    assert.deepEqual(statsAfter.usersByRegion, statsBefore.usersByRegion);
    assert.equal(statsAfter.paidUsers, statsBefore.paidUsers);

    // The account itself works normally, with its paid plan.
    assert.equal((await dev.call("POST", "/api/auth/login", login)).status, 200);
    const me = await dev.call("GET", "/api/auth/me");
    assert.equal(me.json.data.user.plan, "paid");
    await UserModel.deleteOne({ email: login.email });
  });

  await check("week 3: history, mistake bank and retry queue, analytics, goals, streaks and leaderboards", async () => {
    // All checks share one address; start this long one with a fresh per-minute request allowance.
    const { apiRateLimit } = await import("../../src/middleware/rate-limit");
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) await apiRateLimit.resetKey(address);
    const login = { email: "phase1-test-week3@example.com", password: "password-123" };
    const me = client();
    assert.equal((await me.call("POST", "/api/auth/register", { name: "Week Three Student", ...login, country: "PK" })).status, 201);
    const userId = String((await UserModel.findOne({ email: login.email }))!._id);
    // Everything open, whatever earlier checks saved; put back at the end.
    const savedAccess = (await admin.call("GET", "/api/admin/settings/access")).json.data.settings;
    const open = { features: { drills: "free", mocks: "free", full_tests: "free", analytics: "free" }, content: [], newContent: "free" };
    assert.equal((await admin.call("PUT", "/api/admin/settings/access", open)).status, 200);

    const answer = (attempt: string, position: number, value: string) => me.call("PATCH", `/api/practice/attempts/${attempt}/questions/${position}`, { answer: value });
    // Time on screen is measured from page views; set it directly so the points rules can be tested.
    const spend = (attempt: string, seconds: number[]) =>
      AttemptModel.updateOne({ _id: attempt }, { $set: Object.fromEntries(seconds.map((value, index) => [`items.${index}.timeSpentSeconds`, value])) });
    // A right and a wrong answer for each question of an attempt (bank drills also draw from the
    // uploaded exam published above, whose keys are not all "A").
    const keysOf = async (attempt: string) => {
      const doc = (await AttemptModel.findById(attempt).lean())!;
      const questions = await QuestionModel.find({ _id: trusted({ $in: doc.items.map((item) => item.questionId) }) }).select("+correctAnswer choices questionType").lean();
      const byId = new Map(questions.map((question) => [String(question._id), question]));
      return doc.items.map((item) => {
        const question = byId.get(String(item.questionId))!;
        const right = question.correctAnswer!.choiceKey ?? question.correctAnswer!.acceptedValues[0]!;
        return { right, wrong: question.questionType === "mcq" ? question.choices.find((choice) => choice.key !== right)!.key : "98765" };
      });
    };
    const waitFor = async (condition: () => Promise<boolean>) => {
      for (let i = 0; i < 40 && !(await condition()); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(await condition(), "timed out waiting");
    };

    // Drill mode across the bank by skill: every question is of that skill.
    const drill = await me.call("POST", "/api/practice/drills/bank", { section: "math", skills: ["Linear functions"], count: 5 });
    assert.equal(drill.status, 201);
    const drillId = drill.json.data.attempt.id;
    const drillDoc = (await AttemptModel.findById(drillId))!;
    assert.equal(drillDoc.origin, "bank");
    assert.equal(drillDoc.items.length, 5);
    const skills = await QuestionModel.find({ _id: trusted({ $in: drillDoc.items.map((item) => item.questionId) }) }).distinct("skill");
    assert.deepEqual(skills, ["Linear functions"]);

    // Q1 right and checked (logged at once); Q2 right then changed to wrong; Q3 wrong; Q4 right; Q5 blank.
    await spend(drillId, [30, 30, 30, 30, 30]);
    const keys = await keysOf(drillId);
    await answer(drillId, 1, keys[0]!.right);
    assert.equal((await me.call("POST", `/api/practice/attempts/${drillId}/questions/1/check`)).status, 200);
    await waitFor(async () => (await QuestionLogModel.countDocuments({ attemptId: drillId })) === 1);
    await answer(drillId, 2, keys[1]!.right);
    await answer(drillId, 2, keys[1]!.wrong);
    await answer(drillId, 3, keys[2]!.wrong);
    await answer(drillId, 4, keys[3]!.right);
    assert.equal((await me.call("POST", `/api/practice/attempts/${drillId}/end`)).status, 200);
    const logs = await QuestionLogModel.find({ attemptId: drillId }).sort({ position: 1 }).lean();
    assert.deepEqual(
      logs.map((log) => [log.position, log.correct]),
      [
        [1, true],
        [2, false],
        [3, false],
        [4, true],
      ],
    );
    assert.equal(logs[1]!.changedFromCorrect, true);
    assert.equal(logs[2]!.changedFromCorrect, false);
    const points = logs.reduce((sum, log) => sum + log.points, 0);
    assert.ok(points >= 24);
    // The checked question was logged in the background: wait for its day total too.
    await waitFor(async () => (await DailyStatModel.findOne({ userId }))?.questions === 4);
    assert.equal((await UserModel.findById(userId))!.totalPoints, points);
    const today = (await DailyStatModel.findOne({ userId }))!;
    assert.equal(today.questions, 4);
    assert.equal(today.points, points);

    // Mistake bank: both wrong answers, back in 1 day.
    let bank = (await me.call("GET", "/api/student/mistakes")).json.data;
    assert.equal(bank.counts.open, 2);
    assert.equal(bank.counts.due, 0);
    const mistake = (await MistakeModel.findOne({ userId }))!;
    assert.ok(Math.abs(mistake.dueAt!.getTime() - Date.now() - 86_400_000) < 60_000);
    assert.equal((await me.call("POST", "/api/practice/drills/retry", { section: "math" })).status, 400);

    // Question history with filters; removing the drill from "My tests" keeps its history.
    assert.equal((await me.call("GET", "/api/student/history/questions?result=wrong")).json.data.total, 2);
    assert.equal((await me.call("GET", "/api/student/history/questions?section=reading_writing")).json.data.total, 0);
    assert.equal((await me.call("DELETE", `/api/practice/attempts/${drillId}`)).status, 200);
    assert.ok(!(await me.call("GET", "/api/practice/attempts")).json.data.attempts.some((attempt: { id: string }) => attempt.id === drillId));
    assert.equal((await me.call("GET", "/api/student/history/questions")).json.data.total, 4);

    // Retry queue: once due, the wrong questions come back; right answers fix them.
    await MistakeModel.updateMany({ userId }, { $set: { dueAt: new Date(Date.now() - 1000) } });
    bank = (await me.call("GET", "/api/student/mistakes")).json.data;
    assert.equal(bank.counts.dueBySection.math, 2);
    const retry = await me.call("POST", "/api/practice/drills/retry", { section: "math" });
    assert.equal(retry.status, 201);
    const retryId = retry.json.data.attempt.id;
    assert.equal(retry.json.data.attempt.total, 2);
    await spend(retryId, [30, 30]);
    const retryKeys = await keysOf(retryId);
    await answer(retryId, 1, retryKeys[0]!.right);
    await answer(retryId, 2, retryKeys[1]!.wrong);
    await me.call("POST", `/api/practice/attempts/${retryId}/end`);
    bank = (await me.call("GET", "/api/student/mistakes")).json.data;
    assert.equal(bank.counts.fixed, 1);
    assert.equal(bank.counts.open, 1);
    const stillOpen = (await MistakeModel.findOne({ userId, fixedAt: null }))!;
    assert.equal(stillOpen.step, 1); // next wait: 3 days
    assert.ok(Math.abs(stillOpen.dueAt!.getTime() - Date.now() - 3 * 86_400_000) < 60_000);

    // Random clicking through a set earns nothing.
    const rushed = (await me.call("POST", "/api/practice/drills/bank", { section: "reading_writing", count: 6 })).json.data.attempt.id;
    await spend(rushed, [2, 2, 2, 2, 2, 2]);
    for (let position = 1; position <= 6; position += 1) await answer(rushed, position, "A");
    await me.call("POST", `/api/practice/attempts/${rushed}/end`);
    assert.equal((await QuestionLogModel.find({ attemptId: rushed })).reduce((sum, log) => sum + log.points, 0), 0);

    // Predicted score from scored sections: one test never moves it more than 50 points.
    const section = (name: string, sectionName: string, score: number, day: number) => ({
      userId, kind: "mock", origin: "mock", name, section: sectionName, status: "done", sectionScore: score, completedAt: new Date(Date.UTC(2026, 9, day)), items: [],
    });
    await AttemptModel.insertMany([section("RW", "reading_writing", 600, 1), section("Math", "math", 600, 1), section("Math 2", "math", 780, 2)]);
    const analyticsResponse = await me.call("GET", "/api/student/analytics");
    assert.equal(analyticsResponse.status, 200, JSON.stringify(analyticsResponse.json));
    let analytics = analyticsResponse.json.data;
    assert.equal(analytics.full, true);
    assert.equal(analytics.prediction.total, 1250);
    assert.deepEqual(
      analytics.prediction.trend.map((point: { score: number }) => point.score),
      [1200, 1250],
    );
    assert.equal(analytics.completedPapers, 3);
    assert.ok(analytics.skills.some((stat: { skill: string }) => stat.skill === "Linear functions"));
    assert.ok(analytics.errors.patterns.find((pattern: { pattern: string }) => pattern.pattern === "changed_answer").count >= 1);
    // Skills breakdown: each section has its own skills and its own next step.
    for (const name of ["reading_writing", "math"]) {
      const own = analytics.skills.filter((stat: { section: string }) => stat.section === name);
      assert.ok(own.length > 0, name);
      assert.equal(analytics.skillSteps[name].drill.section, name);
      assert.deepEqual(analytics.skillSteps[name].drill.skills, [own[0].skill]);
    }
    const history =(await me.call("GET", "/api/student/history/tests")).json.data.tests;
    assert.deepEqual(
      history.map((test: { score: number; change: number | null }) => [test.score, test.change]),
      [
        [780, 180],
        [600, null],
        [600, null],
      ],
    );

    // Goal and streak: a lower goal is met by the next practice; bad settings are refused.
    assert.equal((await me.call("PATCH", "/api/student/engagement", { targetScore: 1455 })).status, 400);
    assert.equal((await me.call("PATCH", "/api/student/engagement", { timeZone: "Mars/Base" })).status, 400);
    assert.equal((await me.call("PATCH", "/api/student/engagement", { testDate: "2020-01-01" })).status, 400);
    assert.equal((await me.call("PATCH", "/api/student/engagement", { goalAmount: 5, targetScore: 1450, timeZone: "Asia/Karachi" })).status, 200);
    let summary = (await me.call("GET", "/api/student/engagement")).json.data;
    assert.equal(summary.goal.amount, 5);
    assert.equal(summary.streak.current, 0);
    assert.equal(summary.predicted, 1250);
    assert.equal(summary.mistakesDue, 0);
    const one = (await me.call("POST", "/api/practice/drills/bank", { section: "math", count: 1 })).json.data.attempt.id;
    await spend(one, [30]);
    await answer(one, 1, (await keysOf(one))[0]!.right);
    await me.call("POST", `/api/practice/attempts/${one}/end`);
    summary = (await me.call("GET", "/api/student/engagement")).json.data;
    assert.equal(summary.streak.current, 1);
    assert.equal(summary.streak.today, true);
    assert.equal(summary.goal.met, true);
    assert.match(summary.friendCode, /^[A-Z2-9]{8}$/);

    // Leaderboards: the student is on the global board; friends by code, both ways.
    const friend = client();
    await friend.call("POST", "/api/auth/register", { name: "Friendly Peer", email: "phase1-test-week3-friend@example.com", password: "password-123", country: "PK" });
    const board = (await me.call("GET", "/api/student/leaderboard?scope=global&period=week")).json.data;
    assert.ok(board.rows.some((row: { me: boolean; name: string }) => row.me && row.name === "Week Three Student"));
    assert.equal((await me.call("POST", "/api/student/friends", { code: summary.friendCode })).status, 400);
    assert.equal((await me.call("POST", "/api/student/friends", { code: "ZZZZZZZZ" })).status, 404);
    const friendCode = (await friend.call("GET", "/api/student/engagement")).json.data.friendCode;
    assert.equal((await me.call("POST", "/api/student/friends", { code: friendCode })).status, 201);
    assert.deepEqual(
      (await friend.call("GET", "/api/student/leaderboard?scope=friends&period=all")).json.data.friends.map((entry: { name: string }) => entry.name),
      ["Week Three Student"],
    );
    await me.call("PATCH", "/api/student/engagement", { showOnLeaderboard: false });
    assert.ok(!(await friend.call("GET", "/api/student/leaderboard?scope=global&period=all")).json.data.rows.some((row: { name: string }) => row.name === "Week Three Student"));

    // Free accounts with analytics kept for paid plans: score only, top 3 of each section, last 20 mistakes.
    assert.equal((await admin.call("PUT", "/api/admin/settings/access", { ...open, features: { ...open.features, analytics: "paid" } })).status, 200);
    analytics = (await me.call("GET", "/api/student/analytics")).json.data;
    assert.equal(analytics.full, false);
    assert.equal(analytics.prediction.total, 1250);
    assert.equal(analytics.prediction.low, null);
    assert.deepEqual(analytics.prediction.trend, []);
    for (const name of ["reading_writing", "math"]) {
      const own = analytics.skills.filter((stat: { section: string }) => stat.section === name);
      assert.ok(own.length > 0 && own.length <= 3, name);
    }
    assert.equal(analytics.errors, null);
    assert.equal(analytics.timing, null);
    bank = (await me.call("GET", "/api/student/mistakes")).json.data;
    assert.equal(bank.limited, true);
    assert.equal(bank.limit, 20);

    const card = (await me.call("GET", "/api/student/share-card")).json.data.card;
    assert.deepEqual([card.name, card.tests, card.best, card.streak], ["Week S.", 0, null, 1]);

    assert.equal((await admin.call("PUT", "/api/admin/settings/access", savedAccess)).status, 200);
    for (const email of [login.email, "phase1-test-week3-friend@example.com"]) {
      const user = await UserModel.findOne({ email });
      await Promise.all([QuestionLogModel.deleteMany({ userId: user!._id }), MistakeModel.deleteMany({ userId: user!._id }), DailyStatModel.deleteMany({ userId: user!._id }), AttemptModel.deleteMany({ userId: user!._id })]);
      await UserModel.deleteOne({ _id: user!._id });
    }
  });

  await check("an account without a country chooses one for its country board; admins clear deleted accounts for good", async () => {
    const { apiRateLimit } = await import("../../src/middleware/rate-limit");
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) await apiRateLimit.resetKey(address);
    const { timeZoneOf } = await import("../../src/services/engagement.service");
    const { dayIn, isoWeek } = await import("../../src/services/engagement-rules");
    const make = async (name: string, email: string) => {
      const session = client();
      assert.equal((await session.call("POST", "/api/auth/register", { name, email, password: "password-123", country: "PK" })).status, 201);
      const user = (await UserModel.findOne({ email }))!;
      // Points this week and in all time, without answering questions.
      await DailyStatModel.create({ userId: user._id, day: dayIn(new Date(), timeZoneOf(user)), week: isoWeek(dayIn(new Date(), timeZoneOf(user))), points: 40 });
      await UserModel.updateOne({ _id: user._id }, { $set: { totalPoints: 40 } });
      return { session, id: user._id };
    };
    const local = await make("Lahore Student", "phase1-test-country-a@example.com");
    const old = await make("Older Account", "phase1-test-country-b@example.com");
    // Made before sign-up asked for a country.
    await UserModel.updateOne({ _id: old.id }, { $set: { country: null, region: null } });

    for (const period of ["week", "all"]) {
      const empty = (await old.session.call("GET", `/api/student/leaderboard?scope=country&period=${period}`)).json.data;
      assert.equal(empty.country, null);
      assert.deepEqual(empty.rows, []);
      const pakistan = (await local.session.call("GET", `/api/student/leaderboard?scope=country&period=${period}`)).json.data;
      assert.equal(pakistan.country, "PK");
      assert.ok(pakistan.rows.some((row: { me: boolean }) => row.me));
    }
    assert.equal((await old.session.call("PUT", "/api/student/country", { country: "XX" })).status, 400);
    assert.equal((await old.session.call("PUT", "/api/student/country", { country: "pk" })).status, 200);
    const saved = (await UserModel.findById(old.id).lean())!;
    assert.deepEqual([saved.country, saved.region], ["PK", "local"]);
    for (const period of ["week", "all"]) {
      const names = (await old.session.call("GET", `/api/student/leaderboard?scope=country&period=${period}`)).json.data.rows.map((row: { name: string }) => row.name);
      assert.ok(names.includes("Older Account") && names.includes("Lahore Student"), `${period}: ${names}`);
    }
    // Set once; a country already set is not changed here.
    assert.equal((await old.session.call("PUT", "/api/student/country", { country: "SA" })).status, 409);
    assert.equal((await local.session.call("PUT", "/api/student/country", { country: "SA" })).status, 409);

    // Clearing deleted accounts: only admins; removes the account, its data and friend links; a restored account stays.
    const friendCode = (await old.session.call("GET", "/api/student/engagement")).json.data.friendCode;
    assert.equal((await local.session.call("POST", "/api/student/friends", { code: friendCode })).status, 201);
    const restored = await make("Comes Back", "phase1-test-country-c@example.com");
    for (const id of [old.id, restored.id]) assert.equal((await admin.call("PATCH", `/api/admin/users/${id}`, { status: "deleted" })).status, 200);
    assert.equal((await admin.call("PATCH", `/api/admin/users/${restored.id}`, { status: "active" })).status, 200);
    assert.equal((await local.session.call("DELETE", "/api/admin/users/deleted")).status, 403);
    const before = (await admin.call("GET", "/api/admin/users?status=deleted")).json.data.counts.deleted;
    assert.ok(before >= 1);
    const purge = await admin.call("DELETE", "/api/admin/users/deleted");
    assert.equal(purge.status, 200);
    assert.equal(purge.json.data.removed, before);
    assert.equal((await admin.call("GET", "/api/admin/users")).json.data.counts.deleted, 0);
    assert.equal(await UserModel.countDocuments({ _id: old.id }), 0);
    assert.equal(await DailyStatModel.countDocuments({ userId: old.id }), 0);
    assert.ok(!(await UserModel.findById(local.id).lean())!.friends?.some((friend) => String(friend) === String(old.id)));
    assert.equal(await UserModel.countDocuments({ _id: trusted({ $in: [local.id, restored.id] }) }), 2);
    assert.equal(await DailyStatModel.countDocuments({ userId: restored.id }), 1);
    assert.equal((await admin.call("DELETE", "/api/admin/users/deleted")).json.data.removed, 0);

    for (const { id } of [local, restored]) {
      await DailyStatModel.deleteMany({ userId: id });
      await UserModel.deleteOne({ _id: id });
    }
  });

  await check("Till Test Day is gone: three plans, older saved pricing kept, an account on it stays paid", async () => {
    const { SettingModel } = await import("@satsharks/db");
    const ids = (pricing: { plans: { id: string }[] }) => pricing.plans.map((plan) => plan.id);
    assert.deepEqual(ids((await student.call("GET", "/api/pricing")).json.data), ["free", "monthly", "three_months"]);

    // Pricing saved while there were four plans: the old plan is dropped, the admin's edits stay.
    const old = {
      plans: [
        { id: "free", name: "Free", price: { PKR: "PKR 0", USD: "$0" }, period: "forever", saving: null, highlights: ["2 full papers"], popular: false },
        { id: "monthly", name: "Monthly", price: { PKR: "PKR 1,234", USD: "$9.99" }, period: "per month", saving: null, highlights: ["Everything"], popular: false },
        { id: "three_months", name: "3 Months", price: { PKR: "PKR 3,500", USD: "$29.99" }, period: "per 3 months", saving: null, highlights: ["Everything"], popular: true },
        { id: "till_test_day", name: "Till Test Day", price: { PKR: "PKR 5,999", USD: "$49.99" }, period: "per 6 months", saving: null, highlights: ["Everything"], popular: false },
      ],
      comparison: [],
      tagline: "",
      schoolsNote: "",
      refundPolicy: "",
    };
    await SettingModel.updateOne({ key: "pricing" }, { $set: { value: old } }, { upsert: true });
    const pricing = (await student.call("GET", "/api/pricing")).json.data;
    assert.deepEqual(ids(pricing), ["free", "monthly", "three_months"]);
    assert.equal(pricing.plans[1].price.PKR, "PKR 1,234");
    assert.equal((await admin.call("PUT", "/api/admin/settings/pricing", old)).status, 400);
    assert.equal((await admin.call("PUT", "/api/admin/settings/pricing", { ...old, plans: old.plans.slice(0, 3) })).status, 200);
    await SettingModel.deleteOne({ key: "pricing" });

    // An account that still stores the old plan keeps paid access and shows as plain "Paid".
    const login = { email: "phase1-test-legacy-plan@example.com", password: "password-123" };
    const legacy = client();
    await legacy.call("POST", "/api/auth/register", { name: "Legacy Plan", ...login, country: "PK" });
    const user = await UserModel.findOneAndUpdate({ email: login.email }, { $set: { plan: "paid", paidPlan: "till_test_day" as never, planExpiresAt: null } }, { new: true });
    assert.equal((await legacy.call("GET", "/api/auth/me")).json.data.user.plan, "paid");
    const shown = (await admin.call("GET", `/api/admin/users/${user!._id}`)).json.data.user;
    assert.deepEqual([shown.plan, shown.paidPlan], ["paid", null]);
    assert.equal((await admin.call("PATCH", `/api/admin/users/${user!._id}`, { plan: "paid", paidPlan: "till_test_day" })).status, 400);
    assert.equal((await admin.call("PATCH", `/api/admin/users/${user!._id}`, { plan: "paid", paidPlan: "three_months" })).status, 200);
    await UserModel.deleteOne({ _id: user!._id });
  });

  await check("week 4: transfers approved by an admin, card checkout, renewal, offer, receipts, alerts badge", async () => {
    const { SettingModel, PaymentModel } = await import("@satsharks/db");
    await SettingModel.deleteMany({ key: trusted({ $in: ["access", "pricing", "payments"] }) });
    const login = { email: "phase1-test-buyer@example.com", password: "password-123" };
    const buyer = client();
    await buyer.call("POST", "/api/auth/register", { name: "Buyer Student", ...login, country: "PK", phone: "0300 1234567" });
    const me = async () => (await buyer.call("GET", "/api/auth/me")).json.data.user;
    assert.equal((await me()).plan, "free");

    // No way to pay until an admin turns one on; cards only with the (test) gateway.
    const empty = await buyer.call("GET", "/api/billing/checkout?plan=monthly");
    assert.equal(empty.status, 200, JSON.stringify(empty.json.error));
    assert.deepEqual([empty.json.data.currency, empty.json.data.amount, empty.json.data.methods.map((m: { method: string }) => m.method)], ["PKR", 1500, ["card"]]);
    // A Pakistani account pays in PKR; the pricing page's switch does not change that.
    assert.equal((await buyer.call("GET", "/api/billing/checkout?plan=monthly&currency=USD")).status, 400);
    assert.equal((await admin.call("GET", "/api/billing/checkout?plan=monthly")).status, 403);

    const settings = {
      manual: {
        bank_transfer: { enabled: true, instructions: "Meezan Bank · SAT Sharks · PK00 MEZN 0000 1111 2222", currencies: ["PKR", "USD"] },
        jazzcash: { enabled: true, instructions: "JazzCash 0300 0000000 (SAT Sharks)", currencies: ["PKR"] },
        easypaisa: { enabled: false, instructions: "", currencies: ["PKR"] },
      },
      alertEmail: "owner@example.com",
      exitOffer: { enabled: true, percentOff: 20, headline: "Take {percent}% off" },
      referrals: { enabled: true },
    };
    assert.equal((await student.call("PUT", "/api/admin/settings/payments", settings)).status, 403);
    assert.equal((await admin.call("PUT", "/api/admin/settings/payments", { ...settings, manual: { ...settings.manual, easypaisa: { enabled: true, instructions: "", currencies: ["PKR"] } } })).status, 400);
    assert.equal((await admin.call("PUT", "/api/admin/settings/payments", settings)).status, 200);
    const checkout = (await buyer.call("GET", "/api/billing/checkout?plan=three_months")).json.data;
    assert.deepEqual([checkout.amount, checkout.methods.map((m: { method: string }) => m.method)], [3500, ["card", "bank_transfer", "jazzcash"]]);

    // A transfer waits for approval; only one at a time; a transaction ID once.
    const sent = await buyer.call("POST", "/api/billing/payments", { plan: "monthly", currency: "PKR", method: "jazzcash", reference: "TXN-1001" });
    assert.equal(sent.status, 201, JSON.stringify(sent.json.error));
    assert.deepEqual([sent.json.data.payment.status, sent.json.data.payment.amount], ["review", 1500]);
    assert.equal((await buyer.call("POST", "/api/billing/payments", { plan: "monthly", currency: "PKR", method: "jazzcash", reference: "TXN-1002" })).status, 409);
    assert.equal((await me()).plan, "free", "nothing is given before approval");
    let stats = (await admin.call("GET", "/api/admin/stats")).json.data;
    assert.deepEqual(stats.payments, { unseen: 1, toReview: 1 });
    const listed = (await admin.call("GET", "/api/admin/payments?search=0300123")).json.data;
    assert.equal(listed.payments[0].user.email, login.email, "found by phone");
    assert.equal((await admin.call("POST", "/api/admin/payments/seen")).json.data.seen, 1);
    assert.equal((await admin.call("GET", "/api/admin/stats")).json.data.payments.unseen, 0);

    // Approve: paid for one month from now, receipt number, revenue.
    const paymentId = sent.json.data.payment.id;
    assert.equal((await student.call("POST", `/api/admin/payments/${paymentId}/review`, { decision: "approve" })).status, 403);
    const approved = await admin.call("POST", `/api/admin/payments/${paymentId}/review`, { decision: "approve", note: "Seen in JazzCash" });
    assert.equal(approved.status, 200, JSON.stringify(approved.json.error));
    assert.match(approved.json.data.payment.receiptNumber, /^SS-\d{8}-[0-9A-F]{6}$/);
    assert.equal((await admin.call("POST", `/api/admin/payments/${paymentId}/review`, { decision: "approve" })).status, 409, "approved once");
    const afterApproval = await me();
    assert.equal(afterApproval.plan, "paid");
    const firstEnd = new Date(afterApproval.planExpiresAt).getTime();
    assert.ok(Math.abs(firstEnd - new Date(approved.json.data.payment.periodEnd).getTime()) < 1000);
    assert.ok(firstEnd > Date.now() + 27 * 86_400_000 && firstEnd < Date.now() + 32 * 86_400_000);
    stats = (await admin.call("GET", "/api/admin/stats")).json.data;
    assert.equal(stats.revenue.PKR.total, 1500);
    assert.equal(stats.signups.today >= 1, true);
    // The same transaction ID cannot be sent again.
    assert.equal((await buyer.call("POST", "/api/billing/payments", { plan: "monthly", currency: "PKR", method: "jazzcash", reference: "txn-1001" })).status, 409);

    // Renewing by card (test gateway) adds the new period after the current one.
    const card = await buyer.call("POST", "/api/billing/card", { plan: "monthly", currency: "PKR" });
    assert.equal(card.status, 200, JSON.stringify(card.json.error));
    const cardId = new URL(card.json.data.redirectUrl, base).searchParams.get("payment")!;
    const outsider = client();
    await outsider.call("POST", "/api/auth/register", { name: "Other Student", email: "phase1-test-outsider@example.com", password: "password-123", country: "PK" });
    assert.equal((await outsider.call("POST", `/api/billing/test-gateway/${cardId}`, { outcome: "paid" })).status, 404, "only the payer");
    const cardPaid = await buyer.call("POST", `/api/billing/test-gateway/${cardId}`, { outcome: "paid" });
    assert.equal(cardPaid.json.data.payment.status, "paid");
    const renewedEnd = new Date((await me()).planExpiresAt).getTime();
    assert.ok(renewedEnd > firstEnd + 27 * 86_400_000, "renewal starts at the end of the running plan");
    assert.equal((await admin.call("GET", "/api/admin/stats")).json.data.payments.unseen, 1, "a card payment raises the badge");

    // Reject: the student is told, nothing is given.
    await UserModel.updateOne({ email: login.email }, { $set: { plan: "free", paidPlan: null, planExpiresAt: null } });
    const second = await buyer.call("POST", "/api/billing/payments", { plan: "three_months", currency: "PKR", method: "bank_transfer", reference: "IBFT-777", offer: true });
    assert.deepEqual([second.json.data.payment.amount, second.json.data.payment.discountPercent], [2800, 20], "the exit offer: 20% off 3,500");
    const rejected = await admin.call("POST", `/api/admin/payments/${second.json.data.payment.id}/review`, { decision: "reject", note: "Not received" });
    assert.equal(rejected.json.data.payment.status, "rejected");
    assert.equal((await me()).plan, "free");

    // The one-time offer is used up once a payment with it is paid.
    const withOffer = await buyer.call("POST", "/api/billing/payments", { plan: "three_months", currency: "PKR", method: "bank_transfer", reference: "IBFT-778", offer: true });
    await admin.call("POST", `/api/admin/payments/${withOffer.json.data.payment.id}/review`, { decision: "approve" });
    assert.equal((await buyer.call("GET", "/api/billing/checkout?plan=three_months&offer=1")).json.data.amount, 3500);
    const billing = (await buyer.call("GET", "/api/billing")).json.data;
    assert.deepEqual([billing.plan, billing.paidPlan, billing.autoRenew, billing.offer], ["paid", "three_months", true, null]);
    assert.deepEqual(billing.payments.map((p: { status: string }) => p.status), ["paid", "rejected", "paid", "paid"]);
    const receipt = await buyer.call("GET", `/api/billing/receipts/${withOffer.json.data.payment.id}`);
    assert.equal(receipt.json.data.payment.amount, 2800);
    assert.equal((await outsider.call("GET", `/api/billing/receipts/${withOffer.json.data.payment.id}`)).status, 404);
    assert.equal((await buyer.call("PUT", "/api/billing/auto-renew", { autoRenew: false })).status, 200);
    assert.equal((await buyer.call("GET", "/api/billing")).json.data.autoRenew, false);
    const buyerId = (await UserModel.findOne({ email: login.email }).lean())!._id;
    assert.equal((await admin.call("GET", `/api/admin/users/${buyerId}/payments`)).json.data.payments.length, 4);

    await PaymentModel.deleteMany({});
    await UserModel.deleteMany({ email: trusted({ $in: [login.email, "phase1-test-outsider@example.com"] }) });
    await SettingModel.deleteMany({ key: "payments" });
  });

  await check("week 4: invite-code exams, pins and labels, the free daily drill limit, scheduled papers", async () => {
    const { SettingModel } = await import("@satsharks/db");
    const { adminService } = await import("../../src/services/admin.service");
    const bankMath = (await PaperModel.findOne({ sourcePaperId: "bank-math" }).lean())!;
    const bankRw = (await PaperModel.findOne({ sourcePaperId: "bank-reading_writing" }).lean())!;
    const [math, rw] = [String(bankMath._id), String(bankRw._id)];
    const learner = client();
    await learner.call("POST", "/api/auth/register", { name: "Invite Student", email: "phase1-test-invite@example.com", password: "password-123", country: "PK" });

    const saved = await admin.call("PUT", "/api/admin/settings/access", {
      features: { drills: "free", mocks: "free", full_tests: "free", analytics: "free" },
      content: [
        { key: math, level: "invite", inviteCode: "school-2026", pinned: false, label: null },
        { key: rw, level: "free", pinned: true, label: "new" },
      ],
      newContent: "free",
      freeDrillQuestionsPerDay: 8,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json.error));
    let catalog = (await learner.call("GET", "/api/practice/catalog")).json.data;
    const examOf = (key: string) => catalog.exams.find((exam: { examId: string }) => exam.examId === key);
    assert.deepEqual([examOf(math).locked, examOf(math).lockReason, examOf(rw).pinned, examOf(rw).label, examOf(rw).free], [true, "invite", true, "new", true]);
    assert.equal(catalog.exams[0].pinned, true, "pinned first");
    assert.deepEqual(catalog.access.dailyDrill, { limit: 8, used: 0 });
    const blocked = await learner.call("POST", "/api/practice/attempts", { paperId: math, limit: 3 });
    assert.match(blocked.json.error!.message, /invite code only/);
    assert.equal((await learner.call("POST", "/api/student/invite-code", { code: "WRONG-1" })).status, 404);
    const redeemed = await learner.call("POST", "/api/student/invite-code", { code: "School-2026" });
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.json.error));
    catalog = (await learner.call("GET", "/api/practice/catalog")).json.data;
    assert.equal(examOf(math).locked, false);

    // Free daily limit: 8 drill questions; a 5 then a 5 gives 5 + 3; then refused.
    const first = await learner.call("POST", "/api/practice/attempts", { paperId: math, limit: 5 });
    assert.equal(first.status, 201, JSON.stringify(first.json.error));
    assert.equal((await AttemptModel.findById(first.json.data.attempt.id).lean())!.items.length, 5);
    const secondDrill = await learner.call("POST", "/api/practice/drills/bank", { section: "reading_writing", count: 5 });
    assert.equal(secondDrill.status, 201, JSON.stringify(secondDrill.json.error));
    assert.equal((await AttemptModel.findById(secondDrill.json.data.attempt.id).lean())!.items.length, 3);
    const third = await learner.call("POST", "/api/practice/drills/bank", { section: "reading_writing", count: 5 });
    assert.deepEqual([third.status, third.json.error!.code], [403, "daily_limit"]);
    assert.deepEqual((await learner.call("GET", "/api/practice/catalog")).json.data.access.dailyDrill, { limit: 8, used: 8 });

    // Scheduling: only in the future, only unpublished papers; the scheduler publishes on time.
    await PaperModel.updateOne({ _id: bankMath._id }, { $set: { status: "hidden" } });
    assert.equal((await admin.call("PUT", `/api/admin/papers/${math}/schedule`, { at: new Date(Date.now() - 60_000).toISOString() })).status, 400);
    const scheduled = await admin.call("PUT", `/api/admin/papers/${math}/schedule`, { at: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.json.error));
    assert.equal(await adminService.publishDue(new Date()), 0);
    assert.equal(await adminService.publishDue(new Date(Date.now() + 2 * 3_600_000)), 1);
    const published = (await PaperModel.findById(bankMath._id).lean())!;
    assert.deepEqual([published.status, published.publishAt], ["published", null]);
    assert.equal(await QuestionModel.countDocuments({ paperId: bankMath._id, status: trusted({ $ne: "published" }) }), 0);
    assert.equal((await admin.call("PUT", `/api/admin/papers/${math}/schedule`, { at: new Date(Date.now() + 3_600_000).toISOString() })).status, 400, "already published");

    await SettingModel.deleteOne({ key: "access" });
    await UserModel.deleteOne({ email: "phase1-test-invite@example.com" });
  });

  await check("week 4: friend invites give a free week; users by phone, CSV export, 30-day restore window; public numbers", async () => {
    const { paymentService } = await import("../../src/services/payment.service");
    const { userAdminService } = await import("../../src/services/user-admin.service");
    // Every check signs up from one address: give this one a fresh sign-up and request allowance.
    const { apiRateLimit, authRateLimit } = await import("../../src/middleware/rate-limit");
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) await Promise.all([apiRateLimit.resetKey(address), authRateLimit.resetKey(address)]);
    const inviter = client();
    await inviter.call("POST", "/api/auth/register", { name: "Inviter Student", email: "phase1-test-inviter@example.com", password: "password-123", country: "AE" });
    const code = (await inviter.call("GET", "/api/billing")).json.data.referrals.code;
    const friends = [];
    for (const n of [1, 2]) {
      const friend = client();
      const made = await friend.call("POST", "/api/auth/register", { name: `Invited ${n}`, email: `phase1-test-invited-${n}@example.com`, password: "password-123", country: "PK", ref: code, testDate: "2099-01-01" });
      assert.equal(made.status, 201, JSON.stringify(made.json.error));
      friends.push(friend);
    }
    const inviterDoc = (await UserModel.findOne({ email: "phase1-test-inviter@example.com" }).lean())!;
    assert.equal(inviterDoc.friends.length, 2, "invited friends are friends at once");
    assert.equal((await UserModel.findOne({ email: "phase1-test-invited-1@example.com" }).lean())!.engagement.testDate, null, "a test date far away is not kept");

    // They count once they have practised; two give a week.
    assert.deepEqual(await paymentService.processReferrals(), { qualified: 0, rewarded: 0 });
    await UserModel.updateMany({ referredBy: inviterDoc._id }, { $set: { totalPoints: 60 } });
    assert.deepEqual(await paymentService.processReferrals(), { qualified: 2, rewarded: 1 });
    assert.deepEqual(await paymentService.processReferrals(), { qualified: 0, rewarded: 0 }, "given once");
    const rewarded = (await inviter.call("GET", "/api/billing")).json.data;
    assert.equal(rewarded.plan, "paid");
    assert.deepEqual([rewarded.referrals.joined, rewarded.referrals.qualified, rewarded.referrals.rewards, rewarded.currency], [2, 2, 1, "USD"]);
    const ends = new Date(rewarded.planExpiresAt).getTime();
    assert.ok(ends > Date.now() + 6.9 * 86_400_000 && ends < Date.now() + 7.1 * 86_400_000);
    assert.equal(rewarded.payments[0].method, "referral");

    // Admin → Users: phone search, CSV, delete keeps a restore window, old deletions are removed.
    await UserModel.updateOne({ email: "phase1-test-invited-2@example.com" }, { $set: { phone: "+923451112233" } });
    const byPhone = (await admin.call("GET", "/api/admin/users?search=0345-111")).json.data.users;
    assert.deepEqual(byPhone.map((user: { email: string }) => user.email), ["phase1-test-invited-2@example.com"]);
    assert.equal((await student.text("/api/admin/users/export")).status, 403);
    const csv = await admin.text("/api/admin/users/export?search=phase1-test-invited");
    assert.match(csv.type ?? "", /text\/csv/);
    const lines = csv.body.replace(/^\uFEFF/, "").trim().split("\r\n");
    assert.equal(lines[0], "Name,Email,Phone,Country,Region,Role,Status,Plan,Paid plan,Plan ends,Joined");
    assert.equal(lines.length, 3);
    assert.ok(lines.some((line) => line.startsWith("Invited 2,phase1-test-invited-2@example.com,'+923451112233,PK,local,student,active,free")));
    const victim = (await UserModel.findOne({ email: "phase1-test-invited-1@example.com" }).lean())!;
    await admin.call("PATCH", `/api/admin/users/${victim._id}`, { status: "deleted" });
    const deleted = (await admin.call("GET", `/api/admin/users/${victim._id}`)).json.data.user;
    assert.ok(deleted.deletedAt && new Date(deleted.restorableUntil).getTime() - new Date(deleted.deletedAt).getTime() === 30 * 86_400_000);
    assert.deepEqual(await userAdminService.purgeDeleted(new Date(Date.now() - 30 * 86_400_000)), { removed: 0 }, "still inside the window");
    await UserModel.updateOne({ _id: victim._id }, { $set: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    assert.deepEqual(await userAdminService.purgeDeleted(new Date(Date.now() - 30 * 86_400_000)), { removed: 1 });

    const proof = (await student.call("GET", "/api/public/proof")).json.data;
    assert.ok(typeof proof.practisingNow === "number" && Array.isArray(proof.improvements));
    const { PaymentModel } = await import("@satsharks/db");
    await PaymentModel.deleteMany({});
    await UserModel.deleteMany({ email: trusted({ $in: ["phase1-test-inviter@example.com", "phase1-test-invited-2@example.com"] }) });
  });

  await check("Admin → Users bulk: ticked or all matching; delete, restore, delete for good; admins and yourself never", async () => {
    const { apiRateLimit, authRateLimit } = await import("../../src/middleware/rate-limit");
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) await Promise.all([apiRateLimit.resetKey(address), authRateLimit.resetKey(address)]);
    const emails = [1, 2, 3].map((n) => `phase1-test-bulk-${n}@example.com`);
    for (const [index, email] of emails.entries()) {
      assert.equal((await client().call("POST", "/api/auth/register", { name: `Bulk ${index + 1}`, email, password: "password-123", country: "PK" })).status, 201);
    }
    // The third one is another admin: bulk actions leave admins alone.
    await UserModel.updateOne({ email: emails[2] }, { $set: { role: "admin" } });
    const ids = (await UserModel.find({ email: trusted({ $in: emails }) }).sort({ email: 1 }).lean()).map((user) => String(user._id));
    const me = String((await UserModel.findOne({ email: "phase1-test-admin@example.com" }).lean())!._id);
    const status = async () => (await UserModel.find({ email: trusted({ $in: emails }) }).sort({ email: 1 }).lean()).map((user) => user.status);

    assert.equal((await student.call("POST", "/api/admin/users/bulk", { action: "delete", ids })).status, 403);
    assert.equal((await admin.call("POST", "/api/admin/users/bulk", { action: "delete", ids, filter: {} })).status, 400, "ids or filter, not both");
    assert.equal((await admin.call("POST", "/api/admin/users/bulk", { action: "delete" })).status, 400);

    // Ticked: two students, an admin and yourself → only the students.
    const ticked = await admin.call("POST", "/api/admin/users/bulk", { action: "delete", ids: [...ids, me] });
    assert.deepEqual(ticked.json.data, { changed: 2, skipped: 2 });
    assert.deepEqual(await status(), ["deleted", "deleted", "active"]);
    assert.equal((await UserModel.findById(me).lean())!.status, "active");
    assert.ok((await UserModel.findById(ids[0]).lean())!.deletedAt, "the restore window starts");
    // All matching (the Deleted tab, searched): restore.
    const restored = await admin.call("POST", "/api/admin/users/bulk", { action: "restore", filter: { status: "deleted", search: "phase1-test-bulk" } });
    assert.deepEqual(restored.json.data, { changed: 2, skipped: 0 });
    assert.deepEqual(await status(), ["active", "active", "active"]);
    assert.equal((await UserModel.findById(ids[0]).lean())!.deletedAt, null);
    // All matching on the All tab: delete; the admin among them is skipped.
    const all = await admin.call("POST", "/api/admin/users/bulk", { action: "delete", filter: { search: "phase1-test-bulk" } });
    assert.deepEqual(all.json.data, { changed: 2, skipped: 1 });
    // "Delete permanently" only touches deleted accounts.
    const purged = await admin.call("POST", "/api/admin/users/bulk", { action: "purge", ids });
    assert.deepEqual(purged.json.data, { changed: 2, skipped: 1 });
    assert.equal(await UserModel.countDocuments({ email: trusted({ $in: emails }) }), 1);
    await UserModel.deleteOne({ email: emails[2] });
  });

  await check("answer choices with no text or figure (graphs never imported) get an image per choice", async () => {
    const paper = await PaperModel.findOne({ sourcePaperId: "bank-math" }).lean();
    const blank = await QuestionModel.create({
      paperId: paper!._id, source: "bluecorn", sourceQuestionId: "blank-graphs", section: "math", moduleType: "none", questionNumber: 999, questionType: "mcq",
      prompt: "Which graph represents this relationship?", passage: null, status: "published",
      choices: ["A", "B", "C", "D"].map((key) => ({ key, text: "", viz: key === "D" ? { type: "line", data: [] } : null })),
      correctAnswer: { choiceKey: "B", acceptedValues: [] },
    });
    const path = `/api/admin/questions/${blank._id}`;
    const texts = (image: (key: string) => string | null | undefined) => ["A", "B", "C", "D"].map((key) => ({ key, text: "", ...(image(key) === undefined ? {} : { image: image(key) }) }));
    // Saving as it is names the empty choices (D has a drawn figure, so it is not empty).
    const refused = await admin.call("PATCH", path, { difficulty: "easy", choices: texts(() => undefined) });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error!.message, /Choice A, B, C are empty/);
    assert.equal((await admin.call("PATCH", path, { choices: texts((key) => (key === "D" ? undefined : "https://example.com/x.png")) })).status, 400, "only our own images");

    const urls: string[] = [];
    for (const n of [1, 2, 3]) {
      // Three different (tiny, valid) PNGs.
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      const form = new FormData();
      form.append("image", new Blob([Buffer.concat([png, Buffer.from([n])])], { type: "image/png" }), `graph-${n}.png`);
      urls.push((await admin.call("POST", "/api/admin/assets", undefined, form)).json.data.url);
    }
    const saved = await admin.call("PATCH", path, { choices: texts((key) => ({ A: urls[0], B: urls[1], C: urls[2], D: null })[key]) });
    assert.equal(saved.status, 200, JSON.stringify(saved.json.error));
    const choices = saved.json.data.question.choices;
    assert.deepEqual(choices.slice(0, 3).map((choice: { viz: { type: string; url: string } }) => [choice.viz.type, choice.viz.url]), urls.map((url) => ["image", url]));
    assert.equal(choices[3].viz.type, "line", "null keeps a drawn figure");
    // Left out keeps the image; null removes it (and then the choice is empty again).
    assert.equal((await admin.call("PATCH", path, { choices: texts(() => undefined) })).status, 200);
    assert.equal(((await QuestionModel.findById(blank._id).lean())!.choices[0]!.viz as { type: string }).type, "image");
    const removed = await admin.call("PATCH", path, { choices: texts((key) => (key === "A" ? null : undefined)) });
    assert.match(removed.json.error!.message, /Choice A is empty/);
    await QuestionModel.deleteOne({ _id: blank._id });
  });

  await check("no repeats: new questions first, oldest-seen top-up, one of each twin; the official pattern; highlights saved", async () => {
    const { apiRateLimit, authRateLimit } = await import("../../src/middleware/rate-limit");
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) await Promise.all([apiRateLimit.resetKey(address), authRateLimit.resetKey(address)]);
    const { contentKeyOf } = await import("@satsharks/db");
    const { MODULE_PATTERN } = await import("@satsharks/types");
    // One Reading & Writing exam: 12 questions per skill; the last of each skill is a twin of the one
    // before it (same text and table under another id, as the source reuses questions): 110 distinct.
    const paper = await PaperModel.create({ title: "Pattern exam — reading_writing", source: "bluecorn", sourcePaperId: "pattern-rw", status: "published", sections: ["reading_writing"], questionCount: 120 });
    const rwSkills = MODULE_PATTERN.reading_writing.map((entry) => ({ skill: (entry.match as { skill: string }).skill, topic: entry.domain! }));
    const docs = rwSkills.flatMap(({ skill, topic }, s) =>
      Array.from({ length: 12 }, (_, i) => {
        const n = i === 11 ? 10 : i;
        const text = `Pattern ${s}-${n}`;
        const doc = {
          paperId: paper._id, source: "bluecorn", sourceQuestionId: `pattern-${s}-${i}`, section: "reading_writing", moduleType: "none", questionNumber: s * 12 + i + 1, questionType: "mcq",
          difficulty: ["easy", "medium", "hard"][i % 3], topic, skill, prompt: text, passage: `Passage for ${text}`, assets: [],
          viz: skill === "Command of Evidence" && n % 2 === 0 ? { type: "table", headers: ["a"], rows: [[String(n)]] } : null,
          choices: ["A", "B", "C", "D"].map((key) => ({ key, text: key })), correctAnswer: { choiceKey: "A", acceptedValues: [] }, status: "published",
        };
        return { ...doc, contentKey: contentKeyOf(doc as never) };
      }),
    );
    await QuestionModel.insertMany(docs);
    const keyOf = new Map(docs.map((doc, i) => [doc.sourceQuestionId, doc.contentKey] as const));
    assert.equal(new Set(keyOf.values()).size, 110);

    const login = { name: "E2E Pattern", email: "phase1-test-pattern@example.com", password: "password-123", country: "PK" };
    const learner = client();
    await learner.call("POST", "/api/auth/register", login);
    await UserModel.updateOne({ email: login.email }, { $set: { plan: "paid", paidPlan: "monthly", planExpiresAt: null } });
    await learner.call("POST", "/api/auth/login", { email: login.email, password: login.password });

    // The admin setting is on by default and stays on when an older page sends only the threshold.
    assert.equal((await admin.call("GET", "/api/admin/settings/adaptive")).json.data.officialPattern, true);
    assert.equal((await admin.call("PUT", "/api/admin/settings/adaptive", { routingThresholdPercent: 65 })).json.data.officialPattern, true);

    const itemsOf = async (attemptId: string) => {
      const attempt = (await AttemptModel.findById(attemptId).lean())!;
      const questions = await QuestionModel.find({ _id: trusted({ $in: attempt.items.map((item) => item.questionId) }) }).lean();
      const byId = new Map(questions.map((question) => [String(question._id), question]));
      return attempt.items.map((item) => ({ module: item.module, ...byId.get(String(item.questionId))! }));
    };
    const takeMock = async () => {
      const started = await learner.call("POST", "/api/practice/mocks", { section: "reading_writing", paperIds: [String(paper._id)], timed: false });
      assert.equal(started.status, 201, JSON.stringify(started.json.error));
      const attemptId = started.json.data.attempt.id as string;
      assert.equal((await learner.call("POST", `/api/practice/attempts/${attemptId}/submit-module`)).status, 200);
      return attemptId;
    };
    const conventions = new Set(["Boundaries", "Form, Structure, and Sense"]);
    const shape = (skills: (string | null)[]) => skills.map((skill) => (conventions.has(skill ?? "") ? "Conventions" : skill));

    // Mock 1: both modules follow the official pattern, in order; nothing appears twice.
    const first = await takeMock();
    const one = await itemsOf(first);
    for (const [module, field] of [["m1", "m1"], ["m2_easy", "m2"]] as const) {
      const got = one.filter((item) => (module === "m1" ? item.module === "m1" : item.module !== "m1"));
      const expected = MODULE_PATTERN.reading_writing.flatMap((entry) => Array<string>(entry[field]).fill((entry.match as { skill: string }).skill));
      assert.deepEqual(shape(got.map((item) => item.skill)), shape(expected), `pattern of ${module}`);
      assert.equal(got.filter((item) => item.skill === "Command of Evidence" && item.viz).length, 2, "two evidence questions on a table");
    }
    assert.equal(new Set(one.map((item) => item.contentKey)).size, 54, "no twin twice in one mock");

    // Highlights: saved per question, given back, refused when invalid, closed with the module.
    await learner.call("POST", `/api/practice/attempts/${first}/end`);
    const second = await (async () => {
      const started = await learner.call("POST", "/api/practice/mocks", { section: "reading_writing", paperIds: [String(paper._id)], timed: false });
      return started.json.data.attempt.id as string;
    })();
    const mark = { id: "h1", target: "passage", start: 0, end: 7, color: "blue", underline: true, note: "main claim" };
    const path = `/api/practice/attempts/${second}/questions/1`;
    assert.equal((await learner.call("PUT", `${path}/annotations`, { annotations: [mark] })).status, 200);
    assert.deepEqual((await learner.call("GET", path)).json.data.question.annotations, [mark]);
    assert.equal((await learner.call("PUT", `${path}/annotations`, { annotations: [{ ...mark, end: 0 }] })).status, 400, "empty range");
    assert.equal((await learner.call("PUT", `${path}/annotations`, { annotations: [{ ...mark, color: "green" }] })).status, 400, "unknown colour");
    assert.equal((await learner.call("PUT", `${path}/annotations`, { annotations: Array.from({ length: 61 }, (_, i) => ({ ...mark, id: `h${i}` })) })).status, 400, "too many");
    assert.equal((await student.call("PUT", `${path}/annotations`, { annotations: [] })).status, 404, "someone else's attempt");
    // A question opened again (another device, a reload) still has them; the answer is untouched.
    assert.equal((await learner.call("GET", path)).json.data.question.annotations.length, 1);
    assert.equal((await learner.call("POST", `/api/practice/attempts/${second}/submit-module`)).status, 200);
    assert.equal((await learner.call("PUT", `${path}/annotations`, { annotations: [] })).status, 409, "Module 1 is closed");
    await learner.call("POST", `/api/practice/attempts/${second}/end`);
    assert.equal((await learner.call("PUT", `/api/practice/attempts/${second}/questions/30/annotations`, { annotations: [] })).status, 409, "attempt ended");

    // Mock 2 shares nothing with mock 1 (110 distinct questions, 108 used by the two mocks).
    const two = await itemsOf(second);
    const firstKeys = new Set(one.map((item) => item.contentKey));
    assert.equal(two.filter((item) => firstKeys.has(item.contentKey)).length, 0, "mock 2 repeats nothing from mock 1");
    assert.equal(new Set(two.map((item) => item.contentKey)).size, 54);

    // Mock 3: the two never-seen questions first, then only the ones seen longest ago (mock 1).
    const third = await takeMock();
    const three = await itemsOf(third);
    const secondKeys = new Set(two.map((item) => item.contentKey));
    const unseen = [...new Set(keyOf.values())].filter((key) => !firstKeys.has(key) && !secondKeys.has(key));
    assert.equal(unseen.length, 2);
    assert.ok(unseen.every((key) => three.some((item) => item.contentKey === key)), "every never-seen question is used");
    assert.equal(three.filter((item) => secondKeys.has(item.contentKey)).length, 0, "nothing from the most recent mock");
    assert.equal(new Set(three.map((item) => item.contentKey)).size, 54);
    await learner.call("POST", `/api/practice/attempts/${third}/end`);

    // Drills from a Math exam of 40 questions, 15 at a time: new first, then the oldest seen.
    const mathPaper = await PaperModel.create({ title: "Drill exam — math", source: "bluecorn", sourcePaperId: "pattern-math", status: "published", sections: ["math"], questionCount: 40 });
    await QuestionModel.insertMany(
      Array.from({ length: 40 }, (_, i) => ({
        paperId: mathPaper._id, source: "bluecorn", sourceQuestionId: `drill-${i}`, section: "math", moduleType: "none", questionNumber: i + 1, questionType: "mcq",
        topic: "Algebra", skill: "Linear functions", prompt: `Drill question ${i}`, passage: null, contentKey: `drill-key-${i}`,
        choices: ["A", "B", "C", "D"].map((key) => ({ key, text: key })), correctAnswer: { choiceKey: "A", acceptedValues: [] }, status: "published",
      })),
    );
    const drill = async () => {
      const started = await learner.call("POST", "/api/practice/attempts", { paperId: String(mathPaper._id), limit: 15 });
      assert.equal(started.status, 201, JSON.stringify(started.json.error));
      return (await AttemptModel.findById(started.json.data.attempt.id).lean())!.items.map((item) => String(item.questionId));
    };
    const d1 = await drill();
    const d2 = await drill();
    assert.equal(d2.filter((id) => d1.includes(id)).length, 0, "second drill: all new");
    const d3 = await drill();
    const rest = (await QuestionModel.find({ paperId: mathPaper._id, status: "published" }).select("_id").lean()).map((q) => String(q._id)).filter((id) => !d1.includes(id) && !d2.includes(id));
    assert.equal(rest.length, 10);
    assert.ok(rest.every((id) => d3.includes(id)), "the never-seen ones first");
    assert.equal(d3.filter((id) => d2.includes(id)).length, 0, "then the oldest drill's, not the latest");

    // Turned off, mocks are built one question per skill in turn (and still never repeat a twin).
    assert.equal((await admin.call("PUT", "/api/admin/settings/adaptive", { routingThresholdPercent: 65, officialPattern: false })).json.data.officialPattern, false);
    const spread = await takeMock();
    assert.equal(new Set((await itemsOf(spread)).map((item) => item.contentKey)).size, 54);
    await admin.call("PUT", "/api/admin/settings/adaptive", { routingThresholdPercent: 65, officialPattern: true });

    // An exam too small for two Math modules (10 questions) is topped up from other exams: all 10
    // are used, the rest are new questions of other exams (not the drill exam, all seen).
    const mathDomains = MODULE_PATTERN.math.map((entry) => (entry.match as { topic: string }).topic);
    const mathExam = (id: string, count: number, topicOf: (i: number) => string) =>
      PaperModel.create({ title: `${id} — math`, source: "bluecorn", sourcePaperId: id, status: "published", sections: ["math"], questionCount: count }).then(async (made) => {
        await QuestionModel.insertMany(
          Array.from({ length: count }, (_, i) => ({
            paperId: made._id, source: "bluecorn", sourceQuestionId: `${id}-${i}`, section: "math", moduleType: "none", questionNumber: i + 1, questionType: i % 4 === 0 ? "spr" : "mcq",
            topic: topicOf(i), skill: `${topicOf(i)} skill`, prompt: `${id} question ${i}`, passage: null, contentKey: `${id}-key-${i}`,
            choices: i % 4 === 0 ? [] : ["A", "B", "C", "D"].map((key) => ({ key, text: key })), correctAnswer: { choiceKey: i % 4 === 0 ? null : "A", acceptedValues: i % 4 === 0 ? ["1"] : [] }, status: "published",
          })),
        );
        return made;
      });
    const tiny = await mathExam("tiny-math", 10, () => "Algebra");
    const other = await mathExam("other-math", 80, (i) => mathDomains[i % 4]!);
    const { invalidateCatalog } = await import("../../src/services/practice.service");
    invalidateCatalog();
    const topped = await learner.call("POST", "/api/practice/mocks", { section: "math", paperIds: [String(tiny._id)], timed: false });
    assert.equal(topped.status, 201, JSON.stringify(topped.json.error));
    const toppedId = topped.json.data.attempt.id as string;
    const extra = (await AttemptModel.findById(toppedId).lean())!.extraPaperIds.map(String);
    assert.ok(extra.includes(String(other._id)) && !extra.includes(String(tiny._id)), "other exams recorded as top-up");
    assert.equal((await learner.call("POST", `/api/practice/attempts/${toppedId}/submit-module`)).status, 200);
    const toppedItems = await itemsOf(toppedId);
    assert.equal(toppedItems.length, 44, "both Math modules are full");
    assert.equal(new Set(toppedItems.map((item) => item.contentKey)).size, 44);
    assert.equal(toppedItems.filter((item) => String(item.paperId) === String(tiny._id)).length, 10, "all of the small exam's questions are used");
    assert.equal(toppedItems.filter((item) => String(item.paperId) === String(mathPaper._id)).length, 0, "new questions of other exams before repeats");
    assert.ok(toppedItems.filter((item) => item.module !== "m1").some((item) => String(item.paperId) === String(other._id)), "Module 2 uses the top-up too");
    await learner.call("POST", `/api/practice/attempts/${toppedId}/end`);

    // A full test on an exam with no Math at all: Math still has both modules, from other exams.
    const full = await learner.call("POST", "/api/practice/full-tests", { paperIds: { reading_writing: [String(paper._id)], math: [] }, timed: false });
    assert.equal(full.status, 201, JSON.stringify(full.json.error));
    const fullId = full.json.data.fullTest.id as string;
    await learner.call("POST", `/api/practice/attempts/${full.json.data.fullTest.readingWriting.id}/end`);
    const continued = await learner.call("POST", `/api/practice/full-tests/${fullId}/continue`);
    assert.equal(continued.status, 200, JSON.stringify(continued.json.error));
    const mathSection = continued.json.data.fullTest.math.id as string;
    assert.equal((await learner.call("POST", `/api/practice/attempts/${mathSection}/submit-module`)).status, 200);
    assert.equal((await itemsOf(mathSection)).length, 44, "Math: 22 + 22");
    await learner.call("POST", `/api/practice/attempts/${mathSection}/end`);
    await QuestionModel.deleteMany({ paperId: trusted({ $in: [tiny._id, other._id] }) });
    await PaperModel.deleteMany({ _id: trusted({ $in: [tiny._id, other._id] }) });
    const { FullTestModel } = await import("@satsharks/db");
    await FullTestModel.deleteMany({ _id: fullId });
    invalidateCatalog();

    await AttemptModel.deleteMany({ userId: (await UserModel.findOne({ email: login.email }).lean())!._id });
    await UserModel.deleteOne({ email: login.email });
    await QuestionModel.deleteMany({ paperId: trusted({ $in: [paper._id, mathPaper._id] }) });
    await PaperModel.deleteMany({ _id: trusted({ $in: [paper._id, mathPaper._id] }) });
  });

  console.log(`\n${passed} end-to-end checks passed.`);
}
