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

/**
 * 워터마크 바로 위의 바닥글: `산남고등학교 2026년 2월 13일 5/14 반 1 번호 2 성명 홍길동`
 * 워터마크와 생김새가 달라 따로 걸러야 한다. 이걸 놓치면 학교 이름이 본문에 섞여
 * 기록마다 기관명으로 잡힌다.
 */
const PAGE_FOOTER = /\d+\s*\/\s*\d+\s*반\s*\d+\s*번\s*호\s*\d+\s*성\s*명/;

/** 쪽마다 반복되는 표 머리글 */
const SUBJECT_TABLE_HEADER = /^과\s*목\s*세\s*부\s*능\s*력\s*(및)?\s*특\s*기\s*사\s*항/;

/**
 * 성적표 머리글. 교과학습발달상황 안에서 세특 표와 성적표가 번갈아 나오므로,
 * 이 줄을 만나면 세특 표가 다시 시작할 때까지 수집을 멈춘다.
 * 놓치면 `원점수`, `석차등급` 이 본문에 섞여 기재금지어로 잡힌다.
 *
 * 실제 파일에서 확인한 머리글
 *   학기 교과 과목 학점수 석차등급 비고
 *   학기 교과 과목 원점수/과목평균 비고
 *   학년 학기 세분류 이수시간 원점수 성취도 비고
 *   원점수/과목평균성취도
 *   학점성취도성취도별
 *
 * 낱말이 아니라 줄이 시작하는 모양으로 판정한다. `학습 성취도는 다소 아쉬웠으나`
 * 처럼 본문에 정상적으로 나오는 표현을 성적표로 오인하면 안 되기 때문이다.
 */
const GRADES_TABLE_HEADER =
  /^학\s*기\s*교\s*과|^학\s*년\s*학\s*기|^원\s*점\s*수\s*\/|^학\s*점\s*성\s*취\s*도/;

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
  isPageFooter: (line: string) => PAGE_FOOTER.test(line),
  isSubjectTableHeader: (line: string) => SUBJECT_TABLE_HEADER.test(line),
  isGradesTableHeader: (line: string) => GRADES_TABLE_HEADER.test(line),
  isSectionEnd: (line: string) => SECTION_END.test(line),
  isPersonalSection: (line: string) => PERSONAL_SECTION.test(line),
};

/**
 * 한 쪽에서 세특 본문에 해당하는 줄만 골라낸다.
 * 세특 표 머리글에서 켜고, 성적표 머리글이나 다음 항목 제목에서 끈다.
 * 한 쪽 안에서 세특 표와 성적표가 번갈아 나올 수 있어 상태를 오가며 훑는다.
 */
export function collectSubjectLines(lines: string[]) {
  const collected: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (SUBJECT_TABLE_HEADER.test(line)) {
      collecting = true;
      continue;
    }
    if (SECTION_END.test(line)) break;
    if (GRADES_TABLE_HEADER.test(line)) {
      collecting = false;
      continue;
    }
    if (collecting) collected.push(line);
  }

  return collected;
}

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

/** 쪽 아래 워터마크와 바닥글을 걷어낸 줄 목록을 만든다. */
function cleanPage(page: number, items: TextItem[]): PageLines {
  const lines = linesFromItems(items).filter(
    (line) => !WATERMARK.test(line) && !PAGE_FOOTER.test(line),
  );
  return { page, lines };
}

export type EnrolmentRow = { grade: number; classNumber: number; studentNumber: string };

/**
 * 학적 표에서 학년마다 한 행씩 쌓이는 `학년 반 번호 담임성명` 을 모두 읽는다.
 * 성명은 인적사항 줄에서 가져온다.
 */
export function readStudentHeader(lines: string[]) {
  const name = lines.map((line) => line.match(NAME_LINE)?.[1]).find(Boolean) ?? "";
  const rows: EnrolmentRow[] = [];
  for (const line of lines) {
    const row = line.match(CLASS_ROW);
    if (!row) continue;
    rows.push({ grade: Number(row[1]), classNumber: Number(row[2]), studentNumber: row[3] });
  }
  return { name, rows };
}

/** 파일 이름에 `3학년 1반` 처럼 학급이 적혀 있으면 읽는다. 없으면 빈 값. */
export function classFromFileName(fileName: string) {
  const match = fileName.match(/(\d)\s*학년\s*(\d{1,2})\s*반/);
  if (!match) return { grade: 0, classNumber: 0 };
  return { grade: Number(match[1]), classNumber: Number(match[2]) };
}

/**
 * 학생의 학급·번호를 정한다.
 *
 * 학생 본인의 학적 표가 가장 정확하므로 그것을 먼저 쓴다.
 * 다만 3월 이전에 뽑은 자료처럼 새 학년 행이 아직 없는 경우가 있어
 * (2026년 2월에 뽑은 3학년 자료에는 2학년 행까지만 있었다),
 * 파일 이름이 가리키는 학년의 행이 없으면 파일 이름을 따른다.
 */
export function resolveClass(
  rows: EnrolmentRow[],
  fromFileName: { grade: number; classNumber: number },
) {
  const latest = rows.length ? rows[rows.length - 1] : null;

  if (fromFileName.grade) {
    const matching = rows.find((row) => row.grade === fromFileName.grade);
    if (matching) {
      // 파일 이름과 같은 학년의 행이 있다 → 반·번호 모두 학적에서 가져온다.
      return {
        grade: `${matching.grade}학년`,
        className: `${matching.grade}학년 ${matching.classNumber}반`,
        number: matching.studentNumber,
      };
    }
    // 그 학년 행이 아직 없다 → 학급은 파일 이름, 번호는 있는 것 중 최신을 쓴다.
    return {
      grade: `${fromFileName.grade}학년`,
      className: `${fromFileName.grade}학년 ${fromFileName.classNumber}반`,
      number: latest?.studentNumber ?? "",
    };
  }

  // 파일 이름에 학급이 없다 → 학적 표의 최신 학년을 그대로 쓴다.
  if (latest) {
    return {
      grade: `${latest.grade}학년`,
      className: `${latest.grade}학년 ${latest.classNumber}반`,
      number: latest.studentNumber,
    };
  }
  return { grade: "", className: "", number: "" };
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

  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
    isEvalSupported: false,
  });

  // 나이스에서 저장한 PDF는 개인정보 보호 때문에 암호가 걸려 있는 경우가 많다.
  // pdf.js가 암호를 요구하면 사용자에게 물어보고, 틀리면 다시 묻는다.
  let passwordCancelled = false;
  task.onPassword = (updatePassword: (value: string) => void, reason: number) => {
    const retry = reason === 2; // pdf.js PasswordResponses.INCORRECT_PASSWORD
    const answer = window.prompt(
      `${retry ? "암호가 올바르지 않습니다.\n" : ""}'${file.name}' 은 암호가 걸린 PDF입니다.\n암호를 입력해 주세요.`,
    );
    if (answer === null || answer === "") {
      passwordCancelled = true;
      // 빈 값을 넘기면 pdf.js가 무한히 다시 묻는다. 일부러 틀린 값을 넣어 실패시킨다.
      updatePassword(" cancelled");
      return;
    }
    updatePassword(answer);
  };

  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (caught) {
    const name = caught instanceof Error ? caught.name : "";
    if (passwordCancelled || name === "PasswordException") {
      throw new Error(
        `'${file.name}' 은 암호가 걸린 PDF입니다. 암호를 입력하거나, 나이스에서 암호 없이 다시 저장해 주세요.`,
      );
    }
    if (name === "InvalidPDFException") {
      throw new Error(`'${file.name}' 은 손상되었거나 PDF 형식이 아닙니다. 파일을 다시 내려받아 주세요.`);
    }
    throw caught;
  }

  const fallback = classFromFileName(file.name);
  const records: PdfStudentRecord[] = [];

  let current: { header: ReturnType<typeof readStudentHeader>; lines: string[]; page: number } | null = null;

  const flush = () => {
    if (!current) return;
    const text = joinWrappedLines(current.lines);
    if (text.length > 3 && current.header.name) {
      const resolved = resolveClass(current.header.rows, fallback);
      records.push({
        className: resolved.className || "학급 미상",
        grade: resolved.grade || "학년 미상",
        // 번호는 같은 이름 학생을 구분하는 용도로 쓴다.
        number: resolved.number || `${records.length + 1}`,
        name: current.header.name,
        text,
        sourcePage: current.page,
      });
    }
    current = null;
  };

  // 실패했을 때 원인을 구분해 알려주기 위한 집계.
  let extractedChars = 0;
  let sawPersonalSection = false;

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const { lines } = cleanPage(pageNumber, content.items as TextItem[]);
      page.cleanup();
      extractedChars += lines.reduce((sum, line) => sum + line.length, 0);

      if (lines.some((line) => PERSONAL_SECTION.test(line))) {
        sawPersonalSection = true;
        flush();
        current = { header: readStudentHeader(lines), lines: [], page: pageNumber };
        continue;
      }
      if (!current) continue;

      const collected = collectSubjectLines(lines);
      if (!collected.length) continue;
      current.lines.push(...collected);
      if (!current.page) current.page = pageNumber;

      if (onProgress) await onProgress(pageNumber, doc.numPages);
    }
    flush();
  } finally {
    await doc.destroy();
  }

  if (!records.length) {
    if (extractedChars < 200) {
      // 스캔(이미지)으로 만든 PDF는 글자 층이 없어 아무것도 읽히지 않는다.
      throw new Error(
        `'${file.name}' 에서 글자를 읽지 못했습니다. 스캔·촬영으로 만든 PDF는 지원하지 않습니다. ` +
          "나이스에서 저장한 PDF나 엑셀(XLS data)을 사용해 주세요.",
      );
    }
    if (!sawPersonalSection) {
      throw new Error(
        `'${file.name}' 은 학교생활기록부 형식이 아닌 것 같습니다. ` +
          "나이스 `학생부 조회 및 출력`에서 저장한 학교생활기록부Ⅱ PDF를 올려 주세요.",
      );
    }
    throw new Error(
      `'${file.name}' 에서 세부능력 및 특기사항을 찾지 못했습니다. ` +
        "교과학습발달상황이 포함된 학교생활기록부Ⅱ PDF인지 확인해 주세요.",
    );
  }

  return records;
}
