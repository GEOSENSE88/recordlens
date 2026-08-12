/**
 * 점검 결과를 서식 있는 엑셀로 만든다.
 *
 * 읽기는 SheetJS(xlsx)를 계속 쓰지만, 쓰기는 exceljs를 쓴다.
 * SheetJS 무료판은 셀 색·테두리·머리글 고정 같은 서식을 지원하지 않는다.
 * exceljs는 무거워서 내려받기 단추를 눌렀을 때만 불러온다.
 */

export type WorkbookRow = {
  checked: boolean;
  className: string;
  number: string;
  name: string;
  subject: string;
  text: string;
  similarity: number;
  matchText: string;
  matchName: string;
  statusKey: "exact" | "high" | "review" | "normal";
  statusLabel: string;
  issueLabels: string;
  issueMatches: string;
  issueRefs: string;
  sourceFile: string;
  sourceRow: number;
};

export type SummaryRow = {
  subject: string;
  grades: number[];
  total: number;
  exact: number;
  high: number;
  review: number;
};

export type WorkbookInput = {
  categoryLabel: string;
  contentLabel: string;
  gradeNames: string[];
  generatedAt: string;
  threshold: number;
  rows: WorkbookRow[];
  summaries: SummaryRow[];
};

/* Record LENS 팔레트 (엑셀 ARGB) */
const BRAND_DARK = "FF14403B";
const BRAND = "FF1C716C";
const BRAND_SOFT = "FFEFF8F4";
const LINE = "FFD5E8E2";
const STATUS_FILL: Record<WorkbookRow["statusKey"], { fill: string; font: string }> = {
  exact: { fill: "FFFDECE6", font: "FF9C3822" },
  high: { fill: "FFFBF1D9", font: "FF77520B" },
  review: { fill: "FFEAF0F9", font: "FF375075" },
  normal: { fill: "FFEFF8F4", font: "FF14403B" },
};

type Worksheet = import("exceljs").Worksheet;

const thinBorder = {
  top: { style: "thin" as const, color: { argb: LINE } },
  left: { style: "thin" as const, color: { argb: LINE } },
  bottom: { style: "thin" as const, color: { argb: LINE } },
  right: { style: "thin" as const, color: { argb: LINE } },
};

/** 머리글 행을 브랜드색으로 칠하고 첫 행을 고정한다. */
function styleHeader(sheet: Worksheet, columnCount: number) {
  const header = sheet.getRow(1);
  header.height = 26;
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = header.getCell(column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder;
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

export async function buildStyledWorkbook(input: WorkbookInput): Promise<Blob> {
  const excel = await import("exceljs");
  const Workbook = excel.Workbook ?? (excel as { default: typeof import("exceljs") }).default.Workbook;
  const workbook = new Workbook();
  workbook.creator = "Record LENS";

  /* ---- 1. 종합점검 ---- */
  const main = workbook.addWorksheet("종합점검");
  main.columns = [
    { header: "확인", key: "checked", width: 7 },
    { header: "학급", key: "className", width: 11 },
    { header: "번호", key: "number", width: 6 },
    { header: "이름", key: "name", width: 10 },
    { header: input.categoryLabel, key: "subject", width: 16 },
    { header: input.contentLabel, key: "text", width: 64 },
    { header: "최대 유사도", key: "similarity", width: 11 },
    { header: "일치하는 문장(가장 유사한 기록)", key: "matchText", width: 64 },
    { header: "일치 이름", key: "matchName", width: 10 },
    { header: "점검 결과", key: "statusLabel", width: 12 },
    { header: "기재요령 점검", key: "issueLabels", width: 20 },
    { header: "발견 표현", key: "issueMatches", width: 26 },
    { header: "근거", key: "issueRefs", width: 26 },
    { header: "원본 파일", key: "sourceFile", width: 24 },
    { header: "원본 행", key: "sourceRow", width: 8 },
  ];

  for (const row of input.rows) {
    const added = main.addRow({
      checked: row.checked ? "✓" : "",
      className: row.className,
      number: row.number,
      name: row.name,
      subject: row.subject,
      text: row.text,
      similarity: row.similarity,
      matchText: row.matchText,
      matchName: row.matchName,
      statusLabel: row.statusLabel,
      issueLabels: row.issueLabels,
      issueMatches: row.issueMatches,
      issueRefs: row.issueRefs,
      sourceFile: row.sourceFile,
      sourceRow: row.sourceRow,
    });

    added.alignment = { vertical: "top", wrapText: false };
    for (const key of ["text", "matchText", "issueMatches", "issueRefs"]) {
      added.getCell(key).alignment = { vertical: "top", wrapText: true };
    }
    for (const key of ["checked", "number", "similarity", "statusLabel"]) {
      added.getCell(key).alignment = { vertical: "top", horizontal: "center" };
    }

    const similarityCell = added.getCell("similarity");
    similarityCell.numFmt = "0%";

    // 점검 결과 칸은 화면과 같은 색으로 칠해 눈에 바로 들어오게 한다.
    const status = STATUS_FILL[row.statusKey];
    const statusCell = added.getCell("statusLabel");
    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: status.fill } };
    statusCell.font = { bold: true, color: { argb: status.font }, size: 10 };

    if (row.checked) {
      const checkedCell = added.getCell("checked");
      checkedCell.font = { bold: true, color: { argb: BRAND } };
    }

    added.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = thinBorder;
    });
  }

  styleHeader(main, main.columns.length);
  main.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: main.columns.length } };

  /* ---- 2. 분석자료 (과목·영역별 현황) ---- */
  const summary = workbook.addWorksheet("분석자료");
  summary.columns = [
    { header: input.categoryLabel, key: "subject", width: 22 },
    ...input.gradeNames.map((grade, index) => ({ header: grade, key: `g${index}`, width: 9 })),
    { header: "합계", key: "total", width: 9 },
    { header: "완전 일치", key: "exact", width: 10 },
    { header: "높은 유사도", key: "high", width: 11 },
    { header: "확인 필요", key: "review", width: 10 },
  ];

  for (const entry of input.summaries) {
    const added = summary.addRow({
      subject: entry.subject,
      ...Object.fromEntries(entry.grades.map((count, index) => [`g${index}`, count])),
      total: entry.total,
      exact: entry.exact,
      high: entry.high,
      review: entry.review,
    });
    added.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.border = thinBorder;
      if (column > 1) cell.alignment = { horizontal: "center" };
    });
    // 확인이 필요한 과목이 한눈에 보이도록 완전 일치·높은 유사도가 있으면 칠한다.
    if (entry.exact > 0) {
      added.getCell("exact").fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL.exact.fill } };
      added.getCell("exact").font = { bold: true, color: { argb: STATUS_FILL.exact.font } };
    }
    if (entry.high > 0) {
      added.getCell("high").fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL.high.fill } };
      added.getCell("high").font = { bold: true, color: { argb: STATUS_FILL.high.font } };
    }
  }

  styleHeader(summary, summary.columns.length);

  /* ---- 3. 안내 ---- */
  const about = workbook.addWorksheet("안내");
  about.columns = [{ width: 96 }];
  const aboutLines = [
    "Record LENS · 학교생활기록부 종합점검 결과",
    `저장 시각: ${input.generatedAt}`,
    `높은 유사도 기준: ${Math.round(input.threshold * 100)}% 이상`,
    "",
    "· 자카드 유사도는 두 기록의 전체 고유 단어를 비교합니다.",
    "· 기재요령 점검은 2026 학교생활기록부 기재요령의 주요 기준을 바탕으로 한 보조 탐지입니다.",
    "· 자동 탐지는 확인이 필요한 후보를 찾는 기능이므로, 원문과 허용 예외를 직접 대조해 최종 판단해 주세요.",
    "· 이 파일에는 학생 이름과 기록이 들어 있습니다. 안전하게 관리해 주세요.",
    "",
    "제작: 산남고 이성훈",
  ];
  aboutLines.forEach((line, index) => {
    const cell = about.getCell(index + 1, 1);
    cell.value = line;
    if (index === 0) cell.font = { bold: true, size: 14, color: { argb: BRAND_DARK } };
    else cell.font = { size: 11, color: { argb: BRAND_DARK } };
  });
  about.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_SOFT } };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
