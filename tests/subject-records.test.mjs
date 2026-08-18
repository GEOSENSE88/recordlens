import assert from "node:assert/strict";
import test from "node:test";

import {
  isSubjectCandidate,
  splitSubjectSegments,
  subjectNamesFromTexts,
} from "../app/subject-records.ts";

// 실제 NEIS 파일의 표기를 그대로 옮긴 것. 로마숫자는 유니코드 Ⅰ(U+2160)이고
// 과목 사이 마침표 뒤에 공백이 없다.
const NEIS_CELL =
  "문학: 작품 속 인물의 선택을 근거로 주제를 설명하고 지속적인 학문적 성장 가능성이 큼." +
  "수학Ⅰ: 피보나치 수열의 일반항과 주가 예측이라는 주제로 탐구 활동을 함." +
  "수학Ⅱ: 로렌츠 곡선과 지니계수를 심화 탐구함." +
  "모의고사: 문항을 좌·우극한 비교로 분해한 뒤 조건을 재구성함." +
  "영어Ⅰ: 팜유 지문을 읽고 환경 문제에 관심을 갖게 됨.";

test("splits a NEIS cell that packs several subjects together", () => {
  const subjects = subjectNamesFromTexts([NEIS_CELL]);
  const { leading, segments } = splitSubjectSegments(NEIS_CELL, subjects);

  assert.equal(leading, "");
  assert.deepEqual(
    segments.map((segment) => segment.subject),
    ["문학", "수학Ⅰ", "수학Ⅱ", "모의고사", "영어Ⅰ"],
  );
  assert.match(segments[1].body, /피보나치/);
  assert.doesNotMatch(segments[1].body, /로렌츠/);
});

test("recognises unicode roman numerals in subject names", () => {
  const names = subjectNamesFromTexts([NEIS_CELL]);
  for (const subject of ["수학Ⅰ", "수학Ⅱ", "영어Ⅰ"]) {
    assert.equal(names.includes(subject), true, `${subject} 를 과목으로 찾지 못했습니다.`);
  }
});

test("does not need a space after the sentence period", () => {
  const withSpace = "국어: 토론을 진행함. 수학: 수열을 탐구함.";
  const withoutSpace = "국어: 토론을 진행함.수학: 수열을 탐구함.";
  for (const text of [withSpace, withoutSpace]) {
    const segments = splitSubjectSegments(text, subjectNamesFromTexts([text])).segments;
    assert.deepEqual(
      segments.map((s) => s.subject),
      ["국어", "수학"],
      `${JSON.stringify(text)} 분할 실패`,
    );
  }
});

test("prefers the longer subject name so 수학Ⅰ is not cut down to 수학", () => {
  const text = "수학Ⅰ: 수열을 탐구함.";
  const { segments } = splitSubjectSegments(text, ["수학", "수학Ⅰ"]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].subject, "수학Ⅰ");
});

test("keeps prose fragments out of the subject list", () => {
  assert.equal(isSubjectCandidate("배드민턴 개인 리그전 1"), false);
  assert.equal(isSubjectCandidate("2024학년도"), false);
  assert.equal(isSubjectCandidate("모둠에서"), false);
  assert.equal(isSubjectCandidate("수학Ⅰ"), true);
  assert.equal(isSubjectCandidate("확률과 통계"), true);
});

test("returns the whole cell as leading text when no subject is found", () => {
  const text = "특별한 과목 표기 없이 이어지는 서술입니다.";
  const { leading, segments } = splitSubjectSegments(text, ["국어", "수학"]);
  assert.equal(segments.length, 0);
  assert.equal(leading, text);
});

test("separates the unlabelled 개인별 세특 block from the previous subject", () => {
  // 개인별 세특은 과목 이름 없이 앞 과목 뒤에 그대로 이어 붙는다.
  const text =
    "진로와 직업: 반려동물에 대한 관심을 바탕으로 관련 직업을 조사하고 발표함. " +
    "자신의 진로와 역할을 성실히 모색하는 모습을 보여줌." +
    "수업량 유연화에 따른 진로 연계 교과융합 수업(2024.07.15.-2024.07.17.)에 참여하여 조별 탐구 활동을 실시함.";

  const subjects = subjectNamesFromTexts([text]);
  const { segments } = splitSubjectSegments(text, subjects);

  assert.deepEqual(
    segments.map((segment) => segment.subject),
    ["진로와 직업", "개인별 세특"],
  );
  assert.match(segments[0].body, /반려동물/);
  assert.doesNotMatch(segments[0].body, /수업량 유연화/);
  assert.match(segments[1].body, /수업량 유연화/);
});

test("does not split the 개인별 세특 block again on a repeated marker", () => {
  const text =
    "국어: 토론을 진행함." +
    "교과 융합 수업 탐구활동에서 주제를 정함. 이어진 교과 융합 수업에서 결과를 발표함.";
  const { segments } = splitSubjectSegments(text, subjectNamesFromTexts([text]));
  assert.deepEqual(
    segments.map((segment) => segment.subject),
    ["국어", "개인별 세특"],
  );
  assert.match(segments[1].body, /결과를 발표함/);
});

test("splits subjects even when spacing differs from the list", () => {
  // PDF는 줄바꿈에서 공백이 사라져 `국제 관계와국제기구:` 같은 변형이 생긴다.
  const text =
    "세계 문제와 미래 사회: 세계문제 토론 활동에서 종자산업을 분석함." +
    "국제 관계와국제기구: 국제기구의 행정적 접근을 재해석함.";
  const { segments } = splitSubjectSegments(text, subjectNamesFromTexts([text]));
  assert.deepEqual(
    segments.map((segment) => segment.subject),
    ["세계 문제와 미래 사회", "국제 관계와국제기구"],
  );
});

test("recognises single-student minority subjects from the built-in list", () => {
  // 한 명만 듣는 과목은 등장 횟수 기준(2회)에 못 미치므로 목록에 미리 들어 있어야 한다.
  const text = "문학: 작품을 분석함.국제법: 국제 분쟁 사례를 조사함.재배: 작물 재배 실습에 참여함.";
  const { segments } = splitSubjectSegments(text, subjectNamesFromTexts([text]));
  assert.deepEqual(
    segments.map((segment) => segment.subject),
    ["문학", "국제법", "재배"],
  );
});

test("catches the newer 개인별 세특 opening phrases", () => {
  for (const opener of [
    "교과융합탐구 프로그램 '배움 너머'에서 항암 치료를 탐구함.",
    "교과 융합 탐구 활동에서 주제를 정함.",
    "융합수업 탐구활동에서 자료를 수합함.",
    // 문장 끝에 ` . `처럼 마침표 앞 공백이 있어도 나뉘어야 한다.
    " 학교 간 융합 논증 역량 강화 심화 탐구 프로그램에 참여하여 차세대 소재를 탐구함.",
  ]) {
    const text = "영어 독해와 작문: 영시를 감상하고 협력적으로 소통함." + opener;
    const { segments } = splitSubjectSegments(text, subjectNamesFromTexts([text]));
    assert.deepEqual(
      segments.map((segment) => segment.subject),
      ["영어 독해와 작문", "개인별 세특"],
      opener.slice(0, 16) + "… 를 개인별 세특으로 나누지 못했습니다.",
    );
  }
});
