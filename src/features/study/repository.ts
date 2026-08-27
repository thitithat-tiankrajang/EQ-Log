// Reading back the study archive.
//
// Writing is deliberately absent from this file. A study record is created by
// the ENGINE SERVICE at the moment the search finishes — see
// `save_study_analysis` in supabase/study_positions_migration.sql — so that a
// `super` search that runs for minutes leaves a record whether or not the
// player stayed on the page. A browser-side insert would also be a second
// opinion about what the bot said, which is the one thing a record of what the
// bot said must not have.

import type { AnalysisCandidate } from "../../bot/engineApi";
import { supabase } from "../../supabaseClient";

export type StudyBoardCell = { r: number; c: number; kind: string; token: string };

export type StudyMethod = {
  solver: "greedy" | "sim" | "endgame";
  samples: number;
  legalMoves: number;
  candidatesEvaluated: number;
  nodes: number;
  elapsedMs: number;
  proven: boolean;
  complete: boolean;
};

export type StudyRecord = {
  id: string;
  createdAt: string;
  scoreSelf: number;
  scoreOpponent: number;
  board: StudyBoardCell[];
  rack: string[];
  oppRackCount: number;
  bagCount: number;
  level: string;
  summary: string;
  method: StudyMethod | null;
  candidates: AnalysisCandidate[];
};

type StudyRow = {
  id: string;
  created_at: string;
  score_self: number;
  score_opponent: number;
  board: unknown;
  rack: unknown;
  opp_rack_count: number;
  bag_count: number;
  level: string;
  summary: string | null;
  method: unknown;
  candidates: unknown;
};

const COLUMNS =
  "id,created_at,score_self,score_opponent,board,rack,opp_rack_count,bag_count,level,summary,method,candidates";

function friendly(message: string): Error {
  if (/study_positions|save_study_analysis/i.test(message)) {
    return new Error(
      "The study tables are missing. Run supabase/study_positions_migration.sql in Supabase.",
    );
  }
  return new Error(message);
}

function toRecord(row: StudyRow): StudyRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    scoreSelf: Number(row.score_self),
    scoreOpponent: Number(row.score_opponent),
    board: Array.isArray(row.board) ? (row.board as StudyBoardCell[]) : [],
    rack: Array.isArray(row.rack) ? (row.rack as string[]) : [],
    oppRackCount: Number(row.opp_rack_count),
    bagCount: Number(row.bag_count),
    level: row.level,
    summary: row.summary ?? "",
    method: (row.method as StudyMethod | null) ?? null,
    candidates: Array.isArray(row.candidates) ? (row.candidates as AnalysisCandidate[]) : [],
  };
}

/** Every position this account has had analysed, newest first. RLS scopes it to
 *  the caller; there is no shared or public study archive. */
export async function listStudyRecords(limit = 50): Promise<StudyRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("study_positions")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw friendly(error.message);
  return ((data ?? []) as StudyRow[]).map(toRecord);
}

export async function getStudyRecord(id: string): Promise<StudyRecord | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("study_positions")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw friendly(error.message);
  return data ? toRecord(data as StudyRow) : null;
}

export async function deleteStudyRecord(id: string): Promise<void> {
  if (!supabase) throw new Error("Sign in to manage study positions.");
  const { error } = await supabase.from("study_positions").delete().eq("id", id);
  if (error) throw friendly(error.message);
}
