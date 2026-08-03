/**
 * 나이스에서 내려받은 `학교생활기록부II` PDF에서 교과 세부능력 및 특기사항을 뽑아낸다.
 *
 * 엑셀(XLS data)이 있으면 그쪽이 정확하다. 이 경로는 엑셀을 구할 수 없을 때를 위한 보조 수단이다.
 *
 * PDF에서 확인한 구조 (학생 한 명당 12~14쪽)
 *   1쪽   학적 표 + 인적·학적사항 (성명이 여기 있다)
 *   2쪽   학교폭력 조치사항
 *   3~4쪽 창의적 체험활동상황
 *   5쪽~  교과학습발달상황 → 쪽마다 `과 목 | 세부능력 및 특기사항` 머리글이 반복된다
 *   끝쪽  독서활동상황, 행동특성 및 종합의견
 *   모든 쪽 맨 아래에 `학교명/날짜 시각/IP/교사명` 워터마크가 붙는다
 *
 * 한계: 본문이 양쪽 정렬이라 줄이 바뀔 때 띄어쓰기가 사라진다. 원문에 공백이 있었는지
 * PDF만 보고는 알 수 없다. 마침표·쉼표 뒤에서 줄이 바뀐 경우만 공백을 되살린다.
 */

export type PdfStudentRecord = {
  className: string;
  grade: string;
  number: string;
  name: string;
  /** 과목 구분이 들어 있는 세특 전체 덩어리. 과목 분할은 subject-records가 맡는다. */
  text: string;
  sourcePage: number;
};

type TextItem = { str: string; transform: number[] };

/** 쪽 맨 아래 워터마크: `산남고등학교/2026.02.13 14:26/172.18.***.116/홍길동` */
const WATERMARK = /\d{4}\.\d{2}\.\d{2}\s+\d{1,2}:\d{2}\/[\d.*]+\//;

/** 쪽마다 반복되는 표 머리글 */
const SUBJECT_TABLE_HEADER = /^과\s*목\s*세\s*부\s*능\s*력\s*(및)?\s*특\s*기\s*사\s*항/;

/** 세특 구간이 끝나는 지점 */
const SECTION_END = /독\s*서\s*활\s*동\s*상\s*황|행\s*동\s*특\s*성\s*(및)?\s*종\s*합\s*의\s*견/;

const PERSONAL_SECTION = /인\s*적\s*[·,]?\s*학\s*적\s*사\s*항/;
const NAME_LINE = /성\s*명\s*:\s*([가-힣A-Za-z]{2,10})/;
/** 학적 표의 `학년 반 번호 담임성명` 행 */
const CLASS_ROW = /^([1-3])\s+(\d{1,2})\s+(\d{1,2})\s+[가-힣]{2,5}$/;

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/** 시험에서 쓰는 판별기. 어떤 줄을 버리고 어디서 자르는지 한곳에서 관리한다. */
export const PDF_LINE_RULES = {
  isWatermark: (line: string) => WATERMARK.test(line),
  isSubjectTableHeader: (line: string) => SUBJECT_TABLE_HEADER.test(line),
  isSectionEnd: (line: string) => SECTION_END.test(line),
  isPersonalSection: (line: string) => PERSONAL_SECTION.test(line),
};

/**
 * PDF는 글자를 그린 순서대로 담고 있어 표가 뒤섞인다.
 * y로 줄을 묶고 줄 안에서 x로 정렬해 읽는 순서를 되살린다.
 * 묶는 폭은 글자 높이에 비례시켜, 인쇄 배율이 달라져도 견디게 한다.
 */
function linesFromItems(items: TextItem[]): string[] {
  const heights = items.map((item) => Math.abs(item.transform[3])).filter(Boolean);
  const fontSize = heights.length ? heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)] : 10;
  const tolerance = Math.max(1, fontSize * 0.4);

  const rows = new Map<number, { x: number; str: string }[]>();
  for (const item of items) {
    if (!item.str) continue;
    const key = Math.round(item.transform[5] / tolerance);
    const bucket = rows.get(key) ?? [];
    bucket.push({ x: item.transform[4], str: item.str });
    rows.set(key, bucket);
  }

  return [...rows.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, parts]) =>
      parts
        .sort((left, right) => left.x - right.x)
        .map((part) => part.str)
        .join("")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * 줄을 이어 붙인다.
 * 양쪽 정렬 때문에 줄 끝 공백이 사라지므로 기본은 붙여 쓴다.
 * 다만 마침표·쉼표 뒤는 원문에 반드시 공백이 있었으므로 살려 준다.
 * (붙여 쓰면 `발표함.다음으로` 가 되어 오탈자 규칙에 잘못 걸린다.)
 */
export function joinWrappedLines(lines: string[]) {
  let text = "";
  for (const line of lines) {
    if (!text) {
      text = line;
      continue;
    }
    text += /[.!?,]$/.test(text) ? ` ${line}` : line;
  }
  return collapse(text);
}

type PageLines = { page: number; lines: string[] };

/** 워터마크와 반복 머리글을 걷어낸 쪽별 줄 목록을 만든다. */
function cleanPage(page: number, items: TextItem[]): PageLines {
  const lines = linesFromItems(items).filter((line) => !WATERMARK.test(line));
  return { page, lines };
}

export function readStudentHeader(lines: string[]) {
  const name = lines.map((line) => line.match(NAME_LINE)?.[1]).find(Boolean) ?? "";
  // 학적 표는 학년마다 한 행씩 쌓인다. 마지막 행이 가장 최근 학년이다.
  // 다만 현재 학년 행은 아직 비어 있는 경우가 많아(3학년 자료인데 2학년 행이 마지막),
  // 학급은 파일 이름을 우선한다. 여기서 얻은 값은 파일 이름이 없을 때만 쓴다.
  let grade = "";
  let className = "";
  let number = "";
  for (const line of lines) {
    const row = line.match(CLASS_ROW);
    if (!row) continue;
    grade = `${row[1]}학년`;
    className = `${row[1]}학년 ${row[2]}반`;
    number = row[3];
  }
  return { name, grade, className, number };
}

/** 파일 이름에서 학급을 읽어 학적 표가 비어 있을 때 대신 쓴다. */
export function classFromFileName(fileName: string) {
  const match = fileName.match(/(\d)\s*학년\s*(\d{1,2})\s*반/);
  if (!match) return { grade: "", className: "" };
  return { grade: `${match[1]}학년`, className: `${match[1]}학년 ${match[2]}반` };
}

export type PdfParseProgress = (done: number, total: number) => void | Promise<void>;

export async function parseStudentRecordPdf(
  file: File,
  onProgress?: PdfParseProgress,
): Promise<PdfStudentRecord[]> {
  // pdf.js는 무거워서 PDF를 올렸을 때만 내려받는다.
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    // 앱 빌드는 Vite를 쓰므로 `?url` 로 번들된 워커 주소를 받는다.
    // (테스트처럼 미리 지정해 둔 경우에는 그대로 둔다.)
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const fallback = classFromFileName(file.name);
  const records: PdfStudentRecord[] = [];

  let current: { header: ReturnType<typeof readStudentHeader>; lines: string[]; page: number } | null = null;

  const flush = () => {
    if (!current) return;
    const text = joinWrappedLines(current.lines);
    if (text.length > 3 && current.header.name) {
      records.push({
        // 파일은 반별로 내려받으므로 파일 이름의 학급이 가장 믿을 만하다.
        className: fallback.className || current.header.className || "학급 미상",
        grade: fallback.grade || current.header.grade || "학년 미상",
        // 번호는 같은 이름 학생을 구분하는 용도로만 쓴다.
        number: current.header.number || `${records.length + 1}`,
        name: current.header.name,
        text,
        sourcePage: current.page,
      });
    }
    current = null;
  };

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const { lines } = cleanPage(pageNumber, content.items as TextItem[]);
      page.cleanup();

      if (lines.some((line) => PERSONAL_SECTION.test(line))) {
        flush();
        current = { header: readStudentHeader(lines), lines: [], page: pageNumber };
        continue;
      }
      if (!current) continue;

      // 세특 쪽은 언제나 표 머리글로 시작한다. 머리글이 없으면 다른 항목이다.
      const headerAt = lines.findIndex((line) => SUBJECT_TABLE_HEADER.test(line));
      if (headerAt < 0) continue;

      for (const line of lines.slice(headerAt + 1)) {
        if (SECTION_END.test(line)) break;
        current.lines.push(line);
      }
      if (!current.page || current.lines.length === 0) current.page = pageNumber;

      if (onProgress) await onProgress(pageNumber, doc.numPages);
    }
    flush();
  } finally {
    await doc.destroy();
  }

  return records;
}
