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
