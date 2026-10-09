import test from "node:test";
import assert from "node:assert/strict";
import { validateEvaluation, gradeFromScore, DEFAULT_GRADE_THRESHOLDS } from "../config-utils.mjs";

test("T2-V1: validateEvaluation overrides model grade with code-derived grade", () => {
  // Model supplied grade "C" but score is 8.0 -> must be "A"
  const eval1 = validateEvaluation({ score: 8.0, grade: "C" }, { hasDescription: true });
  assert.strictEqual(eval1.grade, "A", "Score 8.0 must derive Grade A regardless of model grade");
  assert.strictEqual(eval1.score, 8.0);
  assert.strictEqual(eval1.verdict, "Apply Now");

  // Score 6.4 -> must be "C"
  const eval2 = validateEvaluation({ score: 6.4, grade: "A" }, { hasDescription: true });
  assert.strictEqual(eval2.grade, "C", "Score 6.4 must derive Grade C");
  assert.strictEqual(eval2.score, 6.4);

  // Score "abc" -> defined default and not a crash
  const eval3 = validateEvaluation({ score: "abc" }, { hasDescription: true });
  assert.strictEqual(eval3.grade, "C", "Invalid score 'abc' must default cleanly to Grade C");
  assert.strictEqual(eval3.score, 5.0);
});

test("T2-V1: gradeFromScore thresholds", () => {
  assert.strictEqual(gradeFromScore(9.0), "A");
  assert.strictEqual(gradeFromScore(8.0), "A");
  assert.strictEqual(gradeFromScore(7.9), "B");
  assert.strictEqual(gradeFromScore(6.5), "B");
  assert.strictEqual(gradeFromScore(6.4), "C");
  assert.strictEqual(gradeFromScore(5.0), "C");
  assert.strictEqual(gradeFromScore(4.9), "D");
  assert.strictEqual(gradeFromScore(3.5), "D");
  assert.strictEqual(gradeFromScore(3.4), "F");
  assert.strictEqual(gradeFromScore(0), "F");
  assert.strictEqual(gradeFromScore(NaN), "C");
});

test("T2-V1: Missing JD caps score at 6.5 and records 'No job description available' in gaps", () => {
  const evalMissingJD = validateEvaluation(
    { score: 9.5, gaps: ["Needs React experience"] },
    { hasDescription: false }
  );

  assert.strictEqual(evalMissingJD.score, 6.5, "Missing JD must cap score at 6.5");
  assert.strictEqual(evalMissingJD.grade, "B", "Score 6.5 must map to Grade B");
  assert.ok(
    evalMissingJD.gaps.some((g) => g.toLowerCase().includes("no job description available")),
    "Gaps must include 'No job description available'"
  );
});
