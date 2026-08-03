import assert from "node:assert/strict";
import test from "node:test";

import { inspectRecordText } from "../app/record-inspection.ts";

test("flags representative 2026 student-record review candidates", () => {
  const issues = inspectRecordText(
    "TOEIC 성적을 취득함.서울대학교 연구원과 스타벅스를 조사함. ★ 역할 역할 활동함.",
  );
  const types = new Set(issues.map((issue) => issue.type));

  assert.equal(types.has("prohibited"), true);
  assert.equal(types.has("institution"), true);
  assert.equal(types.has("business"), true);
  assert.equal(types.has("symbol"), true);
  assert.equal(types.has("typo"), true);
});

test("does not treat a listed education authority exception as an institution warning", () => {
  const issues = inspectRecordText("국사편찬위원회 자료를 활용하여 역사 주제를 탐구함.");
  assert.equal(issues.some((issue) => issue.type === "institution"), false);
});

test("uses concrete proper names instead of broad generic institution and business words", () => {
  const generic = inspectRecordText(
    "현대 사회의 기업 활동과 정신병원 제도를 조사하고 모바일 애플리케이션을 개발함.",
  );
  assert.equal(generic.some((issue) => issue.type === "institution"), false);
  assert.equal(generic.some((issue) => issue.type === "business"), false);

  const concrete = inspectRecordText(
    "한국과학기술원 자료와 나이키, 애플 사례를 비교하고 KBS 방송국을 견학함.",
  );
  const matches = concrete
    .filter((issue) => issue.type === "institution" || issue.type === "business")
    .map((issue) => issue.match);
  assert.equal(matches.includes("한국과학기술원"), true);
  assert.equal(matches.includes("나이키"), true);
  assert.equal(matches.includes("애플"), true);
  assert.equal(matches.includes("KBS 방송국") || matches.includes("KBS"), true);
});

test("reports the exact source span so highlighting is not shifted", () => {
  const text = "학생은 매우 매우 성실하게 참여함.";
  for (const issue of inspectRecordText(text)) {
    assert.equal(
      text.slice(issue.index, issue.index + issue.match.length),
      issue.match,
      `${issue.label} 지적 위치가 원문과 어긋납니다.`,
    );
  }
  assert.equal(
    inspectRecordText(text).some((issue) => issue.match === "매우 매우"),
    true,
  );
});

test("keeps award wording out of unrelated compounds", () => {
  assert.equal(
    inspectRecordText("결과가 우수상태로 유지됨.").some((issue) => issue.type === "prohibited"),
    false,
  );
  for (const text of ["교내 대회에서 우수상을 받음.", "우수상 수상 사실을 기록함."]) {
    assert.equal(
      inspectRecordText(text).some((issue) => issue.type === "prohibited"),
      true,
      `${text} 에서 대회·수상 지적이 사라졌습니다.`,
    );
  }
});

test("never drops a prohibited-word finding behind a wall of symbols", () => {
  const noisy = `${Array.from({ length: 40 }, (_, index) => `★${index}`).join(" ")} 토익 점수를 취득함.`;
  const issues = inspectRecordText(noisy);
  assert.equal(
    issues.some((issue) => issue.type === "prohibited"),
    true,
  );
  assert.equal(
    issues.filter((issue) => issue.type === "symbol").length <= 10,
    true,
  );
});
