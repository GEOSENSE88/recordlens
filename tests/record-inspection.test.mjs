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
