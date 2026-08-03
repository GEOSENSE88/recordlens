import assert from "node:assert/strict";
import test from "node:test";

import {
  PDF_LINE_RULES,
  classFromFileName,
  joinWrappedLines,
  readStudentHeader,
} from "../app/pdf-records.ts";

test("drops the footer watermark that every page carries", () => {
  assert.equal(
    PDF_LINE_RULES.isWatermark("산남고등학교/2026.02.13 14:26/172.18.***.116/홍길동"),
    true,
  );
  // 본문에 날짜가 나온다고 워터마크로 보면 안 된다.
  assert.equal(PDF_LINE_RULES.isWatermark("2024.07.15. 교과 융합 수업에 참여함."), false);
});

test("recognises the repeated subject table header and the end of the section", () => {
  assert.equal(PDF_LINE_RULES.isSubjectTableHeader("과 목 세부능력 및 특기사항"), true);
  assert.equal(PDF_LINE_RULES.isSubjectTableHeader("과목세부능력및특기사항"), true);
  assert.equal(PDF_LINE_RULES.isSubjectTableHeader("수학: 복소수를 탐구함."), false);

  assert.equal(PDF_LINE_RULES.isSectionEnd("독서활동상황"), true);
  assert.equal(PDF_LINE_RULES.isSectionEnd("행동특성 및 종합의견"), true);
  assert.equal(PDF_LINE_RULES.isSectionEnd("영어: 독서 활동을 꾸준히 함."), false);

  assert.equal(PDF_LINE_RULES.isPersonalSection("1. 인적·학적사항"), true);
});

test("keeps the space that follows a sentence mark when a line wraps", () => {
  // 양쪽 정렬 탓에 줄 끝 공백은 사라진다. 마침표 뒤에서만 되살린다.
  assert.equal(
    joinWrappedLines(["자료를 조사하여 발표함.", "이어서 토론을 진행함."]),
    "자료를 조사하여 발표함. 이어서 토론을 진행함.",
  );
  // 낱말 중간에서 끊긴 줄은 붙여야 원래 낱말이 된다.
  assert.equal(joinWrappedLines(["교류 전류 분", "석과 전력 손실"]), "교류 전류 분석과 전력 손실");
  assert.equal(joinWrappedLines(["쉼표로 끝난 줄,", "다음 줄"]), "쉼표로 끝난 줄, 다음 줄");
});

test("reads the student name from the personal section", () => {
  const header = readStudentHeader([
    "학년 반 번호 담임성명",
    "1 3 1 김담임",
    "2 1 2 박담임",
    "1. 인적·학적사항",
    "성명 : 홍길동 성별 : 남 주민등록번호 : 000000-0000000",
  ]);
  assert.equal(header.name, "홍길동");
  // 학적 표는 마지막 행이 가장 최근 학년이다.
  assert.equal(header.grade, "2학년");
  assert.equal(header.className, "2학년 1반");
  assert.equal(header.number, "2");
});

test("falls back to the class written in the file name", () => {
  assert.deepEqual(classFromFileName("3학년 1반 생기부.pdf"), {
    grade: "3학년",
    className: "3학년 1반",
  });
  assert.deepEqual(classFromFileName("3학년 12반 생활기록부.pdf"), {
    grade: "3학년",
    className: "3학년 12반",
  });
  assert.deepEqual(classFromFileName("생기부.pdf"), { grade: "", className: "" });
});
