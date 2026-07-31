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
    expression: /교내\s*대회|교외\s*대회|대회\s*(?:참가|참여|수상|입상)|(?:최우수|우수|장려|공로)상|표창장|감사장|수상\s*(?:실적|사실)|입상/gu,
    label: "대회·수상",
    guidance: "수상경력 이외 항목에는 대회 참여·수상 사실을 기재하지 않으며, ‘대회’라는 용어도 주의해야 합니다.",
    reference: "2026 기재요령 p.18, p.61",
    severity: "danger",
  },
  {
    expression: /인증\s*시험|모의고사|전국연합학력평가|(?:원점수|석차|백분위)\s*\d*/gu,
    label: "시험·성적",
    guidance: "교내·외 인증시험과 모의고사·전국연합학력평가 성적 관련 내용은 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18",
    severity: "danger",
  },
  {
    expression: /소\s*논문|논문\s*(?:투고|등재|발표)|학회지|학회\s*발표/gu,
    label: "논문·학회",
    guidance: "논문 투고·등재·학회 발표 사실과 창체 자율탐구 산출물의 소논문 실적은 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18, p.82",
    severity: "danger",
  },
  {
    expression: /도서\s*(?:출간|출판)|출판\s*사실|ISBN\s*(?:등록|등재)/giu,
    label: "도서 출간",
    guidance: "도서 출간 사실은 학교생활기록부에 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18",
    severity: "danger",
  },
  {
    expression: /특허|실용신안|상표\s*(?:출원|등록)|디자인\s*(?:출원|등록)/gu,
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
  {
    expression: /(?:부모|아버지|어머니|보호자).{0,12}(?:직업|직장|직위|소득|재산)|(?:직업|직장|직위|소득|재산).{0,12}(?:부모|아버지|어머니|보호자)/gu,
    label: "부모 지위",
    guidance: "부모의 사회·경제적 지위를 암시하는 내용은 기재할 수 없습니다.",
    reference: "2026 기재요령 p.18",
    severity: "danger",
  },
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
    expression: /역활|됬|되여|어떻해|왠만|뿐만아니라|할수(?=\s|[.,!?]|$)/gu,
    label: "맞춤법 의심",
    guidance: "자주 발생하는 맞춤법 또는 띄어쓰기 오류가 의심됩니다. 원문을 확인해 주세요.",
    reference: "맞춤법 보조 점검",
  },
];

const SPECIAL_SYMBOL_EXPRESSION =
  /[①-⑳ⓐ-ⓩ●■◆◇★☆▶▷※♣♠♥♦→←↑↓✓✔☎☞☜@#^_=+~`|\\<>{}\[\]]|\p{Extended_Pictographic}/gu;
const INSTITUTION_EXPRESSION =
  /(?:^|[\s,.;:!?("'‘])([가-힣A-Za-z0-9·]{2,24}(?:대학교|전문대학|고등학교|중학교|초등학교|연구원|연구소|학회|협회|재단|방송국|신문사|병원|박물관|미술관|도서관|공단|공사))(?=$|[\s,.;:!?)]|["'’])/gu;
const BUSINESS_EXPRESSION =
  /(?:주식회사|\(주\)|㈜)\s*[가-힣A-Za-z0-9·]+|삼성|엘지|LG|현대|SK|네이버|카카오|구글|유튜브|넷플릭스|애플|마이크로소프트|아마존|스타벅스|맥도날드|롯데|쿠팡|배달의민족|인스타그램|페이스북|틱톡|ChatGPT|챗GPT/giu;
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
    const matchedText = match[0].trim();
    if (!matchedText) continue;
    output.push({
      type,
      label: rule.label,
      match: matchedText,
      guidance: rule.guidance,
      reference: rule.reference,
      severity: rule.severity ?? "warning",
      index: match.index ?? 0,
    });
  }
}

export function inspectRecordText(text: string): InspectionIssue[] {
  const issues: InspectionIssue[] = [];

  for (const rule of TYPO_RULES) collectMatches(text, "typo", rule, issues);
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

  INSTITUTION_EXPRESSION.lastIndex = 0;
  for (const match of text.matchAll(INSTITUTION_EXPRESSION)) {
    const institution = match[1];
    if (ALLOWED_INSTITUTIONS.has(institution)) continue;
    issues.push({
      type: "institution",
      label: "기관명",
      match: institution,
      guidance: "구체적인 대학·기관·학교명으로 보입니다. 허용되는 교육관련기관 또는 예외 항목인지 확인해 주세요.",
      reference: "2026 기재요령 p.19",
      severity: "warning",
      index: (match.index ?? 0) + match[0].indexOf(institution),
    });
  }

  BUSINESS_EXPRESSION.lastIndex = 0;
  for (const match of text.matchAll(BUSINESS_EXPRESSION)) {
    issues.push({
      type: "business",
      label: "상호명",
      match: match[0],
      guidance: "구체적인 상호명·브랜드명으로 보입니다. 서술형 항목에 입력 가능한지 확인해 주세요.",
      reference: "2026 기재요령 p.19",
      severity: "warning",
      index: match.index ?? 0,
    });
  }

  const seen = new Set<string>();
  return issues
    .sort((left, right) => left.index - right.index || left.type.localeCompare(right.type))
    .filter((issue) => {
      const key = `${issue.type}|${issue.index}|${issue.match}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

export const INSPECTION_LABELS: Record<InspectionIssueType, string> = {
  typo: "오탈자",
  symbol: "특수기호",
  prohibited: "기재금지어",
  institution: "기관명",
  business: "상호명",
};
