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

test("ignores keyboard-typable punctuation but catches pasted symbols", () => {
  const typable = inspectRecordText("3~4월 프로젝트에서 A+ 등급을 받음. 왜? 좋았기 때문! 비용-편익 분석함.");
  assert.equal(
    typable.some((issue) => issue.type === "symbol"),
    false,
    "자판으로 칠 수 있는 기호는 특수문자로 보지 않습니다.",
  );

  const pasted = inspectRecordText("① 자료 조사 ② 분석 ★ 정리 → 발표 ※ 참고");
  const symbols = pasted.filter((issue) => issue.type === "symbol").map((issue) => issue.match);
  for (const mark of ["①", "②", "★", "→", "※"]) {
    assert.equal(symbols.includes(mark), true, `${mark} 를 특수문자로 잡지 못했습니다.`);
  }
});

test("finds the institutions teachers most often flag", () => {
  const found = inspectRecordText("통계청 자료를 인용하고 UN, WTO, WHO 보고서를 비교함.")
    .filter((issue) => issue.type === "institution")
    .map((issue) => issue.match);
  for (const name of ["통계청", "UN", "WTO", "WHO"]) {
    assert.equal(found.includes(name), true, `${name} 를 기관명으로 잡지 못했습니다.`);
  }
});

test("does not mistake common english words for institution acronyms", () => {
  const issues = inspectRecordText("'Who am I?'라는 질문을 던지고 who, un, it 을 분석함.");
  assert.equal(issues.some((issue) => issue.type === "institution"), false);
});

test("finds university short names and well known brands", () => {
  const schools = inspectRecordText("서울대 강연을 듣고 카이스트와 하버드 사례를 조사함.")
    .filter((issue) => issue.type === "institution")
    .map((issue) => issue.match);
  assert.deepEqual(schools, ["서울대", "카이스트", "하버드"]);

  const brands = inspectRecordText("애플, 삼성, 구글의 사업 모델을 비교함.")
    .filter((issue) => issue.type === "business")
    .map((issue) => issue.match);
  for (const brand of ["애플", "삼성", "구글"]) {
    assert.equal(brands.includes(brand), true, `${brand} 를 상호명으로 잡지 못했습니다.`);
  }
});

test("leaves brand-shaped common nouns alone", () => {
  const issues = inspectRecordText(
    "현대 사회의 기아 문제와 메타 인지 전략을 탐구하고 무럭무럭 자라 감.",
  );
  assert.equal(issues.some((issue) => issue.type === "business"), false);
  assert.equal(issues.some((issue) => issue.type === "institution"), false);
});

test("no longer flags instructor names at all", () => {
  // 외부 강사 실명이 남는 사례 자체가 드물고 오탐 부담이 커서 항목을 뺐다.
  const issues = inspectRecordText("김민수 강사의 특강을 듣고 박지훈 교수의 논평을 정리함.");
  assert.equal(issues.length, 0);
});

test("leaves education authorities and mere patent mentions alone", () => {
  // 교육부·교육청은 교육 관련 기관이라 세특에 정상적으로 나온다.
  const education = inspectRecordText("교육부 고시와 교육청 자료를 참고하여 탐구함.");
  assert.equal(education.some((issue) => issue.type === "institution"), false);
  // 다른 기관은 계속 잡혀야 한다.
  const still = inspectRecordText("통계청 자료를 인용함.");
  assert.equal(still.some((issue) => issue.type === "institution"), true);

  // 특허 단순 언급(제도·논쟁 탐구)은 지재권 실적이 아니다.
  const mention = inspectRecordText("종자 특허를 둘러싼 기업의 재산권 행사와 생명권의 충돌을 분석함.");
  assert.equal(mention.some((issue) => issue.label === "지식재산권"), false);
  // 출원·등록 사실은 계속 잡는다.
  for (const text of ["특허를 출원한 사실이 있음.", "특허 등록을 완료함.", "실용신안 출원을 진행함."]) {
    assert.equal(
      inspectRecordText(text).some((issue) => issue.label === "지식재산권"),
      true,
      text + " 를 잡지 못했습니다.",
    );
  }
});
