// Gives every question its fingerprint (QuestionDoc.contentKey), so questions the source reused
// under another id count as one question when tests are built. Only writes `contentKey`, only where
// it is missing or out of date; safe to run again.
//
//   npx tsx apps/api/src/cli/backfill-content-keys.ts [--dry-run]
import { requireEnv } from "@satsharks/config";
import { connectMongo, contentKeyOf, disconnectMongo, QuestionModel, type QuestionDoc } from "@satsharks/db";

const BATCH = 500;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  await connectMongo(requireEnv("MONGODB_URI"));
  const cursor = QuestionModel.find({})
    .select("prompt passage choices assets viz contentKey status")
    .lean<QuestionDoc[]>()
    .cursor();

  let seen = 0;
  let changed = 0;
  const published = new Map<string, number>();
  let ops: Parameters<typeof QuestionModel.bulkWrite>[0] = [];
  for await (const question of cursor as AsyncIterable<QuestionDoc>) {
    seen++;
    const key = contentKeyOf(question);
    if (question.status === "published") published.set(key, (published.get(key) ?? 0) + 1);
    if (question.contentKey === key) continue;
    changed++;
    ops.push({ updateOne: { filter: { _id: question._id }, update: { $set: { contentKey: key } } } });
    if (ops.length >= BATCH) {
      if (!dryRun) await QuestionModel.bulkWrite(ops, { ordered: false });
      ops = [];
    }
  }
  if (ops.length > 0 && !dryRun) await QuestionModel.bulkWrite(ops, { ordered: false });

  const twins = [...published.values()].filter((count) => count > 1);
  console.log(
    JSON.stringify({
      questions: seen,
      [dryRun ? "wouldSet" : "set"]: changed,
      publishedDistinct: published.size,
      publishedWithTwins: twins.reduce((sum, count) => sum + count, 0),
      twinGroups: twins.length,
    }),
  );
  await disconnectMongo();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
