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
  "교육학",
  "창의 경영",
  "고급 생명과학",
  "고급 화학",
  "고급 물리학",
  "데이터과학과 머신러닝",
]);

/**
 * 마침표 뒤 공백은 있어도 없어도 되고, 과목명에는 유니코드 로마숫자와
 * 괄호(`프로그래밍(PYTHON)`, 공동교육과정 표기)를 허용한다.
 */
const SUBJECT_CANDIDATE_EXPRESSION =
  /(?:^|[.!?]\s*|\([12]학기\)\s*)([가-힣A-Za-zⅠ-Ⅻ][가-힣A-Za-zⅠ-Ⅻ0-9·() ]{0,24}?):\s*/gu;

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 개요식 서술에 흔한 콜론 머리말. 과목명이 아니다. */
const PROSE_COLON_HEADS =
  /(?:주제|질문|논제|가설|예시|예|결론|참고|출처|목표|방법|결과|소감|내용|계획|순서|기준|다음|아래|비고)$/;

/** 본문 조각이 과목명으로 잘못 잡히는 것을 막는다. */
export function isSubjectCandidate(value: string) {
  if (!value) return false;
  if (/^\d/.test(value)) return false;
  if (/\d{3}/.test(value)) return false;
  // `배드민턴 개인 리그전 1:` 같은 문장 조각을 걸러낸다.
  if (/\s\d+$/.test(value)) return false;
  if (value.endsWith("에서")) return false;
  if (PROSE_COLON_HEADS.test(value.replace(/\s+/g, ""))) return false;
  // 괄호가 있다면 짝이 맞아야 한다.
  const opens = (value.match(/\(/g) ?? []).length;
  const closes = (value.match(/\)/g) ?? []).length;
  if (opens !== closes) return false;
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
 *   학교 간 융합 논증 역량 강화 심화 탐구 프로그램에 참여하여 …
 *   코로나19 당시 방호복을 입고 … / 코로나19 당시의 구조 활동에서 …
 *   (프로그램 표지 없이 시작하는 진로 연계 문헌 탐구. 원본 셀에 구분자가 없어
 *    시작 표현을 직접 등록하는 수밖에 없다.)
 */
const PERSONAL_MARKER_BODY =
  "수업량\\s*유연화|학교\\s*자율\\s*과정|진로\\s*연계\\s*교과\\s*융합|교과\\s*융합\\s*(?:수업|탐구)|융합\\s*수업\\s*탐구|학교\\s*간\\s*융합|코로나19\\s*당시|배움\\s*너머";
const PERSONAL_RECORD_EXPRESSION = new RegExp(`(?:^|[.!?]\\s*)(${PERSONAL_MARKER_BODY})`, "gu");
/** 문장 중간에 든 개인세특 표지(예: `…경험을 바탕으로 교과융합탐구 프로그램 배움너머에 참여하여…`). */
const PERSONAL_MARKER_ANYWHERE = new RegExp(PERSONAL_MARKER_BODY, "gu");

/** 나이스 입력 한도(1,500바이트) + 여유. 이보다 긴 과목 조각은 무언가 붙어 있다. */
const SEGMENT_BYTE_LIMIT = 1620;
const byteEncoder = new TextEncoder();

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

  return { leading, segments: splitOversizedSegments(segments) };
}

/**
 * 나이스 한도를 넘는 과목 조각에서 문장 중간의 개인세특 표지를 찾아 잘라낸다.
 *
 * 개인세특이 표지 문구로 문장을 시작하지 않고 `…경험을 바탕으로 교과융합탐구
 * 프로그램 배움너머에 참여하여…`처럼 첫 문장 중간에 표지가 드는 경우가 있다.
 * 문장 시작 표지만 보는 기본 분리로는 못 자르므로, 조각이 입력 한도(1,500바이트)를
 * 확실히 넘을 때에 한해 표지가 든 문장의 시작 지점에서 자른다.
 * 한도 초과는 나이스가 강제하는 규칙이라, 이 조건에서는 병합이 확실하다.
 */
function splitOversizedSegments(segments: SubjectSegment[]): SubjectSegment[] {
  const refined: SubjectSegment[] = [];
  for (const segment of segments) {
    // 여러 개가 붙은 경우도 있어(과목 + 개인세특 + 다른 과목), 잘라낸 뒤쪽도
    // 다시 검사한다. 한도 이내가 되면 멈춘다.
    let current = segment;
    let guard = 0;
    while (guard < 8 && byteEncoder.encode(current.body).length > SEGMENT_BYTE_LIMIT) {
      guard += 1;
      const found = findOversizedCut(current.body);
      if (!found) break;
      refined.push({ subject: current.subject, body: current.body.slice(0, found.cut).trim() });
      current = { subject: found.subject, body: current.body.slice(found.bodyStart) };
    }
    refined.push(current);
  }
  return refined;
}

/**
 * 병합이 끝난 기록 하나를 다시 검사한다. 쪽 나눔으로 여러 행에 걸친 기록은
 * 행 단위 분리 때는 한도 이내였다가 병합 후에야 한도를 넘기 때문에,
 * 행을 이어 붙인 뒤에 한 번 더 잘라야 한다.
 */
export function splitOversizedRecord(subject: string, body: string): SubjectSegment[] {
  return splitOversizedSegments([{ subject, body }]);
}

type OversizedCut = {
  /** 앞 조각이 끝나는 위치 */
  cut: number;
  /** 뒤 조각의 본문이 시작하는 위치 (과목명·콜론은 건너뛴다) */
  bodyStart: number;
  /** 뒤 조각에 붙일 이름 */
  subject: string;
};

/**
 * 한도를 넘은 조각 안에서 잘라낼 자리를 찾는다. 없으면 null.
 * 세 가지 신호를 보고, 가장 앞에 있는 것을 쓴다.
 *  1) 문장 시작의 `과목명:` — 목록에 없는 소인수·공동교육과정 과목도 여기서 잡힌다.
 *  2) 개인세특 표지 — 문장 시작이든 문장 중간이든.
 *  3) ` . `(마침표 앞 공백) 이음매 — 나이스가 항목을 이어 붙일 때 남는 흔적이라,
 *     한도를 넘은 조각에서는 병합 지점일 가능성이 높다.
 */
function findOversizedCut(body: string): OversizedCut | null {
  const candidates: OversizedCut[] = [];

  // 1) 문장 시작의 `이름:` — 목록에 없어도 과목으로 인정한다.
  const relaxed =
    /(?:^|[.!?]\s*)([가-힣A-Za-z][가-힣A-Za-zⅠ-Ⅻ0-9·() ]{1,24}?)\s*:\s*/gu;
  for (const match of body.matchAll(relaxed)) {
    const nameStart = (match.index ?? 0) + match[0].indexOf(match[1]);
    if (nameStart <= 0) continue;
    const name = collapse(match[1]);
    if (name.length < 2 || !isSubjectCandidate(name)) continue;
    candidates.push({
      cut: nameStart,
      bodyStart: (match.index ?? 0) + match[0].length,
      subject: name,
    });
    break;
  }

  // 2) 개인세특 표지: 문장 시작 표지 우선, 없으면 문장 중간 표지에서 문장 시작으로 되돌린다.
  PERSONAL_RECORD_EXPRESSION.lastIndex = 0;
  let personal: OversizedCut | null = null;
  for (const match of body.matchAll(PERSONAL_RECORD_EXPRESSION)) {
    const start = (match.index ?? 0) + (match[0].length - match[1].length);
    if (start > 0) {
      personal = { cut: start, bodyStart: start, subject: PERSONAL_RECORD_SUBJECT };
      break;
    }
  }
  if (!personal) {
    PERSONAL_MARKER_ANYWHERE.lastIndex = 0;
    for (const match of body.matchAll(PERSONAL_MARKER_ANYWHERE)) {
      const index = match.index ?? 0;
      if (index === 0) continue;
      const before = body.slice(0, index);
      const sentenceEnd = Math.max(
        before.lastIndexOf("."),
        before.lastIndexOf("!"),
        before.lastIndexOf("?"),
      );
      if (sentenceEnd < 0) continue;
      let cut = sentenceEnd + 1;
      while (cut < body.length && /\s/.test(body[cut])) cut += 1;
      if (cut > 0 && cut < body.length) {
        personal = { cut, bodyStart: cut, subject: PERSONAL_RECORD_SUBJECT };
        break;
      }
    }
  }
  if (personal) candidates.push(personal);

  // 3) ` . ` 이음매. 바로 뒤에 `이름:`이 서 있으면 그 이름을 쓴다.
  const junction = /\s\.\s+/g.exec(body);
  if (junction && junction.index > 0) {
    const bodyStart = junction.index + junction[0].length;
    if (bodyStart < body.length) {
      candidates.push({ cut: junction.index, bodyStart, subject: PERSONAL_RECORD_SUBJECT });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((left, right) => left.cut - right.cut);
  const best = candidates[0];
  // 이음매 절단이 뽑혔는데 그 자리에서 과목명이 시작한다면 과목 절단으로 바꾼다.
  if (best.subject === PERSONAL_RECORD_SUBJECT) {
    const named = candidates.find(
      (candidate) =>
        candidate.subject !== PERSONAL_RECORD_SUBJECT &&
        candidate.cut >= best.cut &&
        candidate.cut - best.bodyStart <= 2,
    );
    if (named) return named;
  }
  return best;
}
