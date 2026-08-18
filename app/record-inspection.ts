export type InspectionIssueType =
  | "typo"
  | "symbol"
  | "prohibited"
  | "institution"
  | "business";

export type InspectionIssue = {
  type: InspectionIssueType;
  label: string;
  match: string;
  guidance: string;
  reference: string;
  severity: "danger" | "warning";
  index: number;
};

type TextRule = {
  expression: RegExp;
  label: string;
  guidance: string;
  reference: string;
  severity?: "danger" | "warning";
};

/** 한 기록에서 같은 종류의 지적을 최대 몇 건까지 보여줄지. */
const MAX_ISSUES_PER_TYPE = 10;

const PROHIBITED_RULES: TextRule[] = [
  {
    expression:
      /\b(?:TOEIC|TOEFL|TEPS|HSK|JPT|JLPT|DELF|DALF|TESTDAF|DSH|DSD|TORFL|DELE)\b|토익|토플|텝스|공인어학시험|한자능력검정|한자자격검정/giu,
    label: "공인어학시험",
    guidance: "공인어학시험 참여 사실, 성적 및 수상 실적은 학교생활기록부에 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18",
    severity: "danger",
  },
  {
    // `상` 뒤에는 조사 또는 문장부호만 허용해 `우수상태`, `장려상황` 같은 복합어 오탐을 막는다.
    expression:
      /교내\s*대회|교외\s*대회|대회\s*(?:참가|참여|수상|입상)|(?:최우수|우수|장려|공로)상(?=$|[\s,.;:!?·→←\-)"'’]|(?:을|를|은|는|이|가|에|과|와|도|만|의|으로|로)(?![가-힣]))|표창장|감사장|수상\s*(?:실적|사실)|입상/gu,
    label: "대회·수상",
    guidance: "수상경력 이외 항목에는 대회 참여·수상 사실을 기재하지 않으며, ‘대회’라는 용어도 주의해야 합니다.",
    reference: "2026 기재요령 p.18, p.61",
    severity: "danger",
  },
  {
    // `모의고사` 단순 언급은 과목 표기나 문제 풀이 활동 서술에도 흔히 나오므로,
    // 같은 문장에서 성적 표현과 함께 있을 때만 잡는다.
    // `백분위`도 통계 탐구에서 정상적으로 쓰이는 말이라 단독으로는 잡지 않는다.
    expression:
      /인증\s*시험|(?:모의고사|전국연합학력평가)[^.!?]{0,24}(?:성적|점수|등급|석차|백분위|표준점수)|(?:성적|점수|등급|석차|백분위|표준점수)[^.!?]{0,24}(?:모의고사|전국연합학력평가)|(?:원점수|석차)\s*\d*/gu,
    label: "시험·성적",
    guidance: "교내·외 인증시험과 모의고사·전국연합학력평가 성적 관련 내용은 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18",
    severity: "danger",
  },
  // 논문·학회 탐지는 뺐다. `학회지`, `논문`은 문헌 조사 서술에 정상적으로 나오는 말이고,
  // 학생이 실제 논문 실적을 기재하는 사례는 거의 없어 오탐 부담이 더 컸다.
  {
    expression: /도서\s*(?:출간|출판)|출판\s*사실|ISBN\s*(?:등록|등재)/giu,
    label: "도서 출간",
    guidance: "도서 출간 사실은 학교생활기록부에 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18",
    severity: "danger",
  },
  {
    // `특허` 단순 언급(예: 종자 특허를 둘러싼 논쟁을 탐구함)은 지재권 실적이 아니므로
    // 출원·등록·취득이 함께 있을 때만 잡는다.
    expression:
      /(?:특허|실용신안)\s*권?[을를]?\s*(?:출원|등록|취득)|상표\s*(?:출원|등록)|디자인\s*(?:출원|등록)/gu,
    label: "지식재산권",
    guidance: "특허·실용신안·상표·디자인 등의 출원 또는 등록 사실은 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18",
    severity: "danger",
  },
  {
    expression: /해외\s*(?:어학연수|봉사활동)|어학연수/gu,
    label: "해외 활동",
    guidance: "어학연수·해외 봉사활동 등 해외 활동 실적과 관련 내용은 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18",
    severity: "danger",
  },
  {
    expression: /장학생|장학금|장학\s*수혜/gu,
    label: "장학 관련",
    guidance: "장학생·장학금 관련 내용은 학교생활기록부에 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18",
    severity: "danger",
  },
  {
    expression: /자격증|자격\s*(?:취득|획득)|국가직무능력표준|NCS\s*이수/giu,
    label: "자격증",
    guidance: "자격증 명칭 및 취득 사실은 지정 항목 이외의 서술형 항목에 입력할 수 없습니다.",
    reference: "2026 기재요령 p.19",
    severity: "danger",
  },
  // 부모 지위 탐지는 뺐다. 사회 탐구에서 `부모의 소득이 자녀 세대에 미치는 영향`처럼
  // 연구 주제로 다루는 서술이 흔한데, 학생 본인 부모를 언급하는 문장과 단어만으로는
  // 구분할 수 없어 오탐 부담이 더 컸다.
];

const TYPO_RULES: TextRule[] = [
  {
    expression: /[.!?](?=[가-힣A-Za-z])/gu,
    label: "문장 띄어쓰기",
    guidance: "문장부호 뒤에 띄어쓰기가 빠진 것으로 보입니다.",
    reference: "문장 형식 점검",
  },
  {
    expression: /([.,!?])\1+/gu,
    label: "문장부호 반복",
    guidance: "같은 문장부호가 연속으로 입력되었습니다.",
    reference: "문장 형식 점검",
  },
  {
    expression: /(^|\s)([가-힣A-Za-z]{2,})\s+\2(?=\s|[.,!?]|$)/giu,
    label: "단어 반복",
    guidance: "같은 단어가 연속으로 반복된 것으로 보입니다.",
    reference: "문장 형식 점검",
  },
  {
    // `해박과 지식`은 `해박한 지식`의 오타다. 실제 점검에서 나온 어근+조사 오류.
    expression:
      /역활|됬|되여|어떻해|왠만|몇일|갯수|촛점|왠일|웬지|오랫만|희안|곰곰히|일일히|틈틈히|뿐만아니라|해박과|할수(?=\s|[.,!?]|$)/gu,
    label: "맞춤법 의심",
    guidance: "자주 발생하는 맞춤법 또는 띄어쓰기 오류가 의심됩니다. 원문을 확인해 주세요.",
    reference: "맞춤법 보조 점검",
  },
  {
    // 억음 부호(`·｀)나 프라임(′·″)이 따옴표 대신 들어가는 경우.
    // 한글 워드나 스마트폰 자판에서 붙여 넣을 때 자주 섞여 들어온다.
    expression: /[｀`´＇＂′″‵‛‟〝〞〃]/gu,
    label: "따옴표 오입력",
    guidance:
      "작은따옴표(')나 큰따옴표(\")가 아닌 비슷한 모양의 특수기호가 입력된 것으로 보입니다. 올바른 따옴표로 바꿔 주세요.",
    reference: "문장 형식 점검",
  },
];

/** 여닫는 짝을 검사할 부호. 자판 화살괄호(< >)는 비교·화살표로도 쓰여 제외한다. */
const PAIRED_MARKS: Array<{ open: string; close: string; name: string }> = [
  { open: "‘", close: "’", name: "작은따옴표" },
  { open: "“", close: "”", name: "큰따옴표" },
  { open: "(", close: ")", name: "소괄호" },
  { open: "[", close: "]", name: "대괄호" },
  { open: "「", close: "」", name: "낫표" },
  { open: "『", close: "』", name: "겹낫표" },
  { open: "〈", close: "〉", name: "홑화살괄호" },
  { open: "《", close: "》", name: "겹화살괄호" },
];

/**
 * 곧은따옴표는 여는 부호와 닫는 부호가 같은 문자라서, 앞뒤 글자로 역할을 가려 짝을 짓는다.
 * 앞이 공백이고 뒤가 글자면 여는 따옴표, 앞이 글자면 닫는 따옴표,
 * 양쪽 다 공백이면(예: `준다 ' 는`) 열린 따옴표가 있을 때 닫는 것으로 본다.
 * 이렇게 하면 짝이 없을 때 마지막 따옴표가 아니라 실제로 짝이 없는 자리를 짚는다.
 */
function pairStraightQuotes(
  text: string,
  quote: string,
): { pairs: Array<[number, number]>; unmatched: number[] } {
  const opens: number[] = [];
  const pairs: Array<[number, number]> = [];
  const unmatched: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== quote) continue;
    const before = i > 0 ? text[i - 1] : "";
    // 숫자 뒤 따옴표는 RNA 5' 말단, 2'-O-methyl 같은 과학 표기다. 다만 열린 따옴표가
    // 있으면 `'1984'`처럼 숫자로 끝나는 제목의 닫는 따옴표일 수 있으니 짝짓기에 쓴다.
    if (/\d/.test(before) && !opens.length) continue;
    const closesHere = before !== "" && !/[\s([{「『〈《]/.test(before);
    if (closesHere || opens.length) {
      // 앞이 공백이라 여는 것처럼 보여도(`유리할까? '라는`), 열린 따옴표가
      // 있으면 닫는 것으로 본다. 닫는 따옴표 앞에 공백을 두는 표기가 실제로 있다.
      const open = opens.pop();
      if (open === undefined) unmatched.push(i);
      else pairs.push([open, i]);
    } else opens.push(i);
  }
  return { pairs, unmatched: [...unmatched, ...opens] };
}

/**
 * 따옴표·낫표·화살괄호로 묶인 구간. 소·대괄호는 한자·영문 병기에 쓰여 제외한다.
 * 세특에서 이 부호 안은 대부분 책·작품·프로그램 제목이라, 실명 계열 지적을 면제할 때 쓴다.
 */
function quotedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const mark of PAIRED_MARKS) {
    if (mark.open === "(" || mark.open === "[") continue;
    const opens: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === mark.open) opens.push(i);
      else if (text[i] === mark.close && opens.length) {
        ranges.push([(opens.pop() as number) + 1, i]);
      }
    }
  }
  for (const quote of ["'", '"']) {
    for (const [open, close] of pairStraightQuotes(text, quote).pairs) {
      ranges.push([open + 1, close]);
    }
  }
  return ranges;
}

/**
 * 따옴표·괄호의 여닫는 짝이 맞는지 확인한다.
 * 굽은따옴표는 여는 부호와 닫는 부호가 다르므로 짝이 없는 위치를 정확히 짚을 수 있다.
 */
function collectUnbalancedPairs(text: string, output: InspectionIssue[]) {
  for (const mark of PAIRED_MARKS) {
    const opens: number[] = [];
    const unmatched: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === mark.open) opens.push(i);
      else if (text[i] === mark.close) {
        if (opens.length) opens.pop();
        else unmatched.push(i);
      }
    }
    for (const index of [...unmatched, ...opens]) {
      output.push({
        type: "typo",
        label: "짝 안 맞는 부호",
        match: text[index],
        guidance:
          `${mark.name}의 여는 부호와 닫는 부호 수가 맞지 않습니다. 짝이 없는 부호의 위치를 표시했습니다.` +
          (mark.open === "‘" ? " 영어 어퍼스트로피(’)로 쓰인 경우라면 무시해도 됩니다." : ""),
        reference: "문장 형식 점검",
        severity: "warning",
        index,
      });
    }
  }

  for (const quote of ["'", '"']) {
    for (const index of pairStraightQuotes(text, quote).unmatched) {
      output.push({
        type: "typo",
        label: "짝 안 맞는 부호",
        match: quote,
        guidance: `따옴표(${quote})의 여닫는 짝이 맞지 않는 것으로 보입니다. 짝이 없어 보이는 자리를 표시했습니다. 영어 어퍼스트로피(예: don't)라면 무시해도 됩니다.`,
        reference: "문장 형식 점검",
        severity: "warning",
        index,
      });
    }
  }
}

/**
 * 여기서 말하는 특수문자는 키보드로 바로 칠 수 없는 기호다.
 * `~ ? ! + - @ # = _ | < >` 같은 자판 기호와 가운뎃점(·), 화살괄호 따옴표는
 * 세특에서 정상적으로 쓰이므로 지적하지 않는다.
 * 원문자·도형·화살표처럼 한글 워드에서 붙여 넣은 기호와 이모지만 잡는다.
 */
const SPECIAL_SYMBOL_EXPRESSION =
  /[①-⑳㉠-㉻⑴-⒇ⓐ-ⓩ●○■□◆◇▲△▼▽★☆▶▷◀◁※§¶♣♠♥♦♤♡◎→←↑↓⇒⇔↔✓✔✗✘☎☏☞☜☜♬♪♩†‡]|\p{Extended_Pictographic}/gu;

/** 한글 표기 기관명. 대소문자를 구분하지 않고 찾는다. */
const SPECIFIC_INSTITUTIONS = [
  // 국제기구
  "유엔",
  "국제연합",
  "세계보건기구",
  "세계무역기구",
  "국제통화기금",
  "유네스코",
  "유니세프",
  "나토",
  "국제원자력기구",
  "세계기상기구",
  "국제노동기구",
  "세계식량계획",
  "국제앰네스티",
  "앰네스티",
  "그린피스",
  "국경없는의사회",
  "국경 없는 의사회",
  "적십자",
  "대한적십자사",
  "세계자연기금",
  "국제방사선방호위원회",
  "세계원자력발전사업자협회",
  // 정부·공공기관
  "통계청",
  "경찰청",
  "검찰청",
  "국세청",
  "관세청",
  "기상청",
  "산림청",
  "특허청",
  "수사청",
  "질병관리청",
  // `교육부`, `교육청` 은 교육 관련 기관이라 세특에 정상적으로 나오므로 잡지 않는다.
  "식품의약품안전처",
  "식약처",
  "환경부",
  "보건복지부",
  "과학기술정보통신부",
  "국토교통부",
  "고용노동부",
  "여성가족부",
  "문화체육관광부",
  "행정안전부",
  "기획재정부",
  "농림축산식품부",
  "산업통상자원부",
  "해양수산부",
  "중소벤처기업부",
  "국립국어원",
  "국가인권위원회",
  "헌법재판소",
  "국민건강보험공단",
  "국민연금공단",
  "한국은행",
  "한국전력공사",
  "한국철도공사",
  "코레일",
  "한국소비자원",
  "한국관광공사",
  "한국장학재단",
  "한국교육과정평가원",
  "한국과학창의재단",
  "한국연구재단",
  "한국과학기술원",
  "한국음악저작권협회",
  "한국음악저작권 협회",
  "한국전통문화전당",
  "종로경찰서",
  "독립협회",
  "미국심장학회",
  "식품안전나라",
  "나눔의 집",
  "나눔의집",
  "달빛어린이병원",
  "KBS 방송국",
  // 대학 약칭. `서울대학교` 같은 정식 명칭은 학교 규칙이 따로 잡는다.
  "서울대",
  "연세대",
  "고려대",
  "성균관대",
  "한양대",
  "중앙대",
  "경희대",
  "서강대",
  "이화여대",
  "건국대",
  "동국대",
  "홍익대",
  "국민대",
  "숭실대",
  "세종대",
  "단국대",
  "아주대",
  "인하대",
  "부산대",
  "경북대",
  "전남대",
  "전북대",
  "충남대",
  "충북대",
  "강원대",
  "제주대",
  "카이스트",
  "포스텍",
  "유니스트",
  "지스트",
  "하버드",
  "스탠퍼드",
  "스탠포드",
  "옥스퍼드",
  "케임브리지",
  "프린스턴",
  "도쿄대",
  "칭화대",
  // `나사`는 부품 나사와 구분할 수 없어 넣지 않는다. 영문 NASA 는 약어 규칙이 잡는다.
];

/**
 * 로마자 약어는 대소문자를 구분해 찾는다.
 * `who`, `un`, `it` 같은 흔한 영어 단어가 대문자 약어로 오인되는 것을 막기 위함이다.
 */
const INSTITUTION_ACRONYMS = [
  "UN",
  "WHO",
  "WTO",
  "IMF",
  "OECD",
  "OECE",
  "EU",
  "UNESCO",
  "UNICEF",
  "NATO",
  "NASA",
  "IAEA",
  "ILO",
  "FAO",
  "WFP",
  "WMO",
  "IPCC",
  "UNHCR",
  "UNDP",
  "UNEP",
  "ASEAN",
  "APEC",
  "OPEC",
  "WWF",
  "CDC",
  "FDA",
  "EPA",
  "NGO",
  "KBS",
  "MBC",
  "SBS",
  "EBS",
  "MIT",
  "KAIST",
  "POSTECH",
  "UNIST",
  "GIST",
  "DGIST",
];

/**
 * 한글 표기 상호·브랜드명.
 * `현대`, `기아`, `메타`, `자라`처럼 일반 명사로도 자주 쓰이는 낱말은 넣지 않는다.
 * (`현대 사회`, `기아 문제`, `메타 인지` 등을 오탐하게 된다.)
 */
const SPECIFIC_BUSINESSES = [
  "삼성",
  "삼성전자",
  "삼성그룹",
  "현대자동차",
  "현대그룹",
  "포스코",
  "한화",
  "두산",
  "신세계",
  "이마트",
  "롯데월드",
  "롯데마트",
  "네이버",
  "카카오",
  "카카오톡",
  "카카오페이",
  "카카오뱅크",
  "카카오 헬스케어",
  "카카오헬스케어",
  "쿠팡",
  "배달의민족",
  "당근마켓",
  "구글",
  "애플",
  "아마존",
  "마이크로소프트",
  "테슬라",
  "엔비디아",
  "인텔",
  "퀄컴",
  "화웨이",
  "샤오미",
  "소니",
  "도요타",
  "토요타",
  "필립스",
  "스페이스X",
  "유튜브",
  "넷플릭스",
  "인스타그램",
  "페이스북",
  "틱톡",
  "스레드",
  "디즈니",
  "픽사",
  "지브리",
  "나이키",
  "아디다스",
  "유니클로",
  "스타벅스",
  "맥도날드",
  "버거킹",
  "코카콜라",
  "다이소",
  "올리브영",
  "세븐일레븐",
  "프라다",
  "세라젬",
  "한강 버거",
  "챗GPT",
  "오픈AI",
  "딥마인드",
  "제미나이",
  "파파고",
];

/** 로마자 상호는 대소문자를 구분해 찾는다. */
const BUSINESS_ACRONYMS = [
  "SpaceX",
  "ChatGPT",
  "OpenAI",
  "DeepMind",
  "Threads",
  "NVIDIA",
  "VIPKID",
  "LG",
  "SK",
  "CJ",
  "GS25",
  "AMD",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ENTITY_HEAD = "(?<![가-힣A-Za-z0-9])";
const ENTITY_TAIL =
  `(?=$|[\\s,.;:!?·→←\\-)]|["'’]|(?:에서|에게|으로|의|과|와|은|는|이|가|을|를|도|만|에|로)` +
  `(?=$|[\\s,.;:!?·→←\\-)]|["'’]))`;

/**
 * iOS Safari 16.4 미만은 정규식 lookbehind를 지원하지 않는다. 모듈 최상위에서 그대로
 * 던지면 앱 전체가 빈 화면이 되므로, 지원하지 않는 브라우저에서는 해당 규칙만 비활성화한다.
 */
function entityExpression(body: string, caseSensitive = false): RegExp | null {
  try {
    return new RegExp(`${ENTITY_HEAD}(?:${body})${ENTITY_TAIL}`, caseSensitive ? "gu" : "giu");
  } catch {
    return null;
  }
}

function exactEntityExpression(values: string[], caseSensitive = false) {
  return entityExpression(
    values
      .map(escapeRegExp)
      .sort((left, right) => right.length - left.length)
      .join("|"),
    caseSensitive,
  );
}

const SPECIFIC_INSTITUTION_EXPRESSION = exactEntityExpression(SPECIFIC_INSTITUTIONS);
const INSTITUTION_ACRONYM_EXPRESSION = exactEntityExpression(INSTITUTION_ACRONYMS, true);
const BUSINESS_ACRONYM_EXPRESSION = exactEntityExpression(BUSINESS_ACRONYMS, true);
// 인물·강사명 탐지는 뺐다. 외부 강사 실명이 세특에 남는 일 자체가 드물고,
// 자동 규칙으로는 교과 내용 속 인물과 구분하기 어려워 오탐 부담이 더 컸다.
const STRICT_SCHOOL_EXPRESSION = entityExpression(
  "[가-힣A-Za-z0-9·]{2,24}(?:대학교|전문대학|사관학교|고등학교|중학교|초등학교)",
);
const NAMED_INSTITUTION_EXPRESSION = entityExpression(
  "(?:한국|대한|국립|국제|세계|미국|서울|충북|청주|산남|[A-Z]{2,})[가-힣A-Za-z0-9·]{1,20}" +
    "(?:연구원|연구소|학회|협회|재단|방송국|신문사|병원|박물관|미술관|도서관|공단|공사|위원회|전당)",
);
const SPECIFIC_PLACE_INSTITUTION_EXPRESSION = entityExpression("[가-힣]{2,12}(?:공항|경찰서)");
const BUSINESS_EXPRESSION = entityExpression(
  `(?:주식회사|\\(주\\)|㈜)\\s*[가-힣A-Za-z0-9·]+|${SPECIFIC_BUSINESSES.map(escapeRegExp)
    .sort((left, right) => right.length - left.length)
    .join("|")}`,
);

/** 기관명·상호명 규칙을 이 브라우저에서 사용할 수 있는지 여부. */
export const ENTITY_RULES_SUPPORTED = SPECIFIC_INSTITUTION_EXPRESSION !== null;
const ALLOWED_INSTITUTIONS = new Set([
  "대한민국학술원",
  "국사편찬위원회",
  "국립국제교육원",
  "국립특수교육원",
  "교원소청심사위원회",
  "중앙교육연수원",
]);

function collectMatches(
  text: string,
  type: InspectionIssueType,
  rule: TextRule,
  output: InspectionIssue[],
) {
  rule.expression.lastIndex = 0;
  for (const match of text.matchAll(rule.expression)) {
    const raw = match[0];
    const matchedText = raw.trim();
    if (!matchedText) continue;
    // 규칙이 앞뒤 공백까지 잡는 경우가 있어, 잘라낸 만큼 위치를 밀어 원문 강조 구간을 맞춘다.
    const leadingSpace = raw.length - raw.trimStart().length;
    output.push({
      type,
      label: rule.label,
      match: matchedText,
      guidance: rule.guidance,
      reference: rule.reference,
      severity: rule.severity ?? "warning",
      index: (match.index ?? 0) + leadingSpace,
    });
  }
}

export function inspectRecordText(text: string): InspectionIssue[] {
  const issues: InspectionIssue[] = [];

  for (const rule of TYPO_RULES) collectMatches(text, "typo", rule, issues);
  collectUnbalancedPairs(text, issues);
  for (const rule of PROHIBITED_RULES) collectMatches(text, "prohibited", rule, issues);

  SPECIAL_SYMBOL_EXPRESSION.lastIndex = 0;
  for (const match of text.matchAll(SPECIAL_SYMBOL_EXPRESSION)) {
    issues.push({
      type: "symbol",
      label: "특수기호",
      match: match[0],
      guidance: "서술형 항목에서는 특수문자와 문단구분 기호 사용을 지양합니다.",
      reference: "2026 기재요령 p.30",
      severity: "warning",
      index: match.index ?? 0,
    });
  }

  for (const expression of [
    SPECIFIC_INSTITUTION_EXPRESSION,
    INSTITUTION_ACRONYM_EXPRESSION,
    STRICT_SCHOOL_EXPRESSION,
    NAMED_INSTITUTION_EXPRESSION,
    SPECIFIC_PLACE_INSTITUTION_EXPRESSION,
  ]) {
    if (!expression) continue;
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      const institution = match[0];
      if (ALLOWED_INSTITUTIONS.has(institution)) continue;
      issues.push({
        type: "institution",
        label: "기관명",
        match: institution,
        guidance:
          "구체적인 기관·대학·학교의 실명으로 보입니다. 2024·2025 교사 점검 사례와 허용 예외를 대조해 주세요.",
        reference: "2026 기재요령 p.19 · 교사 점검대장 사례",
        severity: "warning",
        index: match.index ?? 0,
      });
    }
  }

  for (const expression of [BUSINESS_EXPRESSION, BUSINESS_ACRONYM_EXPRESSION]) {
    if (!expression) continue;
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      issues.push({
        type: "business",
        label: "상호명",
        match: match[0],
        guidance:
          "구체적인 회사·제품·서비스의 실명으로 보입니다. 2024·2025 교사 점검 사례와 허용 예외를 대조해 주세요.",
        reference: "2026 기재요령 p.19 · 교사 점검대장 사례",
        severity: "warning",
        index: match.index ?? 0,
      });
    }
  }

  // 숫자 뒤 프라임(′ ″)은 각도·분·초나 염기서열 5′ 말단 같은 과학 표기이고,
  // `쌍극자 쌍극자 힘`은 화학 용어라 단어 반복이 아니다.
  const withoutScientific = issues.filter((issue) => {
    if (
      issue.label === "따옴표 오입력" &&
      /^[′″]$/.test(issue.match) &&
      /\d/.test(text[issue.index - 1] ?? "")
    ) {
      return false;
    }
    if (issue.label === "단어 반복" && issue.match.includes("쌍극자")) return false;
    return true;
  });

  // 따옴표·낫표 안은 대부분 책·작품 제목이다. `'멋진 신세계'`의 신세계처럼
  // 제목 속 낱말이 기재금지어·기관명·상호명에 걸려도 지적하지 않는다.
  const titleRanges = quotedRanges(text);
  const NAMED_TYPES = new Set<InspectionIssueType>(["prohibited", "institution", "business"]);
  const outsideTitles = withoutScientific.filter(
    (issue) =>
      !NAMED_TYPES.has(issue.type) ||
      !titleRanges.some(
        ([start, end]) => issue.index >= start && issue.index + issue.match.length <= end,
      ),
  );

  const seen = new Set<string>();
  const deduped = outsideTitles
    .sort((left, right) => left.index - right.index || left.type.localeCompare(right.type))
    .filter((issue) => {
      const key = `${issue.type}|${issue.index}|${issue.match}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // 상한은 항목 종류별로 따로 적용한다. 예전처럼 위치 순으로 전체를 자르면 특수기호가
  // 수십 개인 기록에서 뒤쪽의 기재금지어 지적이 통째로 사라졌다.
  const kept = new Map<InspectionIssueType, number>();
  return deduped.filter((issue) => {
    const used = kept.get(issue.type) ?? 0;
    if (used >= MAX_ISSUES_PER_TYPE) return false;
    kept.set(issue.type, used + 1);
    return true;
  });
}

export const INSPECTION_LABELS: Record<InspectionIssueType, string> = {
  typo: "오탈자",
  symbol: "특수기호",
  prohibited: "기재금지어",
  institution: "기관명",
  business: "상호명",
};
