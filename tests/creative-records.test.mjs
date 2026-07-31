import assert from "node:assert/strict";
import test from "node:test";

import {
  isCreativeActivityExport,
  parseCreativeActivityRows,
} from "../app/creative-records.ts";

const rows = [
  ["3학년 1반 학교생활기록부 창의적체험활동상황"],
  ["번호", "성명", "학년", "창의적체험활동"],
  ["", "", "", "영역", "시간", "특기사항"],
  ["1", "가학생", "1", "자율활동", "10", "학급 활동에 성실히 참여함."],
  ["", "", "", "", "", "친구들과 협력하여 과제를 완수함."],
  ["", "", "", "동아리활동", "20", "과학 동아리에서 탐구함."],
  ["", "", "2", "진로활동", "12", "희망 진로를 조사하여 발표함."],
  ["", "", "", "", "", "희망분야", "심리학"],
  ["", "", "", "", "", "0"],
  ["", "", "", "", "", "", "", "/"],
];

test("detects and parses a NEIS creative activity export", () => {
  assert.equal(isCreativeActivityExport(rows), true);

  const records = parseCreativeActivityRows(rows);
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map(({ name, grade, activity }) => ({ name, grade, activity })),
    [
      { name: "가학생", grade: "1학년", activity: "자율활동" },
      { name: "가학생", grade: "1학년", activity: "동아리활동" },
      { name: "가학생", grade: "2학년", activity: "진로활동" },
    ],
  );
  assert.match(records[0].text, /성실히 참여함.*협력하여 과제를 완수함/);
  assert.equal(records.some((record) => record.text.includes("희망분야")), false);
  assert.equal(records.some((record) => record.text === "0"), false);
});
