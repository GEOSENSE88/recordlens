/**
 * 교과 세부능력 및 특기사항 셀에서 과목 경계를 찾아내는 규칙.
 *
 * NEIS는 한 학생의 여러 과목 세특을 셀 하나에 `과목명: 내용` 형태로 이어 붙여 내려준다.
 * 이 경계를 놓치면 여러 과목이 한 기록으로 뭉쳐 유사도 비교와 과목별 통계가 모두 어긋난다.
 *
 * 실제 NEIS 파일에서 확인된 까다로운 점 두 가지
 *  - 과목명의 로마숫자가 아스키 `I`가 아니라 유니코드 `Ⅰ`(U+2160)이다.
 *  - 과목과 과목 사이 마침표 뒤에 공백이 없는 경우가 많다. (`…성장 가능성이 큼.수학Ⅰ: …`)
 */

export const KNOWN_SUBJECTS = new Set([
  "국어",
  "수학",
  "영어",
  "한국사",
  "통합사회",
  "통합과학",
  "과학탐구실험",
  "기술·가정",
  "정보",
  "진로와 직업",
  "독서",
  "문학",
  "체육",
  "음악",
  "미술",
  "운동과 건강",
  "식품안전과 건강",
  "고전 읽기",
  "생활과 윤리",
  "생활과 과학",
  "음악 감상과 비평",
  "영어권 문화",
  "정치와 법",
  "사회문제 탐구",
  "세계지리",
  "미술 창작",
  "세계 문제와 미래 사회",
  "세계사",
  "심화 국어",
  "경제",
  "기하",
  "심리학",
  "생태와 환경",
  "빅데이터 분석",
  "호텔외식조리실무",
  "생명과학 실험",
  "화학 실험",
  "마케팅과 광고",
  "생활과 한문",
  // 한 반에 한 명만 듣는 과목은 자동 탐지 기준(2회 이상)에 걸리지 않으므로 미리 등록해 둔다.
  "수학Ⅰ",
  "수학Ⅱ",
  "영어Ⅰ",
  "영어Ⅱ",
  "물리학Ⅰ",
  "물리학Ⅱ",
  "화학Ⅰ",
  "화학Ⅱ",
  "생명과학Ⅰ",
  "생명과학Ⅱ",
  "지구과학Ⅰ",
  "지구과학Ⅱ",
  "일본어Ⅰ",
  "일본어Ⅱ",
  "중국어Ⅰ",
  "중국어Ⅱ",
  "한문Ⅰ",
  "한문Ⅱ",
  "일본어 회화Ⅰ",
  "중국어 회화Ⅰ",
  "확률과 통계",
  "미적분",
  "영어 독해와 작문",
  "영어 회화",
  "언어와 매체",
  "화법과 작문",
  "동아시아사",
  "사회·문화",
  "윤리와 사상",
  "한국지리",
  "모의고사",
  // 소인수·공동교육과정·위탁교육 과목. 한 학교에 한 명만 듣는 경우가 많아
  // 자동 탐지 기준(2회 이상)에 걸리지 않으므로 미리 등록해 둔다.
  "국제 관계와 국제기구",
  "국제법",
  "국제 정치",
  "국제 경제",
  "세계지리",
  "여행지리",
  "수학과제 탐구",
  "생명윤리",
  "재배",
  "원예",
  "화훼 장식 기초",
  "농업 기초 기술",
  "창업 일반",
  "사무 관리",
  "전공 기초 프랑스어",
  "프랑스어Ⅰ",
  "프랑스어 회화Ⅰ",
  "독일어Ⅰ",
  "스페인어Ⅰ",
  "체육 전공 실기 기초",
  "체육 전공 실기 심화",
  "음악 전공 실기",
  "미술 전공 실기",
  "항공기 일반",
  "공학 일반",
  "지식 재산 일반",
  "인공지능 기초",
  "인공지능 수학",
  "융합과학",
  "과학사",
]);

/** 마침표 뒤 공백은 있어도 없어도 되고, 과목명에는 유니코드 로마숫자를 허용한다. */
const SUBJECT_CANDIDATE_EXPRESSION =
  /(?:^|[.!?]\s*|\([12]학기\)\s*)([가-힣A-Za-zⅠ-Ⅻ][가-힣A-Za-zⅠ-Ⅻ0-9· ]{0,24}?):\s*/gu;

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 본문 조각이 과목명으로 잘못 잡히는 것을 막는다. */
export function isSubjectCandidate(value: string) {
  if (!value) return false;
  if (/^\d/.test(value)) return false;
  if (/\d{3}/.test(value)) return false;
  // `배드민턴 개인 리그전 1:` 같은 문장 조각을 걸러낸다.
  if (/\s\d+$/.test(value)) return false;
  if (value.endsWith("에서")) return false;
  return true;
}

/** 띄어쓰기 차이를 무시하고 같은 이름으로 묶기 위한 열쇠. */
function spacelessKey(value: string) {
  return value.replace(/\s+/g, "");
}

const KNOWN_SUBJECT_KEYS = new Set([...KNOWN_SUBJECTS].map(spacelessKey));

/**
 * 세특 본문들을 훑어 이 파일에서 쓰인 과목 이름을 추린다.
 * 셀 맨 앞에 나왔거나 두 번 이상 등장한 이름만 과목으로 인정한다.
 *
 * 같은 과목이 `세계 문제와 미래 사회`, `세계문제와 미래사회`처럼 띄어쓰기만
 * 다르게 적히는 일이 잦다(PDF는 줄바꿈에서 공백이 사라지기도 한다).
 * 띄어쓰기를 무시한 열쇠로 함께 세어, 변형이 흩어져 기준(2회)에 못 미치는
 * 일이 없게 한다.
 */
export function subjectNamesFromTexts(texts: string[]) {
  const counts = new Map<string, number>();
  const atCellStart = new Set<string>();
  const displayName = new Map<string, string>();

  for (const text of texts) {
    SUBJECT_CANDIDATE_EXPRESSION.lastIndex = 0;
    for (const match of text.matchAll(SUBJECT_CANDIDATE_EXPRESSION)) {
      const candidate = collapse(match[1]);
      if (!isSubjectCandidate(candidate)) continue;
      const key = spacelessKey(candidate);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!displayName.has(key)) displayName.set(key, candidate);
      if (
        match.index === 0 ||
        /^\([12]학기\)\s*/.test(text) ||
        text.slice(0, match.index).trim() === ""
      ) {
        atCellStart.add(key);
      }
    }
  }

  const detected = [...counts.keys()]
    .filter(
      (key) =>
        !KNOWN_SUBJECT_KEYS.has(key) && (atCellStart.has(key) || (counts.get(key) ?? 0) >= 2),
    )
    .map((key) => displayName.get(key) ?? key);

  return [...KNOWN_SUBJECTS, ...detected].sort(
    (a, b) => spacelessKey(b).length - spacelessKey(a).length,
  );
}

export type SubjectSegment = {
  subject: string;
  body: string;
};

/** 과목명이 없는 개인별 세부능력 및 특기사항 구간에 붙일 이름. */
export const PERSONAL_RECORD_SUBJECT = "개인별 세특";

/**
 * 개인별 세특은 과목 이름 없이 앞 과목 뒤에 그대로 이어 붙는다.
 * NEIS가 경계를 표시해 주지 않으므로, 이 구간이 실제로 자주 시작하는 말로 자른다.
 * `자율 탐구`처럼 일반 서술에도 흔히 나오는 말은 넣지 않았다.
 *
 * 실제 파일에서 확인한 시작 표현
 *   수업량 유연화에 따른 … / 수업량 유연화 기간 …
 *   교과 융합 수업 탐구활동에서 … / 교과 융합수업 … / 교과융합탐구 프로그램 '배움 너머' …
 *   융합수업 탐구활동에서 …  (앞의 `교과`가 줄바꿈에서 떨어져 나간 모양)
 */
const PERSONAL_RECORD_EXPRESSION =
  /(?:^|[.!?]\s*)(수업량\s*유연화|학교\s*자율\s*과정|진로\s*연계\s*교과\s*융합|교과\s*융합\s*(?:수업|탐구)|융합\s*수업\s*탐구)/gu;

type Boundary = {
  /** 이 조각이 시작하는 위치. 앞 조각은 여기서 끝난다. */
  start: number;
  /** 실제 내용이 시작하는 위치. 과목명과 콜론은 건너뛴다. */
  contentStart: number;
  subject: string;
};

/**
 * 셀 하나를 과목별 조각으로 나눈다.
 * `leading`은 첫 과목 이름이 나오기 전의 내용으로, 직전 행의 과목에 이어 붙는다.
 */
export function splitSubjectSegments(
  text: string,
  subjects: string[],
): { leading: string; segments: SubjectSegment[] } {
  const boundaries: Boundary[] = [];

  if (subjects.length) {
    // 긴 이름을 먼저 시도해야 `수학Ⅰ`이 `수학`으로 잘리지 않는다.
    const ordered = [...subjects].sort(
      (left, right) => spacelessKey(right).length - spacelessKey(left).length,
    );
    // 글자 사이에 \s* 를 끼워, 본문의 띄어쓰기가 목록과 달라도 잘리게 한다.
    // (`국제 관계와국제기구:` 처럼 PDF 줄바꿈에서 공백이 사라진 경우까지 잡는다.)
    const flexible = ordered.map((name) =>
      spacelessKey(name).split("").map(escapeRegExp).join("\\s*"),
    );
    const expression = new RegExp(
      `(?:\\([12]학기\\)\\s*)?(${flexible.join("|")}):\\s*`,
      "gu",
    );
    for (const match of text.matchAll(expression)) {
      const start = match.index ?? 0;
      boundaries.push({
        start,
        contentStart: start + match[0].length,
        subject: collapse(match[1]),
      });
    }
  }

  PERSONAL_RECORD_EXPRESSION.lastIndex = 0;
  for (const match of text.matchAll(PERSONAL_RECORD_EXPRESSION)) {
    // 앞의 마침표와 공백은 빼고, 실제 문구가 시작하는 자리를 경계로 삼는다.
    const start = (match.index ?? 0) + (match[0].length - match[1].length);
    boundaries.push({ start, contentStart: start, subject: PERSONAL_RECORD_SUBJECT });
  }

  if (!boundaries.length) return { leading: text, segments: [] };

  boundaries.sort((left, right) => left.start - right.start);

  const kept: Boundary[] = [];
  for (const boundary of boundaries) {
    const previous = kept[kept.length - 1];
    // 과목 표기 안쪽에서 걸린 개인세특 표지는 버린다.
    if (previous && boundary.start < previous.contentStart) continue;
    // 개인세특 구간 안에서 같은 표지가 또 나와도 조각을 더 쪼개지 않는다.
    if (
      previous &&
      previous.subject === PERSONAL_RECORD_SUBJECT &&
      boundary.subject === PERSONAL_RECORD_SUBJECT
    ) {
      continue;
    }
    kept.push(boundary);
  }

  const leading = text.slice(0, kept[0].start).trim();
  const segments = kept.map((boundary, index) => ({
    subject: boundary.subject,
    body: text.slice(boundary.contentStart, kept[index + 1]?.start ?? text.length),
  }));

  return { leading, segments };
}
