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

test("does not append the same content twice across a page break", () => {
  // 나이스는 쪽이 바뀌면 학생 행을 다시 내려준다. 앞서 나눠 받은 내용과 공백만
  // 다른 전체 본문이 다시 와도 이어 붙이지 않아야 한다.
  const pageBreak = [
    ["3학년 1반 학교생활기록부 창의적체험활동상황"],
    ["번호", "성명", "학년", "창의적체험활동"],
    ["", "", "", "영역", "시간", "특기사항"],
    ["5", "가학생", "3", "진로활동", "0", "직업병 소송에 서 노동자와 기업 간 정보의"],
    ["", "", "", "", "", "격차에 주목하여 논제를 설정함."],
    ["", "", "", "", "", "23", "", "/", "38", "", "산남고등학교"],
    ["번호", "성명", "학년", "창의적체험활동"],
    ["", "", "", "영역", "시간", "특기사항"],
    [
      "5",
      "가학생",
      "3",
      "진로활동",
      "0",
      "직업병 소송에서 노동자와 기업 간 정보의 격차에 주목하여 논제를 설정함.",
    ],
  ];
  const records = parseCreativeActivityRows(pageBreak);
  assert.equal(records.length, 1);
  const occurrences = records[0].text.split("직업병 소송").length - 1;
  assert.equal(occurrences, 1, "같은 내용이 두 번 이어 붙었습니다: " + records[0].text);
});

test("survives empty and short rows in the sheet", () => {
  const ragged = [
    ["3학년 1반 학교생활기록부 창의적체험활동상황"],
    [],
    ["번호"],
    ["1", "가학생", "1", "자율활동", "10", "학급 활동에 성실히 참여함."],
    [],
  ];

  assert.equal(isCreativeActivityExport(ragged), true);
  const records = parseCreativeActivityRows(ragged);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "가학생");
});
