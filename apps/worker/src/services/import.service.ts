// Writes a normalized paper into MongoDB. Source-agnostic: it only sees SAT Sharks shapes.
import { contentKeyOf, PaperModel, QuestionModel } from "@satsharks/db";
import type { NormalizedPaper, NormalizedQuestion } from "@satsharks/validation";

export interface ImportResult {
  paperId: string;
  paperCreated: boolean;
  questionsInserted: number;
  questionsUpdated: number;
  questionsInDatabase: number;
  status: string;
}

// Idempotent: papers are keyed by (source, sourcePaperId), questions by (paper, module, sourceQuestionId).
// Running it twice updates in place and never duplicates.
export async function upsertPaper(paper: NormalizedPaper, questions: NormalizedQuestion[]): Promise<ImportResult> {
  // Indexes carry the uniqueness guarantee, so make sure they exist before writing.
  await Promise.all([PaperModel.init(), QuestionModel.init()]);

  const { status, source, sourcePaperId, ...paperFields } = paper;
  const existing = await PaperModel.exists({ source, sourcePaperId });
  const saved = await PaperModel.findOneAndUpdate(
    { source, sourcePaperId },
    // Status is only set on first import, so re-importing never undoes an admin's publish/hide decision.
    { $set: paperFields, $setOnInsert: { status } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const writeResult = await QuestionModel.bulkWrite(
    questions.map((question) => ({
      updateOne: {
        filter: {
          paperId: saved._id,
          moduleType: question.moduleType,
          sourceQuestionId: question.sourceQuestionId,
        },
        update: { $set: { ...question, contentKey: contentKeyOf({ ...question, assets: question.assets ?? [] }) }, $setOnInsert: { status } },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return {
    paperId: String(saved._id),
    paperCreated: existing === null,
    questionsInserted: writeResult.upsertedCount,
    questionsUpdated: writeResult.matchedCount,
    questionsInDatabase: await QuestionModel.countDocuments({ paperId: saved._id }),
    status: saved.status,
  };
}
