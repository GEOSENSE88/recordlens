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

  // 부품 나사와 구분할 수 없어 한글 `나사`는 잡지 않는다. 영문 NASA 는 계속 잡는다.
  const screw = inspectRecordText("시의 구조를 나사 를 조이는 세 번의 도전으로 재구성함.");
  assert.equal(screw.some((issue) => issue.type === "institution"), false);
  const nasa = inspectRecordText("NASA 의 화성 탐사 자료를 분석함.");
  assert.equal(nasa.some((issue) => issue.type === "institution"), true);
});

test("no longer flags instructor names at all", () => {
  // 외부 강사 실명이 남는 사례 자체가 드물고 오탐 부담이 커서 항목을 뺐다.
  const issues = inspectRecordText("김민수 강사의 특강을 듣고 박지훈 교수의 논평을 정리함.");
  assert.equal(issues.length, 0);
});

test("treats quoted words as work titles and exempts them", () => {
  // 따옴표 안은 대부분 책·작품 제목이다.
  for (const text of [
    "'멋진 신세계'를 읽고 유전 공학의 윤리를 토론함.",
    "“멋진 신세계”를 읽고 과학 기술의 양면성을 토론함.",
    "『멋진 신세계』와 「1984」를 비교하며 감상문을 작성함.",
    "《멋진 신세계》 속 통제 사회를 분석함.",
    "'자격증의 시대'라는 칼럼을 읽고 능력주의를 비판적으로 검토함.",
  ]) {
    const issues = inspectRecordText(text);
    assert.equal(
      issues.some((issue) => issue.type === "business" || issue.type === "prohibited"),
      false,
      text + " 에서 제목 속 낱말을 지적했습니다.",
    );
  }
  // 따옴표 밖이면 계속 잡는다.
  const outside = inspectRecordText("신세계 그룹의 유통 전략을 조사하고 자격증 취득 계획을 세움.");
  assert.equal(outside.some((issue) => issue.type === "business"), true);
  assert.equal(outside.some((issue) => issue.type === "prohibited"), true);
});

test("covers the school-specific checklist rules", () => {
  // ① 학교 추측 표현: 인근 학교 약칭은 잡고, 다산 정약용·산동성은 통과
  const hint = inspectRecordText("다산 학생들과 연합 활동을 진행함.");
  assert.equal(hint.some((issue) => issue.label === "학교 추측"), true);
  const exempt = inspectRecordText("다산 정약용의 목민심서를 읽고 중국 산동성의 지리를 조사함.");
  assert.equal(exempt.some((issue) => issue.label === "학교 추측"), false);

  // ② 기재 불가 약어: ODA, 아마존 협력 조약기구. ESG 는 흔한 표현이라 잡지 않는다.
  const acronyms = inspectRecordText("ESG 경영과 ODA 정책, 아마존 협력 조약기구의 역할을 조사함.")
    .filter((issue) => issue.type === "institution")
    .map((issue) => issue.match);
  for (const name of ["ODA", "아마존 협력 조약기구"]) {
    assert.equal(acronyms.includes(name), true, name + " 를 잡지 못했습니다.");
  }
  assert.equal(acronyms.includes("ESG"), false);

  // ④ 헌혈 기관명: 지정 표기가 없으면 확인, 있으면 통과
  const donation = inspectRecordText("헌혈 봉사에 참여하여 생명 나눔을 실천함.");
  assert.equal(donation.some((issue) => issue.label === "헌혈 기관명"), true);
  const properDonation = inspectRecordText("(학교)대한적십자사 충북혈액원에서 헌혈 봉사에 참여함.");
  assert.equal(properDonation.some((issue) => issue.label === "헌혈 기관명"), false);

  // ⑦ 해외 활동 확장: 해외 연수·캠프
  assert.equal(
    inspectRecordText("해외 연수 프로그램에 참가한 경험을 나눔.").some(
      (issue) => issue.label === "해외 활동",
    ),
    true,
  );

  // ⑧ 논문 등재는 잡고, 문헌 조사의 학회지 언급은 통과
  assert.equal(
    inspectRecordText("논문 게재 사실을 소개함.").some((issue) => issue.label === "논문 등재"),
    true,
  );
  assert.equal(
    inspectRecordText("학회지, 언론 보도 등 다양한 문헌을 조사함.").some(
      (issue) => issue.label === "논문 등재",
    ),
    false,
  );

  // ⑩ 굽은따옴표 모양
  const curly = inspectRecordText("‘창의 융합’ 프로젝트에서 “관용”을 탐구함.");
  assert.equal(curly.some((issue) => issue.label === "따옴표 모양"), true);
  const straight = inspectRecordText("'창의 융합' 프로젝트에서 \"관용\"을 탐구함.");
  assert.equal(straight.some((issue) => issue.label === "따옴표 모양"), false);
});

test("validates officer period dates", () => {
  const officer = (text) =>
    inspectRecordText(text).filter((issue) => issue.label === "임원 기간");

  // 올바른 표기는 통과
  assert.equal(officer("(2026.03.01.-2026.08.31.) 학급 회장으로서 학급 회의를 이끎.").length, 0);
  assert.equal(officer("전교 학생자치회 부회장(2026.03.01.~2026.08.10.)으로 봉사함.").length, 0);

  // 달력에 없는 날짜
  assert.equal(officer("(2026.02.30.-2026.08.31.) 학급 임원으로 활동함.").length, 1);
  // 시작이 끝보다 늦음
  assert.equal(officer("(2026.08.31.-2026.03.01.) 학급 임원으로 활동함.").length, 1);
  // 학생자치회인데 8.31.까지로 적음
  assert.equal(officer("학생자치회 부회장(2026.03.01.~2026.08.31.)으로 봉사함.").length, 1);
  // 학급 임원인데 8.10.까지로 적음
  assert.equal(officer("(2026.03.01.-2026.08.10.) 학급 회장으로 활동함.").length, 1);

  // 학년-연도 정합: 1학년 2024면 3학년은 2026이어야 한다
  const mismatch = officer(
    "1학년 (2024.03.01.-2024.08.31.) 학급 회장, 2학년 (2025.03.01.-2025.08.31.) 학급 부회장, " +
      "3학년 (2025.03.01.-2025.08.31.) 학급 회장으로 활동함.",
  );
  assert.equal(mismatch.length, 1, "년도 오류를 잡지 못했습니다.");
  assert.equal(mismatch[0].guidance.includes("3학년"), true);

  // 학급 임원은 실장으로, 자치회 임원은 부장·차장으로도 표기된다
  assert.equal(officer("1학기 실장(2026.03.01.-2026.08.10.)으로 학급을 이끎.").length, 1);
  assert.equal(officer("전교 학생자치회 홍보부 차장(2026.03.01.~2026.08.31.)으로 활동함.").length, 1);
  assert.equal(officer("1학기 실장(2026.03.01.-2026.08.31.)으로 학급을 이끎.").length, 0);

  // 임원과 무관한 기간(수행 기간 등)은 건드리지 않는다
  assert.equal(officer("프로젝트 기간(2026.03.01.-2026.05.31.) 동안 자료를 수집함.").length, 0);
  // 동아리 회장 임기는 대상이 아니다
  assert.equal(officer("동아리 회장(2026.03.01.-2026.12.31.)으로 활동함.").length, 0);
});

test("no longer flags journal or thesis wording at all", () => {
  // 학회지·논문은 문헌 조사 서술에 정상적으로 나오는 말이라 항목을 뺐다.
  const issues = inspectRecordText(
    "핵심 개념을 병원 홈페이지, 학회지, 언론 보도 등 다양한 문헌을 통해 조사하고 관련 논문을 참고함.",
  );
  assert.equal(issues.some((issue) => issue.label === "논문·학회"), false);
});

test("no longer flags parental status wording at all", () => {
  // 사회 탐구에서 부모의 소득·학력을 연구 주제로 다루는 서술이 흔해 항목을 뺐다.
  const issues = inspectRecordText(
    "부모의 경제적 상황이 자녀 세대의 빈곤에 미치는 영향을 조건부확률로 탐구하고 부모의 학력과 소득을 반영한 확장을 계획함.",
  );
  assert.equal(issues.some((issue) => issue.label === "부모 지위"), false);
});

test("keeps bare mock-exam mentions but flags their scores", () => {
  // 모의고사는 과목 표기·문제 풀이 서술에 흔히 나오므로 단순 언급은 잡지 않는다.
  for (const text of [
    "모의고사 기출 문항을 변형하여 탐구함.",
    "전국연합학력평가 문항을 분석하고 풀이 전략을 발표함.",
    // 백분위는 통계 탐구에서 정상적으로 쓰인다.
    "설문 결과를 백분위로 환산하여 분포를 비교함.",
  ]) {
    assert.equal(
      inspectRecordText(text).some((issue) => issue.label === "시험·성적"),
      false,
      text + " 를 단순 언급인데 잡았습니다.",
    );
  }
  // 성적과 함께 나오면 계속 잡는다.
  for (const text of [
    "모의고사 성적이 크게 향상됨.",
    "모의고사에서 높은 등급을 받음.",
    "석차 3등을 기록함.",
  ]) {
    assert.equal(
      inspectRecordText(text).some((issue) => issue.label === "시험·성적"),
      true,
      text + " 에서 시험·성적 지적이 사라졌습니다.",
    );
  }
});

test("flags quote lookalikes that sneak in from word processors", () => {
  const issues = inspectRecordText("｀꿈과 끼｀를 주제로 발표하고 ´성실´이라는 단어를 탐구함.");
  const marks = issues.filter((issue) => issue.label === "따옴표 오입력").map((issue) => issue.match);
  assert.equal(marks.includes("｀"), true, "전각 억음 부호를 잡지 못했습니다.");
  assert.equal(marks.includes("´"), true, "양음 부호를 잡지 못했습니다.");

  const normal = inspectRecordText("'꿈과 끼'를 주제로 \"성실\"이라는 단어를 탐구함.");
  assert.equal(normal.some((issue) => issue.label === "따옴표 오입력"), false);
});

test("reports unmatched quotes and brackets at the right spot", () => {
  const text = "‘창의적 사고에 대해 탐구함. 자료 조사(문헌 검토를 진행함.";
  const issues = inspectRecordText(text).filter((issue) => issue.label === "짝 안 맞는 부호");
  const marks = issues.map((issue) => issue.match);
  assert.equal(marks.includes("‘"), true, "닫히지 않은 작은따옴표를 잡지 못했습니다.");
  assert.equal(marks.includes("("), true, "닫히지 않은 소괄호를 잡지 못했습니다.");
  for (const issue of issues) {
    assert.equal(text[issue.index], issue.match, "짝 없는 부호의 위치가 원문과 어긋납니다.");
  }

  const odd = inspectRecordText('"성실"이라는 단어와 "꾸준함을 이어서 조사함.');
  assert.equal(
    odd.some((issue) => issue.label === "짝 안 맞는 부호" && issue.match === '"'),
    true,
    "홀수 개 곧은따옴표를 잡지 못했습니다.",
  );

  const balanced = inspectRecordText("‘창의 융합’ 프로젝트(3월)에서 「문화 상대주의」와 \"관용\"을 탐구함.");
  assert.equal(balanced.some((issue) => issue.label === "짝 안 맞는 부호"), false);
});

test("leaves scientific prime notation and chemistry terms alone", () => {
  // RNA 5' 말단, 2'-O-methyl 같은 프라임 표기는 따옴표가 아니다.
  for (const text of [
    "mRNA의 5' 말단과 3' 방향의 구조를 비교하여 설명함.",
    "2'-O-methyl 치환기 도입이 안정성에 미치는 영향을 분석함.",
    "각도 35°12′ 지점의 태양 고도를 계산함.",
  ]) {
    const issues = inspectRecordText(text);
    assert.equal(
      issues.some((issue) => issue.label === "짝 안 맞는 부호" || issue.label === "따옴표 오입력"),
      false,
      text + " 에서 과학 표기를 따옴표로 오인했습니다.",
    );
  }
  // 쌍극자 쌍극자 힘은 화학 용어다.
  const chemistry = inspectRecordText("분자 사이의 쌍극자 쌍극자 힘과 분산력을 비교함.");
  assert.equal(chemistry.some((issue) => issue.label === "단어 반복"), false);
});

test("pairs a spaced closing quote instead of flagging both quotes", () => {
  // 닫는 따옴표 앞에 공백을 두는 표기(`유리할까? '라는`)는 짝으로 인정한다.
  const spacedClose = inspectRecordText(
    "에세이 작성에서 더 나아가 '수도권의 교육 환경이 진로 선택에 더 유리할까? '라는 질문을 제시하고 의견을 나눔.",
  );
  assert.equal(spacedClose.some((issue) => issue.label === "짝 안 맞는 부호"), false);
});

test("points at the quote that actually lacks its pair", () => {
  // 실제 사례: 세 쌍은 멀쩡하고 `통제'라는` 앞의 여는 따옴표만 빠졌다.
  // 마지막 따옴표가 아니라 짝이 없는 바로 그 자리를 짚어야 한다.
  const text =
    "'give their consciences a rest'라는 표현을 파고들고, 통제'라는 핵심 주제를 짚고, " +
    "'대부분의 사람은 인공지능을 편리함으로만 바라본다'는 통찰을 더하며 '책에게 반성할 기회를 준다 ' 는 의도를 설명함.";
  const issues = inspectRecordText(text).filter(
    (issue) => issue.label === "짝 안 맞는 부호" && issue.match === "'",
  );
  assert.equal(issues.length, 1, "짝 없는 따옴표는 정확히 한 건이어야 합니다.");
  assert.equal(issues[0].index, text.indexOf("통제'") + 2, "짝 없는 자리를 짚지 못했습니다.");

  // 닫는 따옴표 앞에 공백이 있어도(`준다 ' 는`) 짝이 맞으면 지적하지 않는다.
  const spaced = inspectRecordText("'책에게 반성할 기회를 준다 ' 는 의도를 명확하게 설명함.");
  assert.equal(spaced.some((issue) => issue.label === "짝 안 맞는 부호"), false);
});

test("catches the newly added common misspellings", () => {
  const wrong = ["몇일 동안 관찰함.", "자료의 갯수를 정리함.", "논의의 촛점을 맞춤.", "오랫만에 실험을 재개함.", "곰곰히 생각하여 결론을 냄."];
  for (const text of wrong) {
    assert.equal(
      inspectRecordText(text).some((issue) => issue.label === "맞춤법 의심"),
      true,
      text + " 에서 맞춤법 의심을 잡지 못했습니다.",
    );
  }
  const fine = inspectRecordText("며칠 동안 개수를 세어 초점을 맞추고 오랜만에 곰곰이 생각함.");
  assert.equal(fine.some((issue) => issue.label === "맞춤법 의심"), false);

  // 어근+조사 오류: 해박과 지식 → 해박한 지식. 해박함과(명사형+과)는 정상이다.
  const rootParticle = inspectRecordText("해박과 지식과 탐구열이 돋보이는 학생임.");
  assert.equal(rootParticle.some((issue) => issue.label === "맞춤법 의심"), true);
  const nominal = inspectRecordText("지식의 해박함과 탐구열이 돋보이는 학생임.");
  assert.equal(nominal.some((issue) => issue.label === "맞춤법 의심"), false);
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
