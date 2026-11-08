// The private leaderboard for admins: every active student (including students who opted out),
// richer practice statistics, anti-farming signals, CSV export and the two moderation actions.
import {
  DailyStatModel,
  effectivePlan,
  QuestionLogModel,
  trusted,
  UserModel,
  type DailyStatDoc,
  type UserDoc,
} from "@satsharks/db";
import { MIN_SECONDS_FOR_POINTS, type AdminLeaderboard, type AdminLeaderboardRow } from "@satsharks/types";
import type { AdminLeaderboardQuery } from "@satsharks/validation";
import mongoose from "mongoose";
import { AppError } from "../utils/app-error";
import { csvCell } from "./payment-rules";
import { dayIn, isoWeek, streakOn } from "./engagement-rules";
import { engagementOf, freezesPerMonth, streakOf, timeZoneOf } from "./engagement.service";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type LogStats = {
  _id: mongoose.Types.ObjectId;
  questions: number;
  correct: number;
  fastAnswers: number;
  lastActiveAt: Date | null;
};

function paidNow(now: Date) {
  return { plan: "paid", $or: trusted([{ planExpiresAt: null }, { planExpiresAt: trusted({ $gt: now }) }]) };
}

function studentFilter(query: AdminLeaderboardQuery, now: Date): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ role: "student", status: "active", hidden: trusted({ $ne: true }) }];
  if (query.country) and.push({ country: query.country });
  if (query.plan === "paid") and.push(paidNow(now));
  if (query.plan === "free") and.push({ $nor: trusted([paidNow(now)]) });
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), "i");
    and.push({ $or: trusted([{ name: pattern }, { email: pattern }]) });
  }
  return { $and: trusted(and) };
}

function pakistanWeekBounds(now: Date): { week: string; start: Date; end: Date } {
  const today = dayIn(now, "Asia/Karachi");
  const localMidnight = new Date(`${today}T00:00:00+05:00`);
  const daysSinceMonday = (localMidnight.getUTCDay() + 6) % 7;
  const start = new Date(localMidnight.getTime() - daysSinceMonday * 86_400_000);
  return { week: isoWeek(today), start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

async function allRows(query: AdminLeaderboardQuery, now = new Date()): Promise<AdminLeaderboardRow[]> {
  const users = await UserModel.find(studentFilter(query, now))
    .select("name email country plan planExpiresAt engagement streak totalPoints role region")
    .lean<UserDoc[]>();
  if (users.length === 0) return [];

  const ids = users.map((user) => user._id);
  const bounds = pakistanWeekBounds(now);
  const inPeriod: Record<string, unknown> =
    query.period === "week"
      ? { $and: [{ $gte: ["$answeredAt", bounds.start] }, { $lt: ["$answeredAt", bounds.end] }] }
      : { $literal: true };
  const answered = { $and: [inPeriod, { $ne: ["$correct", null] }] };
  const fast = {
    $and: [
      answered,
      {
        $or: [
          { $and: [{ $eq: ["$section", "math"] }, { $lt: ["$timeSpentSeconds", MIN_SECONDS_FOR_POINTS.math] }] },
          { $and: [{ $eq: ["$section", "reading_writing"] }, { $lt: ["$timeSpentSeconds", MIN_SECONDS_FOR_POINTS.reading_writing] }] },
        ],
      },
    ],
  };

  const [logs, weekPoints] = await Promise.all([
    QuestionLogModel.aggregate<LogStats>([
      { $match: { userId: { $in: ids } } },
      {
        $group: {
          _id: "$userId",
          questions: { $sum: { $cond: [answered, 1, 0] } },
          correct: { $sum: { $cond: [{ $and: [inPeriod, { $eq: ["$correct", true] }] }, 1, 0] } },
          fastAnswers: { $sum: { $cond: [fast, 1, 0] } },
          lastActiveAt: { $max: "$answeredAt" },
        },
      },
    ]),
    query.period === "week"
      ? DailyStatModel.aggregate<{ _id: mongoose.Types.ObjectId; points: number }>([
          { $match: { userId: { $in: ids }, week: bounds.week } },
          { $group: { _id: "$userId", points: { $sum: "$points" } } },
        ])
      : Promise.resolve([]),
  ]);
  const statsByUser = new Map(logs.map((entry) => [String(entry._id), entry]));
  const pointsByUser = new Map(weekPoints.map((entry) => [String(entry._id), entry.points]));

  const rows = users.map((user): Omit<AdminLeaderboardRow, "rank"> => {
    const stats = statsByUser.get(String(user._id));
    const questions = stats?.questions ?? 0;
    const fastAnswers = stats?.fastAnswers ?? 0;
    const fastAnswerRate = questions > 0 ? fastAnswers / questions : 0;
    return {
      id: String(user._id),
      name: user.name,
      email: user.email,
      country: user.country ?? null,
      plan: effectivePlan(user, now),
      points: query.period === "week" ? (pointsByUser.get(String(user._id)) ?? 0) : (user.totalPoints ?? 0),
      questions,
      accuracy: questions > 0 ? (stats?.correct ?? 0) / questions : null,
      streak: streakOn(streakOf(user), dayIn(now, timeZoneOf(user)), freezesPerMonth(user)).current,
      lastActiveAt: stats?.lastActiveAt ? stats.lastActiveAt.toISOString() : null,
      showOnLeaderboard: engagementOf(user).showOnLeaderboard,
      fastAnswers,
      fastAnswerRate,
      veryFastAnswers: fastAnswers >= 5 && fastAnswers * 2 >= questions,
    };
  });
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export const adminLeaderboardService = {
  async list(query: AdminLeaderboardQuery): Promise<AdminLeaderboard> {
    const rows = await allRows(query);
    const start = (query.page - 1) * query.pageSize;
    return { rows: rows.slice(start, start + query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize };
  },

  async exportCsv(query: AdminLeaderboardQuery): Promise<string> {
    const rows = await allRows(query);
    const header = [
      "Rank",
      "Student",
      "Email",
      "Country",
      "Plan",
      "Points",
      "Questions answered",
      "Accuracy",
      "Streak",
      "Last active",
      "On leaderboard",
      "Very fast answers",
      "Fast-answer rate",
    ];
    const body = rows.map((row) => [
      row.rank,
      row.name,
      row.email,
      row.country,
      row.plan,
      row.points,
      row.questions,
      row.accuracy == null ? "" : `${Math.round(row.accuracy * 100)}%`,
      row.streak,
      row.lastActiveAt,
      row.showOnLeaderboard ? "Shown" : "Hidden by student/admin",
      row.fastAnswers,
      `${Math.round(row.fastAnswerRate * 100)}%`,
    ]);
    return "\uFEFF" + [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  },

  async setVisibility(id: string, shown: boolean): Promise<{ shown: boolean }> {
    const user = await UserModel.findOne({ _id: id, role: "student", status: "active", hidden: trusted({ $ne: true }) })
      .select("engagement")
      .lean<UserDoc>();
    if (!user) throw AppError.notFound("Student not found");
    // Very old accounts may have no engagement subdocument. Creating the complete default-backed
    // value avoids MongoDB's "cannot create field in null" error for the dotted update.
    if (!user.engagement) {
      await UserModel.updateOne({ _id: user._id }, { $set: { engagement: { ...engagementOf(user), showOnLeaderboard: shown } } });
    } else {
      await UserModel.updateOne({ _id: user._id }, { $set: { "engagement.showOnLeaderboard": shown } });
    }
    return { shown };
  },

  async resetWeek(id: string, now = new Date()): Promise<{ removed: number }> {
    const user = await UserModel.findOne({ _id: id, role: "student", status: "active", hidden: trusted({ $ne: true }) })
      .select("engagement region")
      .lean<UserDoc>();
    if (!user) throw AppError.notFound("Student not found");
    const week = isoWeek(dayIn(now, timeZoneOf(user)));
    const stats = await DailyStatModel.find({ userId: user._id, week }).select("day points").lean<DailyStatDoc[]>();
    const removed = stats.reduce((sum, stat) => sum + Math.max(0, stat.points ?? 0), 0);
    if (stats.length > 0) {
      const days = [...new Set(stats.map((stat) => stat.day))];
      await Promise.all([
        DailyStatModel.updateMany({ userId: user._id, week }, { $set: { points: 0 } }),
        QuestionLogModel.updateMany({ userId: user._id, day: trusted({ $in: days }) }, { $set: { points: 0 } }),
      ]);
    }
    if (removed > 0) {
      const updated = await UserModel.findByIdAndUpdate(user._id, { $inc: { totalPoints: -removed } }, { new: true }).select("totalPoints").lean<UserDoc>();
      if (updated && updated.totalPoints < 0) await UserModel.updateOne({ _id: user._id }, { $set: { totalPoints: 0 } });
    }
    return { removed };
  },
};
