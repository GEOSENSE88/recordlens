"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCheck2,
  FileText,
  HelpCircle,
  Files,
  FileSpreadsheet,
  Info,
  LockKeyhole,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  isCreativeActivityExport,
  parseCreativeActivityRows,
} from "./creative-records";
import { BRAND_ICON_SRC, NEIS_GUIDE_SRC } from "./brand-icon";
import { REPORT_SCRIPT } from "./report-script";
import { splitSubjectSegments, subjectNamesFromTexts } from "./subject-records";
import {
  ENTITY_RULES_SUPPORTED,
  INSPECTION_LABELS,
  inspectRecordText,
  lengthOverflowIssue,
  type InspectionIssue,
  type InspectionIssueType,
} from "./record-inspection";

type RiskStatus = "exact" | "high" | "review" | "normal";
type SortMode = "risk" | "class" | "name" | "subject";
type RecordType = "subject" | "creative";

type SourceRow = {
  cells: string[];
  sourceFile: string;
  sourceRow: number;
};

type CheckRecord = {
  id: string;
  className: string;
  grade: string;
  subject: string;
  /** 학급 내 동명이인을 구분하기 위한 학생 번호. 원본에 없으면 빈 문자열. */
  number: string;
  name: string;
  text: string;
  sourceFile: string;
  sourceRow: number;
  rawCells: string[];
  normalizedText: string;
  tokens: string[];
  similarity: number;
  matchId: string | null;
  matchName: string;
  matchText: string;
  exactGroupSize: number;
  recordType: RecordType;
  issues: InspectionIssue[];
  /** 담당자가 예외 처리 버튼으로 걸러낸 지적. 화면·집계·내보내기에서 빠진다. */
  exceptedIssues?: InspectionIssue[];
  /**
   * 확인 표시를 저장할 때 쓰는 내용 기반 열쇠.
   * id는 업로드할 때마다 다시 매겨지므로, 같은 파일을 다시 올려도
   * 확인 표시가 유지되려면 내용에서 만든 값이 필요하다.
   */
  checkKey: string;
};

type ProgressState = {
  stage: "reading" | "cleaning" | "comparing";
  value: number;
  label: string;
};

type SubjectSummary = {
  subject: string;
  total: number;
  exact: number;
  high: number;
  review: number;
  grades: Record<string, number>;
};

type SentenceHighlight = {
  text: string;
  level: "none" | "similar" | "exact";
  score: number;
  matchedText: string;
  /** 반대쪽에서 짝이 되는 문장의 번호. 마우스를 올렸을 때 같이 표시하는 데 쓴다. */
  matchedIndex: number;
};

type DiffSegment = {
  text: string;
  changed: boolean;
};

const PAGE_SIZE = 30;
/** 유사도 비교 중 이 시간(ms)을 넘기면 화면 갱신을 위해 제어권을 넘긴다. */
const YIELD_INTERVAL_MS = 50;
const HEADER_TEXT = "세부능력 및 특기사항";
const ACCEPTED_EXTENSIONS = [".xls", ".xlsx", ".xlsm", ".xlsb", ".pdf"];
const INSPECTION_TYPES: InspectionIssueType[] = [
  "typo",
  "symbol",
  "prohibited",
  "institution",
  "business",
];

/**
 * 오래 걸리는 처리 중간에 브라우저에 제어권을 넘긴다.
 * requestAnimationFrame은 탭이 뒤로 가면 아예 멈춰서, 파일을 올려 두고 다른 탭을 보면
 * 진행이 그대로 멈춘다. setTimeout은 느려질 뿐 멈추지는 않는다.
 */
function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** 확인 표시 저장용 짧은 해시(djb2). 보안 용도가 아니라 열쇠 만들기용이다. */
function contentHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function checkKeyOf(
  record: Pick<CheckRecord, "name" | "className" | "subject" | "normalizedText">,
) {
  return contentHash(
    `${record.name}|${record.className}|${record.subject}|${record.normalizedText}`,
  );
}

const CHECKED_STORAGE_KEY = "recordlens-checked-v1";
/** 브라우저 저장소가 한없이 커지지 않도록 최근 확인 표시만 남긴다. */
const CHECKED_STORAGE_LIMIT = 50000;
/** 예외 처리한 지적도 같은 방식으로 내용 기반 열쇠로 저장해 재업로드에도 유지한다. */
const EXCEPTION_STORAGE_KEY = "recordlens-exceptions-v1";

function issueKeyOf(record: Pick<CheckRecord, "checkKey">, issue: InspectionIssue) {
  return `${record.checkKey}|${issue.type}|${issue.index}|${issue.match}`;
}

function loadStoredKeys(storageKey: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function saveStoredKeys(storageKey: string, keys: Set<string>) {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([...keys].slice(-CHECKED_STORAGE_LIMIT)),
    );
  } catch {
    // 저장소를 못 쓰는 환경(시크릿 창 등)에서는 이번 화면 안에서만 유지된다.
  }
}

function loadCheckedKeys(): Set<string> {
  return loadStoredKeys(CHECKED_STORAGE_KEY);
}

function saveCheckedKeys(keys: Set<string>) {
  saveStoredKeys(CHECKED_STORAGE_KEY, keys);
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString("ko-KR");
  return String(value).replace(/\u0000/g, "").trim();
}

function cleanVisibleText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return cleanVisibleText(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[.,!?()[\]/\-_&@#$%^]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, "").replace(/[()]/g, "");
}

/** 빈 행이나 짧은 행이 섞여 있어도 항상 같은 길이의 문자열 배열을 돌려준다. */
function rowCells(rows: unknown[][], rowIndex: number, length: number) {
  const row = rows[rowIndex] ?? [];
  return Array.from({ length }, (_, column) => cellText(row[column]));
}

function findHeaderIndex(headers: string[], candidates: string[]) {
  return headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    return candidates.some((candidate) => normalized.includes(candidate));
  });
}

function classLabel(value: string) {
  const match = value.match(/(\d+)\s*학년[\s\S]*?(\d+)\s*반/);
  return match ? `${match[1]}학년 ${match[2]}반` : cleanVisibleText(value);
}

function gradeFromClass(value: string) {
  const match = value.match(/(\d+)\s*학년/);
  return match ? `${match[1]}학년` : "";
}

function preprocessRows(rows: unknown[][], sourceFile: string): SourceRow[] {
  const prepared: SourceRow[] = rows.map((_, index) => ({
    cells: ["", ...rowCells(rows, index, 6)],
    sourceFile,
    sourceRow: index + 1,
  }));

  let currentClass = "";
  for (const row of prepared) {
    const classCandidate = row.cells[1];
    if (/\d+\s*학년[\s\S]*?\d+\s*반/.test(classCandidate)) {
      currentClass = classLabel(classCandidate);
    }
    if (row.sourceRow > 1 && currentClass) row.cells[0] = currentClass;
  }

  let lastNumericD = "";
  for (let index = 1; index < prepared.length; index += 1) {
    const cells = prepared[index].cells;
    const previous = prepared[index - 1].cells;

    if (!cells[4]) cells[4] = previous[4];
    if (!cells[5]) cells[5] = previous[5];

    if (cells[3] && Number.isFinite(Number(cells[3])) && !cells[3].includes("학기")) {
      lastNumericD = cells[3];
    } else if (lastNumericD) {
      cells[3] = lastNumericD;
    }
  }

  for (let index = 1; index < prepared.length; index += 1) {
    const cells = prepared[index].cells;
    const previous = prepared[index - 1].cells;

    if (cells[1].trim().length === 1 && index > 3) {
      const upper = prepared[index - 4].cells[1].trim();
      if (upper) {
        const merged = `${upper}${cells[1].trim()}`;
        prepared[index - 4].cells[1] = merged;
        cells[1] = merged;
      }
    }

    if (!cells[1]) cells[1] = previous[1];
    if (!cells[2]) cells[2] = previous[2];

    const key = `${cells[2]}|${cells[3]}|${cells[4]}`;
    for (let prior = index - 1; prior >= Math.max(0, index - 5); prior -= 1) {
      const priorCells = prepared[prior].cells;
      const priorKey = `${priorCells[2]}|${priorCells[3]}|${priorCells[4]}`;
      if (key === priorKey && priorCells[5]) {
        cells[5] = priorCells[5];
        break;
      }
    }
  }

  return prepared;
}

function isNeisExport(rows: unknown[][]) {
  return rows.some((_, rowIndex) => {
    const values = rowCells(rows, rowIndex, 4);
    return (
      normalizeHeader(values[0]).includes("번호") &&
      normalizeHeader(values[1]).includes("성명") &&
      normalizeHeader(values[2]).includes("학년") &&
      normalizeHeader(values[3]).includes(normalizeHeader(HEADER_TEXT))
    );
  });
}

function parseNeisRows(rows: unknown[][], sourceFile: string): CheckRecord[] {
  const subjects = subjectNamesFromTexts(
    rows.map((_, rowIndex) => rowCells(rows, rowIndex, 4)[3]),
  );
  const records = new Map<
    string,
    {
      className: string;
      grade: string;
      subject: string;
      name: string;
      number: string;
      text: string;
      sourceRow: number;
    }
  >();

  let currentClass = "";
  let currentNumber = "";
  let currentName = "";
  let currentGrade = "";
  let currentSubject = "";

  const appendChunk = (subject: string, chunk: string, sourceRow: number, startSubject: boolean) => {
    const cleanChunk = cleanVisibleText(chunk);
    if (!cleanChunk || !currentName) return;
    const safeSubject = subject || "과목 미상";
    const key = [currentClass, currentNumber, currentName, currentGrade, safeSubject].join("|");
    const existing = records.get(key);
    const content = startSubject ? `${safeSubject}: ${cleanChunk}` : cleanChunk;
    if (existing) {
      // 나이스는 쪽이 바뀌면 같은 학생 행을 다시 내려주는데, 이때 내용 일부나 전체가
      // 다시 오기도 한다. 줄바꿈 자리의 공백 차이 때문에 문자열 그대로는 같은 내용을
      // 못 알아볼 수 있어, 공백을 무시하고 포함 여부를 본다. (내용이 통째로 두 번
      // 붙는 사고를 막는다.)
      const spaceless = (value: string) => value.replace(/\s+/g, "");
      if (!spaceless(existing.text).includes(spaceless(cleanChunk))) {
        existing.text = `${existing.text} ${cleanChunk}`.trim();
      }
    } else {
      records.set(key, {
        className: currentClass || "학급 미상",
        grade: currentGrade || gradeFromClass(currentClass) || "학년 미상",
        subject: safeSubject,
        name: currentName,
        number: currentNumber,
        text: content,
        sourceRow,
      });
    }
  };

  rows.forEach((_, rowIndex) => {
    const row = rowCells(rows, rowIndex, 12);
    const firstCell = row[0];
    const detail = cleanVisibleText(row[3]);

    if (/^\d+\s*학년\s*\d+\s*반/.test(firstCell)) {
      currentClass = classLabel(firstCell);
      return;
    }
    if (
      normalizeHeader(row[0]).includes("번호") &&
      normalizeHeader(row[1]).includes("성명") &&
      normalizeHeader(row[2]).includes("학년")
    ) {
      return;
    }
    if (row[8] && row[9] === "/" && row[10]) return;
    if (!detail || detail.includes(HEADER_TEXT)) return;

    const nextName = cleanVisibleText(row[1]);
    const nextNumber = cleanVisibleText(row[0]);
    if (nextName && nextName !== currentName) {
      currentName = nextName;
      currentGrade = "";
      currentSubject = "";
    }
    if (nextNumber) currentNumber = nextNumber;

    const gradeValue = cleanVisibleText(row[2]);
    if (/^[1-3]$/.test(gradeValue)) currentGrade = `${gradeValue}학년`;

    const { leading, segments } = splitSubjectSegments(detail, subjects);
    if (!segments.length) {
      appendChunk(currentSubject, detail, rowIndex + 1, false);
      return;
    }

    if (leading) appendChunk(currentSubject, leading, rowIndex + 1, false);

    for (const segment of segments) {
      currentSubject = segment.subject;
      appendChunk(segment.subject, segment.body, rowIndex + 1, true);
    }
  });

  return [...records.values()]
    .filter((record) => record.text.length > 3)
    .map((record, index) => {
      const normalizedText = normalizeText(record.text);
      return {
        id: `neis-${index}-${record.sourceRow}`,
        className: record.className,
        grade: record.grade,
        subject: record.subject,
        number: record.number,
        name: record.name,
        text: record.text,
        sourceFile,
        sourceRow: record.sourceRow,
        rawCells: [
          record.className,
          record.number,
          record.grade,
          "",
          record.subject,
          record.name,
          record.text,
        ],
        normalizedText,
        tokens: [...new Set(normalizedText.split(" ").filter(Boolean))],
        similarity: 0,
        matchId: null,
        matchName: "",
        matchText: "",
        exactGroupSize: 1,
        recordType: "subject",
        issues: inspectRecordText(record.text),
        checkKey: "",
      };
    });
}

/**
 * 학교생활기록부 PDF에서 뽑아낸 학생별 세특 덩어리를 과목별 기록으로 나눈다.
 * 과목 분할은 엑셀과 같은 규칙을 쓴다.
 */
async function makePdfCheckRecords(
  file: File,
  onProgress: (done: number, total: number) => void,
): Promise<CheckRecord[]> {
  const { parseStudentRecordPdf } = await import("./pdf-records");
  const students = await parseStudentRecordPdf(file, async (done, total) => {
    onProgress(done, total);
    // 쪽 수가 많아 화면이 멈춘 것처럼 보이지 않도록 이따금 제어권을 넘긴다.
    if (done % 20 === 0) {
      await yieldToBrowser();
    }
  });

  const subjects = subjectNamesFromTexts(students.map((student) => student.text));
  const records: CheckRecord[] = [];

  for (const student of students) {
    const { leading, segments } = splitSubjectSegments(student.text, subjects);
    const chunks = segments.length
      ? segments
      : [{ subject: "과목 미상", body: leading || student.text }];

    for (const chunk of chunks) {
      const text = cleanVisibleText(
        chunk.subject === "과목 미상" ? chunk.body : `${chunk.subject}: ${chunk.body}`,
      );
      if (text.length <= 3) continue;
      const normalizedText = normalizeText(text);
      records.push({
        id: `pdf-${records.length}-${student.sourcePage}`,
        className: student.className,
        grade: student.grade,
        subject: chunk.subject,
        number: student.number,
        name: student.name,
        text,
        sourceFile: file.name,
        sourceRow: student.sourcePage,
        rawCells: [
          student.className,
          student.number,
          student.grade,
          "",
          chunk.subject,
          student.name,
          text,
        ],
        normalizedText,
        tokens: [...new Set(normalizedText.split(" ").filter(Boolean))],
        similarity: 0,
        matchId: null,
        matchName: "",
        matchText: "",
        exactGroupSize: 1,
        recordType: "subject",
        issues: inspectRecordText(text),
        checkKey: "",
      });
    }
  }

  return records;
}

function makeCreativeCheckRecords(rows: unknown[][], sourceFile: string): CheckRecord[] {
  return parseCreativeActivityRows(rows).map((record, index) => {
    const normalizedText = normalizeText(record.text);
    return {
      id: `creative-${index}-${record.sourceRow}`,
      className: record.className,
      grade: record.grade,
      subject: record.activity,
      number: record.number,
      name: record.name,
      text: record.text,
      sourceFile,
      sourceRow: record.sourceRow,
      rawCells: [
        record.className,
        record.number,
        record.grade,
        "",
        record.activity,
        record.name,
        record.text,
      ],
      normalizedText,
      tokens: [...new Set(normalizedText.split(" ").filter(Boolean))],
      similarity: 0,
      matchId: null,
      matchName: "",
      matchText: "",
      exactGroupSize: 1,
      recordType: "creative" as const,
      issues: inspectRecordText(record.text),
      checkKey: "",
    };
  });
}

function mergeCheckRecords(records: CheckRecord[]) {
  const merged = new Map<string, CheckRecord>();

  for (const record of records) {
    // 학생 번호를 반드시 포함한다. 번호가 빠지면 같은 학급·과목의 동명이인이 한 건으로
    // 합쳐져, 두 사람의 기록이 완전히 같아도 `완전 일치`로 잡히지 않는다.
    const key = [
      record.recordType,
      record.className,
      record.grade,
      record.subject,
      record.number,
      record.name,
    ].join("|");
    const existing = merged.get(key);
    if (existing) {
      if (!existing.text.includes(record.text)) {
        existing.text = `${existing.text} ${record.text}`.trim();
      }
    } else {
      merged.set(key, { ...record });
    }
  }

  return [...merged.values()].map((record, index) => {
    const normalizedText = normalizeText(record.text);
    return {
      ...record,
      id: `record-${index}`,
      normalizedText,
      tokens: [...new Set(normalizedText.split(" ").filter(Boolean))],
      issues: inspectRecordText(record.text),
      checkKey: "",
    };
  });
}

function makeRecords(sourceRows: SourceRow[]) {
  const headerRow = sourceRows.find((row) => row.cells[6].includes(HEADER_TEXT));
  const headers = headerRow?.cells ?? [
    "학년 반",
    "",
    "학 년",
    "",
    "과 목",
    "이름",
    HEADER_TEXT,
  ];

  const gradeIndex = findHeaderIndex(headers, ["학년"]);
  const subjectIndex = findHeaderIndex(headers, ["과목"]);
  const nameIndex = findHeaderIndex(headers, ["이름", "성명", "학생명"]);
  const mergedByKey = new Map<string, SourceRow>();

  for (const row of sourceRows) {
    const cells = row.cells.map(cleanVisibleText);
    const detail = cells[6];
    if (!detail || detail.includes(HEADER_TEXT)) continue;
    if (/\d+\s*학년[\s\S]*?\d+\s*반/.test(cells[1]) && detail.length < 12) continue;

    const key = cells.slice(0, 6).join("|");
    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, { ...row, cells });
    } else if (!existing.cells[6].includes(detail)) {
      existing.cells[6] = `${existing.cells[6]} ${detail}`.trim();
    }
  }

  return [...mergedByKey.values()]
    .map<CheckRecord>((row, index) => {
      const cells = row.cells;
      const className = classLabel(cells[0]);
      const grade =
        (gradeIndex >= 0 ? cells[gradeIndex] : "") || gradeFromClass(className) || cells[2];
      const subject = (subjectIndex >= 0 ? cells[subjectIndex] : "") || cells[4] || "과목 미상";
      const name = (nameIndex >= 0 ? cells[nameIndex] : "") || cells[5] || "이름 미상";
      const numberCandidate = cleanVisibleText(cells[1] ?? "");
      const text = cells[6];
      const normalizedText = normalizeText(text);

      return {
        id: `record-${index}-${row.sourceRow}`,
        className: className || "학급 미상",
        grade: cleanVisibleText(grade) || "학년 미상",
        subject: cleanVisibleText(subject) || "과목 미상",
        number: /^\d+$/.test(numberCandidate) ? numberCandidate : "",
        name: cleanVisibleText(name) || "이름 미상",
        text,
        sourceFile: row.sourceFile,
        sourceRow: row.sourceRow,
        rawCells: cells,
        normalizedText,
        tokens: [...new Set(normalizedText.split(" ").filter(Boolean))],
        similarity: 0,
        matchId: null,
        matchName: "",
        matchText: "",
        exactGroupSize: 1,
        recordType: "subject",
        issues: inspectRecordText(text),
        checkKey: "",
      };
    })
    .filter((record) => record.normalizedText.length > 0 && record.text.length > 3);
}

async function analyzeSimilarity(
  records: CheckRecord[],
  onProgress: (value: number) => void,
) {
  const exactGroups = new Map<string, number[]>();
  const postings = new Map<string, number[]>();

  records.forEach((record, index) => {
    const group = exactGroups.get(record.normalizedText) ?? [];
    group.push(index);
    exactGroups.set(record.normalizedText, group);

    for (const token of record.tokens) {
      const list = postings.get(token) ?? [];
      list.push(index);
      postings.set(token, list);
    }
  });

  const analyzed = records.map((record) => ({ ...record }));

  // 큰 파일에서도 브라우저가 멈춘 것처럼 보이지 않도록, 고정된 건수마다가 아니라
  // 경과 시간 기준으로 제어권을 넘긴다. 유사도 계산 자체는 바꾸지 않는다.
  let lastYield = performance.now();

  for (let index = 0; index < analyzed.length; index += 1) {
    const record = analyzed[index];
    const exactMatches = exactGroups.get(record.normalizedText) ?? [];
    record.exactGroupSize = exactMatches.length;

    let bestIndex = exactMatches.find((candidate) => candidate !== index) ?? -1;
    let bestSimilarity = bestIndex >= 0 ? 1 : 0;

    if (bestIndex < 0) {
      const intersections = new Map<number, number>();
      for (const token of record.tokens) {
        for (const candidate of postings.get(token) ?? []) {
          if (candidate === index) continue;
          intersections.set(candidate, (intersections.get(candidate) ?? 0) + 1);
        }
      }

      for (const [candidate, intersection] of intersections) {
        const union = record.tokens.length + analyzed[candidate].tokens.length - intersection;
        const similarity = union > 0 ? intersection / union : 0;
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestIndex = candidate;
        }
      }
    }

    record.similarity = bestSimilarity;
    if (bestIndex >= 0) {
      record.matchId = analyzed[bestIndex].id;
      record.matchName = analyzed[bestIndex].name;
      record.matchText = analyzed[bestIndex].text;
    }

    const isLast = index === analyzed.length - 1;
    if (isLast || performance.now() - lastYield >= YIELD_INTERVAL_MS) {
      onProgress(Math.round(((index + 1) / Math.max(1, analyzed.length)) * 100));
      await yieldToBrowser();
      lastYield = performance.now();
    }
  }

  return analyzed;
}

function riskStatus(record: CheckRecord, threshold: number): RiskStatus {
  if (record.exactGroupSize > 1 || record.similarity >= 0.9995) return "exact";
  if (record.similarity >= threshold) return "high";
  // `~`(기간), `→`(과정)는 세특에 매우 흔해, 특수기호만으로 위험도를 올리면 대부분의
  // 기록이 `확인 필요`가 되어 등급이 의미를 잃는다. 특수기호는 전용 필터로만 찾는다.
  const meaningfulIssue = record.issues.some((issue) => issue.type !== "symbol");
  if (meaningfulIssue || record.similarity >= Math.max(0.45, threshold - 0.2)) return "review";
  return "normal";
}

function riskLabel(status: RiskStatus) {
  return {
    exact: "완전 일치",
    high: "높은 유사도",
    review: "확인 필요",
    normal: "이상 없음",
  }[status];
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function makeDemoRecords(): CheckRecord[] {
  const samples = [
    ["1학년 1반", "1학년", "국어", "김○○", "작품 속 인물의 선택을 근거로 주제를 설명하고 모둠 토의에서 자신의 의견을 논리적으로 발표함."],
    ["1학년 2반", "1학년", "국어", "이○○", "작품 속 인물의 선택을 근거로 주제를 설명하고 모둠 토의에서 자신의 의견을 논리적으로 발표함."],
    ["1학년 3반", "1학년", "국어", "박○○", "작품 속 인물의 행동을 근거로 주제를 해석하고 모둠 토의에서 의견을 논리적으로 제시함."],
    ["2학년 1반", "2학년", "수학", "최○○", "이차함수의 그래프 성질을 탐구하고 풀이 과정을 단계별로 정리하여 친구들에게 설명함."],
    ["2학년 2반", "2학년", "수학", "정○○", "이차함수 그래프의 성질을 탐구하고 문제 풀이 과정을 단계적으로 정리해 설명함."],
    ["2학년 3반", "2학년", "영어", "윤○○", "영어 기사에서 핵심 정보를 찾아 요약하고 환경 문제에 대한 자신의 의견을 명확하게 표현함."],
    ["3학년 1반", "3학년", "과학", "장○○", "실험 변인을 통제해 결과를 분석하고 오차 원인을 찾아 후속 탐구 방법을 제안함."],
    ["3학년 2반", "3학년", "사회", "한○○", "지역 문제의 원인을 다양한 자료로 분석하고 공동체 관점의 해결 방안을 제안함."],
    // 기재요령 보조 점검이 어떻게 표시되는지 보여주는 예시. 어학시험·기관명·특수기호를 일부러 담았다.
    ["3학년 3반", "3학년", "진로와 직업", "서○○", "토익 성적 향상을 목표로 학습 계획을 세우고, 통계청 자료를 인용하여 지역 인구 변화를 분석함. ① 자료 수집 ② 해석 순서로 보고서를 정리함."],
  ];

  return samples.map((sample, index) => {
    const text = sample[4];
    const number = `${index + 1}`;
    const normalizedText = normalizeText(text);
    return {
      id: `demo-${index}`,
      className: sample[0],
      grade: sample[1],
      subject: sample[2],
      number,
      name: sample[3],
      text,
      sourceFile: "익명 예시 자료.xlsx",
      sourceRow: index + 5,
      rawCells: [sample[0], number, sample[1], "", sample[2], sample[3], text],
      normalizedText,
      tokens: [...new Set(normalizedText.split(" ").filter(Boolean))],
      similarity: 0,
      matchId: null,
      matchName: "",
      matchText: "",
      exactGroupSize: 1,
      recordType: "subject",
      issues: inspectRecordText(text),
      checkKey: "",
    };
  });
}

function sharedKeywords(record: CheckRecord) {
  if (!record.matchText) return [];
  const other = new Set(normalizeText(record.matchText).split(" "));
  return record.tokens.filter((token) => token.length > 1 && other.has(token)).slice(0, 18);
}

function sharedKeywordCount(record: CheckRecord) {
  if (!record.matchText) return 0;
  const other = new Set(normalizeText(record.matchText).split(" "));
  return record.tokens.filter((token) => token.length > 1 && other.has(token)).length;
}

function splitSentences(value: string) {
  return value.match(/[^.!?。！？]+[.!?。！？]?\s*/g)?.filter((part) => part.trim()) ?? [value];
}

function sentenceSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeText(left).split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(normalizeText(right).split(" ").filter((token) => token.length > 1));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = leftTokens.size + rightTokens.size - intersection;
  return {
    score: union > 0 ? intersection / union : 0,
    intersection,
  };
}

function highlightSentences(text: string, comparisonText: string): SentenceHighlight[] {
  const comparisonSentences = splitSentences(comparisonText);

  return splitSentences(text).map((sentence) => {
    const normalized = normalizeText(sentence);
    let bestScore = 0;
    let bestIntersection = 0;
    let matchedIndex = -1;
    let exact = false;

    for (let index = 0; index < comparisonSentences.length; index += 1) {
      const candidate = comparisonSentences[index];
      const candidateNormalized = normalizeText(candidate);
      if (normalized.length >= 8 && normalized === candidateNormalized) {
        exact = true;
        bestScore = 1;
        matchedIndex = index;
        break;
      }

      const result = sentenceSimilarity(sentence, candidate);
      if (result.score > bestScore) {
        bestScore = result.score;
        bestIntersection = result.intersection;
        matchedIndex = index;
      }
    }

    return {
      text: sentence,
      level: exact ? "exact" : bestScore >= 0.5 && bestIntersection >= 3 ? "similar" : "none",
      score: bestScore,
      matchedText: matchedIndex >= 0 ? comparisonSentences[matchedIndex] : "",
      matchedIndex,
    };
  });
}

/** 비교 기록과 100% 같은 문장의 수. 유사도 요약에 함께 보여 준다. */
function exactSentenceCount(record: CheckRecord): number {
  if (!record.matchText) return 0;
  return highlightSentences(record.text, record.matchText).filter(
    (sentence) => sentence.level === "exact",
  ).length;
}

/**
 * 전체 기록에서 문장이 몇 개의 기록에 나오는지 센다.
 * 짝 비교(최대 유사도)로는 한 문장이 여러 기록에 돌려쓰인 규모가 안 보이므로,
 * 정규화한 문장 단위로 따로 집계한다. 너무 짧은 문장은 우연히 겹쳐 제외한다.
 */
function buildSentenceReuseCounts(records: CheckRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const seen = new Set<string>();
    for (const sentence of splitSentences(record.text)) {
      const normalized = normalizeText(sentence);
      if (normalized.length < 8 || seen.has(normalized)) continue;
      seen.add(normalized);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return counts;
}

type ReusedSentence = { text: string; count: number };

/** 이 기록의 문장 중 다른 기록에도 그대로 나온 것들. 많이 쓰인 순서로 최대 8개. */
function reusedSentencesOf(
  record: CheckRecord,
  counts: Map<string, number>,
): ReusedSentence[] {
  const seen = new Set<string>();
  const out: ReusedSentence[] = [];
  for (const sentence of splitSentences(record.text)) {
    const normalized = normalizeText(sentence);
    if (normalized.length < 8 || seen.has(normalized)) continue;
    seen.add(normalized);
    const count = counts.get(normalized) ?? 0;
    if (count >= 2) out.push({ text: sentence.trim(), count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 8);
}

function diffSegments(text: string, comparisonText: string): DiffSegment[] {
  const tokenize = (value: string) =>
    value.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}\s]+|\s+/gu) ?? [value];
  const normalizeToken = (value: string) =>
    /[\p{L}\p{N}]/u.test(value) ? value.normalize("NFKC").toLocaleLowerCase("ko-KR") : "";

  const tokens = tokenize(text);
  const comparisonTokens = tokenize(comparisonText);
  const words = tokens
    .map((token, tokenIndex) => ({ tokenIndex, normalized: normalizeToken(token) }))
    .filter((token) => token.normalized);
  const comparisonWords = comparisonTokens
    .map((token, tokenIndex) => ({ tokenIndex, normalized: normalizeToken(token) }))
    .filter((token) => token.normalized);

  const lengths = Array.from({ length: words.length + 1 }, () =>
    Array<number>(comparisonWords.length + 1).fill(0),
  );

  for (let leftIndex = 1; leftIndex <= words.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= comparisonWords.length; rightIndex += 1) {
      lengths[leftIndex][rightIndex] =
        words[leftIndex - 1].normalized === comparisonWords[rightIndex - 1].normalized
          ? lengths[leftIndex - 1][rightIndex - 1] + 1
          : Math.max(lengths[leftIndex - 1][rightIndex], lengths[leftIndex][rightIndex - 1]);
    }
  }

  const unchangedTokenIndexes = new Set<number>();
  let leftIndex = words.length;
  let rightIndex = comparisonWords.length;
  while (leftIndex > 0 && rightIndex > 0) {
    if (words[leftIndex - 1].normalized === comparisonWords[rightIndex - 1].normalized) {
      unchangedTokenIndexes.add(words[leftIndex - 1].tokenIndex);
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (lengths[leftIndex - 1][rightIndex] >= lengths[leftIndex][rightIndex - 1]) {
      leftIndex -= 1;
    } else {
      rightIndex -= 1;
    }
  }

  return tokens.reduce<DiffSegment[]>((segments, token, tokenIndex) => {
    const normalized = normalizeToken(token);
    const changed = Boolean(normalized) && !unchangedTokenIndexes.has(tokenIndex);
    const previous = segments.at(-1);
    if (previous && previous.changed === changed) {
      previous.text += token;
    } else {
      segments.push({ text: token, changed });
    }
    return segments;
  }, []);
}

function HighlightedComparisonText({
  text,
  comparisonText,
  /**
   * 양쪽에서 같은 문장을 함께 표시하기 위한 짝 번호를 어디서 가져올지.
   * A쪽(`match`)은 짝이 되는 B 문장 번호를, B쪽(`self`)은 자기 번호를 쓴다.
   */
  pairFrom,
}: {
  text: string;
  comparisonText: string;
  pairFrom: "match" | "self";
}) {
  return (
    <p className="comparison-text">
      {highlightSentences(text, comparisonText).map((sentence, index) => {
        if (sentence.level === "none") {
          return <span key={`${index}-${sentence.text}`}>{sentence.text}</span>;
        }

        const label = sentence.level === "exact" ? "완전 일치" : "높은 유사도";
        const pair = `p${pairFrom === "match" ? sentence.matchedIndex : index}`;
        if (sentence.level === "similar") {
          return (
            <span
              className="sentence-highlight similar"
              data-pair={pair}
              key={`${index}-${sentence.text}`}
              title={`${label} ${formatPercent(sentence.score)} · 같은 부분은 음영, 다른 부분은 붉은 글자`}
            >
              {diffSegments(sentence.text, sentence.matchedText).map((segment, segmentIndex) =>
                segment.changed ? (
                  <span className="diff-fragment" key={`${segmentIndex}-${segment.text}`}>
                    {segment.text}
                  </span>
                ) : /[\p{L}\p{N}]/u.test(segment.text) ? (
                  <mark className="common-fragment" key={`${segmentIndex}-${segment.text}`}>
                    {segment.text}
                  </mark>
                ) : (
                  <span key={`${segmentIndex}-${segment.text}`}>{segment.text}</span>
                ),
              )}
            </span>
          );
        }

        return (
          <mark
            className={`sentence-highlight ${sentence.level}`}
            data-pair={pair}
            key={`${index}-${sentence.text}`}
            title={`${label} ${formatPercent(sentence.score)}`}
          >
            {sentence.text}
          </mark>
        );
      })}
    </p>
  );
}

/**
 * 문장에 마우스를 올리면 양쪽 기록에서 짝이 되는 문장을 함께 표시한다.
 * 같은 `data-pair` 값을 가진 문장에 표시용 클래스를 붙였다 뗀다.
 */
function linkPair(event: React.MouseEvent<HTMLDivElement>) {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-pair]");
  if (!target) return;
  const pair = target.dataset.pair;
  if (!pair) return;
  for (const node of event.currentTarget.querySelectorAll(`[data-pair="${pair}"]`)) {
    node.classList.add("pair-active");
  }
}

function clearPair(event: React.MouseEvent<HTMLDivElement>) {
  for (const node of event.currentTarget.querySelectorAll(".pair-active")) {
    node.classList.remove("pair-active");
  }
}

function inspectionSegments(text: string, issues: InspectionIssue[]) {
  const candidates = [...issues]
    .filter(
      (issue) =>
        issue.index >= 0 &&
        issue.index < text.length &&
        issue.match.length > 0 &&
        issue.index + issue.match.length <= text.length,
    )
    .sort(
      (left, right) =>
        left.index - right.index ||
        Number(right.severity === "danger") - Number(left.severity === "danger") ||
        right.match.length - left.match.length,
    );
  const segments: Array<{ text: string; issue?: InspectionIssue }> = [];
  let cursor = 0;

  for (const issue of candidates) {
    const start = issue.index;
    const end = start + issue.match.length;
    if (start < cursor) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: text.slice(start, end), issue });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

function InspectionHighlightedText({
  text,
  issues,
}: {
  text: string;
  issues: InspectionIssue[];
}) {
  return (
    <>
      {inspectionSegments(text, issues).map((segment, index) =>
        segment.issue ? (
          <mark
            className={`inspection-text-highlight ${segment.issue.type}`}
            key={`${index}-${segment.issue.type}-${segment.text}`}
            title={`${segment.issue.label}: ${segment.issue.guidance}`}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={`${index}-${segment.text}`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * 저장한 HTML은 인터넷 없이 열리므로 로고를 파일 안에 직접 담아야 한다.
 * 이미 화면에 떠 있는 이미지를 캔버스로 축소해 data URI로 바꾼다.
 * 어떤 이유로든 실패하면 글자 로고로 물러난다.
 */
function brandMarkDataUri(size = 72) {
  if (typeof document === "undefined") return "";
  const source = document.querySelector<HTMLImageElement>("img.brand-mark");
  if (!source || !source.complete || !source.naturalWidth) return "";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.drawImage(source, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [consented, setConsented] = useState(false);
  const [threshold, setThreshold] = useState(0.7);
  const [records, setRecords] = useState<CheckRecord[]>([]);
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | RiskStatus>("all");
  const [issueFilter, setIssueFilter] = useState<"all" | InspectionIssueType>("all");
  /** 학급별·과목(활동 영역)별로 골라 보는 필터. "all"은 전체. */
  const [classFilter, setClassFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("risk");
  const [page, setPage] = useState(1);
  const [selectedRecord, setSelectedRecord] = useState<CheckRecord | null>(null);
  const [reportTime, setReportTime] = useState("");
  /**
   * 담당자가 눈으로 확인을 끝낸 기록. 내용 기반 열쇠로 저장해 재업로드에도 유지된다.
   * 확인 표시는 기록이 표시된 뒤에만 화면에 나타나므로(첫 그리기는 항상 빈 목록),
   * 첫 그리기에서 저장소를 읽어도 서버 렌더와 어긋나지 않는다.
   */
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : loadCheckedKeys(),
  );
  const [hideChecked, setHideChecked] = useState(false);
  /** 예외 처리 버튼으로 걸러낸 지적. 내용 기반 열쇠라 재업로드에도 유지된다. */
  const [exceptedKeys, setExceptedKeys] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : loadStoredKeys(EXCEPTION_STORAGE_KEY),
  );

  function toggleChecked(key: string, force?: boolean) {
    setCheckedKeys((previous) => {
      const next = new Set(previous);
      const shouldCheck = force ?? !next.has(key);
      if (shouldCheck) next.add(key);
      else next.delete(key);
      saveCheckedKeys(next);
      return next;
    });
  }

  function toggleException(key: string) {
    setExceptedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveStoredKeys(EXCEPTION_STORAGE_KEY, next);
      return next;
    });
  }

  /**
   * 예외 처리한 지적을 걸러낸 화면용 기록. 표·집계·상세 창·내보내기가 모두 이걸 쓴다.
   * 원본 records 는 그대로 두어 예외를 해제하면 즉시 되살아난다.
   */
  const effectiveRecords = useMemo(() => {
    if (!exceptedKeys.size) return records;
    return records.map((record) => {
      if (!record.issues.length) return record;
      const kept: InspectionIssue[] = [];
      const excepted: InspectionIssue[] = [];
      for (const issue of record.issues) {
        if (exceptedKeys.has(issueKeyOf(record, issue))) excepted.push(issue);
        else kept.push(issue);
      }
      if (!excepted.length) return record;
      return { ...record, issues: kept, exceptedIssues: excepted };
    });
  }, [records, exceptedKeys]);

  const counts = useMemo(() => {
    const initial = { exact: 0, high: 0, review: 0, normal: 0 };
    return effectiveRecords.reduce((accumulator, record) => {
      accumulator[riskStatus(record, threshold)] += 1;
      return accumulator;
    }, initial);
  }, [effectiveRecords, threshold]);

  /** 문장별 재사용 집계. 상세 창에서 `이 문장이 몇 개 기록에 나오는지`를 보여 준다. */
  const sentenceReuseCounts = useMemo(() => buildSentenceReuseCounts(records), [records]);

  const issueCounts = useMemo(
    () =>
      effectiveRecords.reduce(
        (accumulator, record) => {
          for (const type of new Set(record.issues.map((issue) => issue.type))) {
            accumulator[type] += 1;
          }
          return accumulator;
        },
        { typo: 0, symbol: 0, prohibited: 0, institution: 0, business: 0 } as Record<
          InspectionIssueType,
          number
        >,
      ),
    [effectiveRecords],
  );

  const recordMode: RecordType | "mixed" = records.every(
    (record) => record.recordType === "creative",
  )
    ? "creative"
    : records.every((record) => record.recordType === "subject")
      ? "subject"
      : "mixed";
  const categoryLabel =
    recordMode === "creative" ? "활동 영역" : recordMode === "subject" ? "과목" : "과목 / 활동 영역";
  const contentLabel =
    recordMode === "creative"
      ? "창의적체험활동 특기사항"
      : recordMode === "subject"
        ? "세부능력 및 특기사항"
        : "학생부 특기사항";

  const subjectSummaries = useMemo<SubjectSummary[]>(() => {
    const map = new Map<string, SubjectSummary>();
    for (const record of effectiveRecords) {
      const summary = map.get(record.subject) ?? {
        subject: record.subject,
        total: 0,
        exact: 0,
        high: 0,
        review: 0,
        grades: {},
      };
      const status = riskStatus(record, threshold);
      summary.total += 1;
      if (status !== "normal") summary[status] += 1;
      summary.grades[record.grade] = (summary.grades[record.grade] ?? 0) + 1;
      map.set(record.subject, summary);
    }
    return [...map.values()].sort((a, b) => b.exact + b.high - (a.exact + a.high) || b.total - a.total);
  }, [effectiveRecords, threshold]);

  const classOptions = useMemo(
    () =>
      [...new Set(records.map((record) => record.className))].sort((a, b) =>
        a.localeCompare(b, "ko", { numeric: true }),
      ),
    [records],
  );
  const subjectOptions = useMemo(
    () =>
      [...new Set(records.map((record) => record.subject))].sort((a, b) =>
        a.localeCompare(b, "ko"),
      ),
    [records],
  );

  const filteredRecords = useMemo(() => {
    const term = normalizeText(search);
    const filtered = effectiveRecords.filter((record) => {
      const status = riskStatus(record, threshold);
      if (riskFilter !== "all" && status !== riskFilter) return false;
      if (issueFilter !== "all" && !record.issues.some((issue) => issue.type === issueFilter)) {
        return false;
      }
      if (classFilter !== "all" && record.className !== classFilter) return false;
      if (subjectFilter !== "all" && record.subject !== subjectFilter) return false;
      if (hideChecked && checkedKeys.has(record.checkKey)) return false;
      if (!term) return true;
      return normalizeText(
        `${record.name} ${record.className} ${record.subject} ${record.text} ${record.matchName}`,
      ).includes(term);
    });

    return filtered.sort((a, b) => {
      if (sortMode === "class") {
        // 담당자는 반 순서대로 훑는다. 학급 → 번호 → 과목 순.
        return (
          a.className.localeCompare(b.className, "ko", { numeric: true }) ||
          (Number(a.number) || 0) - (Number(b.number) || 0) ||
          a.subject.localeCompare(b.subject, "ko")
        );
      }
      if (sortMode === "name") return a.name.localeCompare(b.name, "ko");
      if (sortMode === "subject") return a.subject.localeCompare(b.subject, "ko");
      return b.similarity - a.similarity || a.name.localeCompare(b.name, "ko");
    });
  }, [
    checkedKeys,
    classFilter,
    hideChecked,
    issueFilter,
    effectiveRecords,
    riskFilter,
    search,
    sortMode,
    subjectFilter,
    threshold,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const visibleRecords = filteredRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const reviewedCount = useMemo(
    () => records.reduce((sum, record) => sum + (checkedKeys.has(record.checkKey) ? 1 : 0), 0),
    [checkedKeys, records],
  );

  const selectedIndex = selectedRecord
    ? filteredRecords.findIndex((record) => record.id === selectedRecord.id)
    : -1;

  // 예외 처리로 지적 목록이 바뀌면 열린 상세 창에도 바로 반영되도록 최신 기록을 찾는다.
  const activeRecord = selectedRecord
    ? (effectiveRecords.find((record) => record.id === selectedRecord.id) ?? selectedRecord)
    : null;

  /** 상세 창을 닫지 않고 현재 필터·정렬 순서대로 앞뒤 기록을 오간다. */
  function openNeighbor(delta: number) {
    if (selectedIndex < 0) return;
    const next = filteredRecords[selectedIndex + delta];
    if (next) setSelectedRecord(next);
  }

  /** 확인 표시를 남기고 다음 기록으로 넘어간다. 마지막이면 창을 닫는다. */
  function confirmAndAdvance() {
    if (!selectedRecord) return;
    toggleChecked(selectedRecord.checkKey, true);
    // `다음`은 이번 그리기의 목록 기준이므로, 숨기기가 켜져 있어도 올바른 다음 기록이다.
    const next = filteredRecords[selectedIndex + 1];
    setSelectedRecord(next ?? null);
  }

  useEffect(() => {
    if (!selectedRecord) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedRecord(null);
      if (event.key === "ArrowLeft") openNeighbor(-1);
      if (event.key === "ArrowRight") openNeighbor(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // openNeighbor는 selectedRecord·filteredRecords에서 파생되므로 그 둘만 보면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRecord, filteredRecords]);

  function changeThreshold(value: number) {
    setThreshold(value);
    setPage(1);
  }

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function changeRiskFilter(value: "all" | RiskStatus) {
    setRiskFilter(value);
    setPage(1);
  }

  function changeIssueFilter(value: "all" | InspectionIssueType) {
    setIssueFilter(value);
    setPage(1);
  }

  function changeClassFilter(value: string) {
    setClassFilter(value);
    setPage(1);
  }

  function changeSubjectFilter(value: string) {
    setSubjectFilter(value);
    setPage(1);
  }

  function changeSortMode(value: SortMode) {
    setSortMode(value);
    setPage(1);
  }

  async function finishAnalysis(baseRecords: CheckRecord[], files: string[]) {
    if (!baseRecords.length) {
      throw new Error(
        "세부능력 및 특기사항 또는 창의적체험활동 특기사항 데이터를 찾지 못했습니다. 나이스에서 내려받은 파일의 첫 번째 시트 구조를 확인해 주세요.",
      );
    }

    // 확인 표시 열쇠는 병합이 끝난 최종 본문으로 만들어야 같은 파일을 다시 올려도 유지된다.
    const keyed = baseRecords.map((record) => ({ ...record, checkKey: checkKeyOf(record) }));

    // 나이스 입력 한도를 넘는 기록은 표지 없는 개인별 세특 등이 붙어 있다는 신호다.
    for (const record of keyed) {
      const body =
        record.recordType === "subject"
          ? record.text.replace(/^[^:]{1,30}:\s*/, "")
          : record.text;
      const limit =
        record.recordType === "creative" && record.subject === "진로활동" ? 2100 : 1500;
      const overflow = lengthOverflowIssue(body, limit);
      if (overflow) {
        // 본문 위치를 원문(record.text) 기준으로 되돌린다.
        const offset = record.text.length - body.length;
        record.issues = [...record.issues, { ...overflow, index: overflow.index + offset }].sort(
          (a, b) => a.index - b.index,
        );
      }
    }

    // 내장 맞춤법 사전 + 전체 기록 빈도로 오탈자 의심 어절을 찾는다.
    // 사전(약 14MB)은 처음 한 번만 내려받고, 실패하면 이 검사만 건너뛴다.
    // 예시 자료처럼 기록이 적으면 빈도 대조가 의미 없어 실행하지 않는다.
    if (keyed.length >= 30) {
      setProgress({ stage: "cleaning", value: 85, label: "맞춤법 사전으로 오탈자를 찾고 있습니다" });
      try {
        const [{ loadSpellChecker }, { computeSpellingSuspects }] = await Promise.all([
          import("./spell-dictionary"),
          import("./spelling-suspects"),
        ]);
        const spell = await loadSpellChecker();
        if (spell) {
          await yieldToBrowser();
          const suspects = computeSpellingSuspects(
            keyed.map((record) => record.text),
            spell,
          );
          suspects.forEach((hits, index) => {
            if (!hits.length) return;
            keyed[index].issues = [
              ...keyed[index].issues,
              ...hits.map((hit) => ({
                type: "typo" as const,
                label: "오탈자 의심",
                match: hit.match,
                guidance: hit.explanation,
                reference: "맞춤법 사전·빈도 대조",
                severity: "warning" as const,
                index: hit.index,
              })),
            ].sort((a, b) => a.index - b.index);
          });
        }
      } catch {
        // 사전 검사는 보조 기능이다. 실패해도 나머지 점검은 그대로 진행한다.
      }
    }

    setProgress({ stage: "comparing", value: 0, label: "문장 유사도를 비교하고 있습니다" });
    const analyzed = await analyzeSimilarity(keyed, (value) =>
      setProgress({ stage: "comparing", value, label: "문장 유사도를 비교하고 있습니다" }),
    );

    setRecords(analyzed);
    setSourceFiles(files);
    setReportTime(
      new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date()),
    );
    setProgress(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleFiles(fileList: FileList | File[]) {
    setError("");
    const files = Array.from(fileList).filter((file) =>
      ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension)),
    );

    if (!consented) {
      setError("필독 안내를 확인하고 동의해 주세요.");
      return;
    }
    if (!files.length) {
      setError("엑셀(.xls, .xlsx, .xlsm, .xlsb) 또는 학교생활기록부 PDF 파일을 선택해 주세요.");
      return;
    }

    try {
      setProgress({ stage: "reading", value: 5, label: "파일을 안전하게 읽고 있습니다" });
      const sourceRows: SourceRow[] = [];
      const parsedRecords: CheckRecord[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];

        if (file.name.toLowerCase().endsWith(".pdf")) {
          parsedRecords.push(
            ...(await makePdfCheckRecords(file, (done, total) => {
              setProgress({
                stage: "reading",
                value: Math.round(((index + done / Math.max(1, total)) / files.length) * 55),
                label: `${file.name} 읽는 중 (${done}/${total}쪽)`,
              });
            })),
          );
          continue;
        }

        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, {
          type: "array",
          cellDates: true,
          dense: false,
        });
        const sheetName = workbook.SheetNames.includes("Sheet1")
          ? "Sheet1"
          : workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: false,
          defval: "",
        }) as unknown[][];
        if (isCreativeActivityExport(rows)) {
          parsedRecords.push(...makeCreativeCheckRecords(rows, file.name));
        } else if (isNeisExport(rows)) {
          parsedRecords.push(...parseNeisRows(rows, file.name));
        } else {
          sourceRows.push(...preprocessRows(rows, file.name));
        }
        setProgress({
          stage: "reading",
          value: Math.round(((index + 1) / files.length) * 55),
          label: `${file.name} 읽는 중`,
        });
        await yieldToBrowser();
      }

      setProgress({ stage: "cleaning", value: 68, label: "학급·과목·활동 영역을 정리하고 있습니다" });
      await yieldToBrowser();
      const baseRecords = mergeCheckRecords([
        ...parsedRecords,
        ...(sourceRows.length ? makeRecords(sourceRows) : []),
      ]);
      await finishAnalysis(baseRecords, files.map((file) => file.name));
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "파일을 처리하는 중 문제가 발생했습니다.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function loadDemo() {
    setConsented(true);
    setError("");
    try {
      setProgress({ stage: "cleaning", value: 65, label: "익명 예시 자료를 준비하고 있습니다" });
      await finishAnalysis(makeDemoRecords(), ["익명 예시 자료.xlsx"]);
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "예시 자료를 준비하지 못했습니다.");
    }
  }

  function reset() {
    setRecords([]);
    setSourceFiles([]);
    setProgress(null);
    setError("");
    setSearch("");
    setRiskFilter("all");
    setIssueFilter("all");
    setClassFilter("all");
    setSubjectFilter("all");
    setSelectedRecord(null);
    setPage(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function exportWorkbook() {
    setProgress({ stage: "cleaning", value: 60, label: "엑셀 파일을 만들고 있습니다" });
    try {
      const { buildStyledWorkbook } = await import("./export-workbook");
      const gradeNames = [...new Set(effectiveRecords.map((record) => record.grade))].sort(
        (a, b) => a.localeCompare(b, "ko"),
      );
      const blob = await buildStyledWorkbook({
        categoryLabel,
        contentLabel,
        gradeNames,
        generatedAt:
          reportTime ||
          new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short" }).format(
            new Date(),
          ),
        threshold,
        rows: effectiveRecords.map((record) => {
          const status = riskStatus(record, threshold);
          return {
            checked: checkedKeys.has(record.checkKey),
            className: record.className,
            number: record.number,
            name: record.name,
            subject: record.subject,
            text: record.text,
            similarity: record.similarity,
            matchText: record.matchText,
            matchName: record.matchName,
            statusKey: status,
            statusLabel: riskLabel(status),
            issueLabels: [...new Set(record.issues.map((issue) => issue.label))].join(", "),
            issueMatches: record.issues.map((issue) => issue.match).join(", "),
            issueRefs: [...new Set(record.issues.map((issue) => issue.reference))].join(", "),
            sourceFile: record.sourceFile,
            sourceRow: record.sourceRow,
          };
        }),
        summaries: subjectSummaries.map((summary) => ({
          subject: summary.subject,
          grades: gradeNames.map((grade) => summary.grades[grade] ?? 0),
          total: summary.total,
          exact: summary.exact,
          high: summary.high,
          review: summary.review,
        })),
      });

      const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `RecordLENS_종합점검결과_${date}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError("엑셀 파일을 만들지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.");
    } finally {
      setProgress(null);
    }
  }

  function exportHtmlReport() {
    const generatedAt =
      reportTime ||
      new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date());
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    // 저장본은 화면의 현재 필터와 무관하게 모든 기록을 담는다.
    // 걸러 보는 일은 저장된 파일 안에서 다시 할 수 있다.
    // 예외 처리한 지적은 저장 시점 상태 그대로 빠진다.
    const orderedRecords = [...effectiveRecords].sort(
      (a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name, "ko"),
    );
    const checkedCount = counts.exact + counts.high + counts.review;
    const brandIcon = brandMarkDataUri();
    const brandMarkHtml = brandIcon
      ? `<img class="brand-mark" src="${brandIcon}" alt="" width="34" height="34" />`
      : '<span class="brand-mark">✓</span>';

    /*
     * 예전에는 모든 기록의 표 행과 상세 창을 미리 HTML로 만들어 넣었다.
     * 그러면 본문이 기록마다 네 번씩(표 미리보기, 원문 강조, A 비교, B 비교) 복사되고
     * 낱말마다 태그가 붙어, 7,500건 기준 70MB가 넘고 여는 데만 30초가 걸렸다.
     * 이제는 본문을 한 번만 데이터로 담고 화면은 브라우저에서 그린다.
     * 지적 사유처럼 반복되는 문구는 규칙 목록으로 따로 빼 중복을 없앴다.
     */
    const ruleKeys = new Map<string, number>();
    const rules: Array<{ t: string; l: string; g: string; r: string; s: string }> = [];
    const ruleIndex = (issue: InspectionIssue) => {
      const key = `${issue.type}|${issue.label}|${issue.guidance}|${issue.reference}|${issue.severity}`;
      const found = ruleKeys.get(key);
      if (found !== undefined) return found;
      const next = rules.length;
      ruleKeys.set(key, next);
      rules.push({
        t: issue.type,
        l: issue.label,
        g: issue.guidance,
        r: issue.reference,
        s: issue.severity,
      });
      return next;
    };

    const indexById = new Map(orderedRecords.map((record, index) => [record.id, index]));
    const payload = {
      threshold,
      pageSize: PAGE_SIZE,
      categoryLabel,
      contentLabel,
      rules,
      records: orderedRecords.map((record) => ({
        n: record.name,
        c: record.className,
        no: record.number,
        s: record.subject,
        t: record.text,
        // 비교 대상은 번호로만 가리켜 본문이 두 번 저장되지 않게 한다.
        m: record.matchId !== null ? (indexById.get(record.matchId) ?? -1) : -1,
        mn: record.matchName,
        sim: Number(record.similarity.toFixed(6)),
        eg: record.exactGroupSize,
        f: record.sourceFile,
        w: record.sourceRow,
        i: record.issues.map((issue) => [ruleIndex(issue), issue.index, issue.match]),
        k: record.checkKey,
        // 저장 시점의 확인 여부. 저장본 안에서 계속 표시하고 이어서 확인할 수 있다.
        chk: checkedKeys.has(record.checkKey) ? 1 : 0,
      })),
    };
    // `</script>` 가 문자열 안에 들어가도 태그가 끊기지 않도록 막는다.
    const payloadJson = JSON.stringify(payload).replace(/</g, "\\u003c");

    const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Record LENS 종합점검 결과 · ${escapeHtml(generatedAt)}</title>
  <style>
    :root { color-scheme:light; --brand-950:#0e2e2b; --brand-900:#14403b; --brand-800:#1c716c; --brand-700:#23807a; --brand-600:#2e7e7b; --brand-500:#409e97; --brand-400:#5cbaab; --brand-300:#81cfc5; --brand-200:#a8ded6; --brand-100:#c9e8e0; --brand-50:#dcf1eb; --brand-25:#eff8f4; --ink:#12312e; --ink-soft:#3b7871; --line:#d5e8e2; --line-soft:#e3f0ec; --paper:#fdfcf7; --danger:#b8442a; --danger-soft:#fdece6; --warning:#8f6410; --warning-soft:#fbf1d9; --review:#45638f; --review-soft:#eaf0f9; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; background:#f7fbfa; color:var(--ink); font-family:"Pretendard Variable",Pretendard,"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif; line-height:1.7; }
    .topbar { display:flex; align-items:center; justify-content:space-between; min-height:62px; padding:0 max(24px,calc((100% - 1180px)/2)); border-bottom:1px solid rgba(220,228,234,.85); background:rgba(255,255,255,.92); }
    .brand { display:grid; grid-template-columns:34px auto; column-gap:9px; align-items:center; }
    .brand-mark { display:grid; grid-row:1/3; width:34px; height:34px; place-items:center; border-radius:10px; background:var(--brand-900); color:white; font-weight:900; }
    img.brand-mark { display:block; background:none; object-fit:cover; }
    .brand strong { align-self:end; font-size:15px; }
    .brand small { align-self:start; color:#3b7871; font-size:12px; }
    .topbar > span { color:#1c534d; font-size:13px; }
    .topbar .maker-credit { color:var(--brand-800); font-weight:800; }
    .report-main { width:min(1180px,calc(100% - 40px)); margin:0 auto; padding:36px 0 80px; }
    .report-hero { display:flex; align-items:flex-end; justify-content:space-between; gap:30px; padding:28px 0 32px; }
    .eyebrow { color:var(--brand-800); font-size:13px; font-weight:800; }
    .report-hero h1 { margin:12px 0 10px; font-size:clamp(38px, 4vw, 54px); letter-spacing:-.055em; line-height:1.12; }
    .report-hero p { max-width:760px; margin:0; color:var(--ink-soft); font-size:17px; }
    .saved-chip { flex:0 0 auto; padding:13px 17px; border:1px solid #d5e8e2; border-radius:13px; background:white; color:var(--brand-900); font-size:14px; font-weight:800; }
    .summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
    .summary-card { display:grid; grid-template-columns:44px 1fr; grid-template-rows:auto auto auto; column-gap:14px; padding:21px; border:1px solid var(--line); border-radius:17px; background:white; box-shadow:0 8px 30px rgba(21,54,93,.045); }
    .summary-icon { display:grid; grid-row:1/4; width:44px; height:44px; place-items:center; border-radius:13px; font-size:16px; font-weight:900; }
    .summary-card > span { color:#2a655e; font-size:14px; font-weight:700; }
    .summary-card > strong { margin-top:5px; font-size:32px; letter-spacing:-.04em; }
    .summary-card > small { margin-top:3px; color:#467d76; font-size:12px; }
    .summary-card.primary .summary-icon { background:#fdfcf7; color:var(--brand-900); }
    .summary-card.danger .summary-icon { background:var(--danger-soft); color:var(--danger); }
    .summary-card.warning .summary-icon { background:var(--warning-soft); color:var(--warning); }
    .summary-card.calm .summary-icon { background:var(--brand-50); color:var(--brand-800); }
    .insight-grid { display:grid; grid-template-columns:1.2fr .8fr; gap:16px; margin-top:16px; }
    .panel,.results-panel { border:1px solid var(--line); border-radius:19px; background:white; box-shadow:0 8px 30px rgba(21,54,93,.045); }
    .panel { padding:25px; }
    .card-title-row { display:flex; align-items:center; justify-content:space-between; }
    .section-kicker { color:var(--brand-800); font-size:12px; }
    .card-title-row h2,.results-heading h2 { margin:5px 0 0; font-size:21px; letter-spacing:-.04em; }
    .issue-total { padding:7px 10px; border-radius:9px; background:#fdfcf7; color:#1c534d; font-size:13px; font-weight:800; }
    .distribution-bar { display:flex; height:10px; margin:26px 0 18px; overflow:hidden; border-radius:99px; background:#fdfcf7; }
    .distribution-bar span { display:block; }
    .exact-fill,.legend-dot.exact { background:var(--danger); }
    .high-fill,.legend-dot.high { background:#c08a1c; }
    .review-fill,.legend-dot.review { background:var(--review); }
    .normal-fill,.legend-dot.normal { background:#409e97; }
    .distribution-legend { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
    .legend-item { display:grid; grid-template-columns:8px 1fr auto; align-items:center; gap:7px; padding:9px 8px; border-radius:10px; background:#ffffff; }
    .legend-dot { width:7px; height:7px; border-radius:50%; }
    .legend-item span { color:#1c534d; font-size:12px; }
    .legend-item strong { font-size:14px; }
    .threshold { margin-top:22px; padding-top:16px; border-top:1px solid #e3f0ec; }
    .threshold-label { display:flex; justify-content:space-between; color:#1c534d; font-size:13px; }
    .threshold-label strong { color:var(--brand-800); font-size:15px; }
    #report-threshold { width:100%; margin-top:13px; accent-color:var(--brand-600); cursor:pointer; }
    .range-note { display:flex; justify-content:space-between; margin-top:6px; color:#467d76; font-size:12px; }
    /* 눌러서 거르는 요소들: 단추지만 원래 모양을 유지한다 */
    button.legend-item, button.subject-row, button.audit-item { width:100%; font:inherit; text-align:left; cursor:pointer; }
    button.legend-item, button.subject-row { border:0; }
    button.subject-row { background:transparent; border-radius:10px; }
    button.legend-item:hover, button.subject-row:hover { background:var(--brand-25); }
    .legend-item.active { box-shadow:inset 0 0 0 1.5px var(--brand-400); background:var(--brand-25); }
    .audit-item.active { box-shadow:0 0 0 2px rgba(92,186,171,.28); }
    .subject-list { display:flex; flex-direction:column; gap:5px; margin-top:18px; }
    .subject-row { display:grid; grid-template-columns:118px 1fr 56px; align-items:center; gap:10px; padding:8px; }
    .subject-row > span { overflow:hidden; font-size:13px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
    .subject-row > i { height:5px; overflow:hidden; border-radius:99px; background:#fdfcf7; }
    .subject-row > i b { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#c08a1c,#d4573a); }
    .subject-row > strong { color:#1c534d; font-size:13px; text-align:right; }
    .audit-panel { margin-top:16px; padding:24px; border:1px solid var(--line); border-radius:19px; background:white; box-shadow:0 8px 30px rgba(21,54,93,.045); }
    .audit-panel header { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:16px; }
    .audit-panel h2 { margin:5px 0 0; font-size:21px; }
    .audit-panel header p { margin:0; color:#2a655e; font-size:12px; }
    .audit-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:9px; }
    /* 기재요령 카드: 앱과 같은 모양(이름 왼쪽, 건수 오른쪽 한 줄) */
    .audit-item { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:8px; padding:12px 14px; border:1px solid #e3f0ec; border-radius:11px; background:#ffffff; color:#1c534d; font-size:13px; }
    .audit-item strong { color:var(--brand-900); font-size:15px; white-space:nowrap; }
    .audit-item:hover, .audit-item.active { border-color:#a8ded6; background:#fdfcf7; color:var(--brand-800); }
    .audit-disclaimer { margin:14px 0 0; color:#3b7871; font-size:13px; }
    .results-panel { margin-top:16px; overflow:hidden; }
    /* 컨트롤이 한 줄에 다 못 들어가면 제목을 누르지 말고 다음 줄로 흘린다.
       제목이 눌리면 한 글자씩 세로로 꺾여 보인다. */
    .results-heading { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:14px 18px; padding:23px 25px; border-bottom:1px solid var(--line); }
    .results-heading > div:first-child { flex-shrink:0; white-space:nowrap; }
    .results-heading h2 em { margin-left:5px; color:var(--brand-800); font-size:16px; font-style:normal; }
    .snapshot-controls { display:flex; align-items:center; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
    .snapshot-search { min-width:210px; }
    .snapshot-search,.snapshot-select { height:42px; padding:0 12px; border:1px solid var(--line); border-radius:10px; background:#ffffff; color:#2a655e; font-size:13px; line-height:36px; }
    .snapshot-search { width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .table-wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; }
    th { padding:12px 14px; border-bottom:1px solid var(--line); background:#fdfcf7; color:#2a655e; font-size:12px; font-weight:800; text-align:left; }
    th.check-cell{width:46px} th:nth-child(2){width:128px} th:nth-child(3){width:138px} th:nth-child(4){width:112px} th:nth-child(5){width:124px} th:nth-child(7){width:200px} th:nth-child(8){width:96px}
    td { padding:15px 14px; border-bottom:1px solid #e3f0ec; vertical-align:middle; }
    td.check-cell,th.check-cell { text-align:center; }
    .check-cell input { width:19px; height:19px; accent-color:var(--brand-600); cursor:pointer; }
    tr.row-checked td:not(.check-cell) { opacity:.45; }
    tr.row-checked:hover td { opacity:1; }
    .review-progress { color:var(--ink-soft); font-size:13px; }
    .review-progress strong { color:var(--brand-700); }
    .hide-checked-toggle { display:inline-flex; align-items:center; gap:7px; color:var(--ink-soft); cursor:pointer; font-size:13px; font-weight:700; white-space:nowrap; }
    .hide-checked-toggle input { width:17px; height:17px; accent-color:var(--brand-600); cursor:pointer; }
    tbody tr:hover { background:#ffffff; }
    .status-badge { display:inline-flex; align-items:center; gap:6px; padding:6px 8px; border-radius:8px; font-size:12px; font-weight:800; white-space:nowrap; }
    .status-badge i { width:6px; height:6px; border-radius:50%; }
    .status-badge.exact { background:var(--danger-soft); color:#b8442a; } .status-badge.exact i { background:var(--danger); }
    .status-badge.high { background:var(--warning-soft); color:#8f6410; } .status-badge.high i { background:var(--warning); }
    .status-badge.review { background:var(--review-soft); color:#45638f; } .status-badge.review i { background:var(--review); }
    .status-badge.normal { background:var(--brand-50); color:var(--brand-800); } .status-badge.normal i { background:var(--brand-600); }
    .student-name,.similarity-number { display:block; font-size:14px; }
    .similarity-number { font-size:17px; } .similarity-number.exact { color:var(--danger); } .similarity-number.high { color:var(--warning); } .similarity-number.review { color:var(--review); } .similarity-number.normal { color:var(--brand-800); }
    .muted { display:block; margin-top:4px; overflow:hidden; color:#3b7871; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
    .subject-chip { display:inline-block; max-width:100%; overflow:hidden; padding:5px 8px; border-radius:7px; background:#fdfcf7; color:#14403b; font-size:12px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
    .record-preview { display:-webkit-box; margin:0; overflow:hidden; color:#14403b; font-size:13px; line-height:1.65; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
    .inspection-text-highlight { margin:0 1px; padding:1px 2px; border-radius:4px; background:#fbf1d9; color:#8f6410; box-decoration-break:clone; -webkit-box-decoration-break:clone; }
    .inspection-text-highlight.prohibited { background:#fdece6; color:#9c3822; font-weight:800; }
    .inspection-text-highlight.institution,.inspection-text-highlight.business { background:#fbf1d9; color:#8f6410; font-weight:800; }
    .inspection-text-highlight.typo,.inspection-text-highlight.symbol { background:#eaf0f9; color:#375075; font-weight:800; }
    /* 기재요령 칩: 앱과 같은 모양(항목 이름만, 심각도 색) */
    .record-issues { display:flex; align-items:center; flex-wrap:wrap; gap:5px; }
    .inspection-chip { display:inline-flex; align-items:center; padding:4px 6px; border-radius:6px; background:#fbf1d9; color:#8f6410; font-size:12px; font-weight:800; white-space:nowrap; }
    .inspection-chip.danger { background:#fdece6; color:#b8442a; }
    .record-issues small, .muted-inline { color:#3b7871; font-size:12px; }
    .compare-button { display:inline-flex; align-items:center; gap:3px; padding:7px 8px; border:1px solid var(--line); border-radius:9px; background:white; color:var(--brand-900); font-size:12px; font-weight:800; text-decoration:none; }
    .compare-button b { font-size:17px; } .compare-button.disabled { color:#467d76; }
    .table-footer { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:14px 24px; color:#2a655e; font-size:13px; }
    .report-pager { display:inline-flex; align-items:center; gap:8px; }
    .report-pager button { width:32px; height:32px; border:1px solid var(--line); border-radius:9px; background:white; color:var(--brand-900); cursor:pointer; font-size:15px; font-weight:800; }
    .report-pager button:disabled { color:var(--brand-200); cursor:default; }
    .report-empty { padding:34px 24px; color:#2a655e; font-size:14px; text-align:center; }
    .dialog-sub { display:block; margin-top:4px; color:#3b7871; font-size:12px; }
    #report-search:focus, .snapshot-select:focus { outline:none; border-color:var(--brand-400); box-shadow:0 0 0 3px rgba(50,138,135,.25); }
    .report-notice { margin-top:16px; padding:15px 18px; border:1px solid #d5e8e2; border-radius:13px; background:#fdfcf7; color:#0f4a46; font-size:13px; }
    .site-footer { display:flex; justify-content:space-between; padding:22px max(24px,calc((100% - 1180px)/2)); border-top:1px solid var(--line); background:white; color:#3b7871; font-size:12px; }
    .compare-dialog { display:none; position:fixed; z-index:20; inset:0; place-items:center; padding:24px; }
    /* 자바스크립트로 여는 것이 기본이고, :target은 스크립트가 막힌 환경을 위한 대비책이다. */
    .compare-dialog.is-open, .compare-dialog:target { display:grid; }
    .dialog-backdrop { position:absolute; inset:0; background:rgba(8,28,50,.58); }
    .dialog-sheet { position:relative; z-index:1; width:min(900px,100%); max-height:calc(100vh - 48px); overflow:auto; border-radius:20px; background:white; box-shadow:0 28px 80px rgba(7,27,49,.28); }
    .dialog-header { display:flex; align-items:flex-start; justify-content:space-between; padding:22px 25px; border-bottom:1px solid var(--line); }
    .dialog-header h2 { margin:10px 0 0; font-size:20px; }
    .dialog-close { display:grid; width:34px; height:34px; place-items:center; border-radius:10px; background:#fdfcf7; color:var(--brand-900); font-size:24px; text-decoration:none; }
    .similarity-callout { display:flex; align-items:center; justify-content:space-between; gap:20px; margin:18px 25px 0; padding:18px 20px; border-radius:14px; background:var(--brand-950); color:white; }
    .similarity-callout span { color:var(--brand-200); font-size:12px; } .similarity-callout strong { display:block; color:var(--brand-300); font-size:32px; }
    .similarity-callout p { margin:0; color:var(--brand-100); font-size:13px; }
    .reuse-section { margin:14px 25px 0; padding:14px 17px; border:1px solid var(--line); border-radius:12px; background:white; }
    .reuse-section > div { display:flex; align-items:baseline; flex-wrap:wrap; gap:8px; }
    .reuse-section strong { color:#12312e; font-size:13px; }
    .reuse-section > div small { color:#3b7871; font-size:12px; }
    .reuse-section ul { display:flex; flex-direction:column; gap:6px; margin:10px 0 0; padding:0; list-style:none; }
    .reuse-section li { display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding:7px 10px; border-radius:8px; background:#eff8f4; font-size:12px; }
    .reuse-section li span { min-width:0; color:#12312e; line-height:1.55; overflow-wrap:anywhere; }
    .reuse-section li b { flex-shrink:0; color:var(--danger); font-size:12px; }
    .rule-findings { margin:18px 25px 0; padding:18px; border:1px solid #d5e8e2; border-radius:14px; background:#ffffff; }
    .rule-findings h3 { margin:0 0 12px; font-size:16px; }
    .rule-findings ul { display:grid; gap:8px; margin:0; padding:0; list-style:none; }
    .rule-findings li { padding:11px 12px; border-radius:10px; background:white; }
    .rule-findings li.prohibited { border-left:3px solid var(--danger); }
    .rule-findings li > div { display:flex; align-items:center; gap:8px; }
    .rule-findings li strong { font-size:12px; }
    .rule-findings li mark { padding:2px 5px; background:#fdece6; color:#b8442a; font-size:12px; }
    .rule-findings li p { margin:6px 0 2px; color:#14403b; font-size:12px; }
    .rule-findings li small,.rule-findings > p { color:#3b7871; font-size:12px; }
    .inspection-source { margin:18px 25px 0; padding:18px; border:1px solid #ecd7a4; border-radius:14px; background:#fbf1d9; }
    .inspection-source > div { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .inspection-source strong { font-size:15px; }
    .inspection-source small { color:#3b7871; font-size:12px; }
    .inspection-source p { margin:12px 0 0; color:#14403b; font-size:14px; line-height:1.9; white-space:pre-wrap; }
    .highlight-guide { display:flex; gap:18px; padding:15px 25px 0; color:#1c534d; font-size:12px; font-weight:700; }
    .highlight-guide span { display:flex; align-items:center; gap:6px; } .highlight-guide i { width:13px; height:13px; border-radius:4px; }
    .highlight-guide i.exact { background:#fdece6; } .highlight-guide i.similar { position:relative; background:white; box-shadow:inset 0 0 0 1px #d4573a; }
    .highlight-guide i.similar::after { position:absolute; inset:-2px 0 0; color:#b8442a; content:"가"; font-size:12px; font-style:normal; text-align:center; }
    .comparison-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:18px 25px; }
    .comparison-grid > section { padding:18px; border:1px solid var(--line); border-radius:14px; background:#ffffff; }
    .comparison-grid h3 { margin:0; font-size:15px; } .comparison-grid small { color:#3b7871; font-size:12px; }
    .comparison-grid p { min-height:120px; margin:14px 0 0; color:#14403b; font-size:14px; line-height:1.85; white-space:pre-wrap; }
    mark { margin:0 -1px; padding:2px 3px; border-radius:4px; color:inherit; box-decoration-break:clone; -webkit-box-decoration-break:clone; }
    mark.exact { background:#fdece6; box-shadow:inset 0 -1px 0 rgba(198,66,66,.24); }
    .similar .common-fragment { background:#fdece6; box-shadow:inset 0 -1px 0 rgba(198,66,66,.24); }
    .sentence-highlight { cursor:default; transition:background-color 120ms ease, box-shadow 120ms ease; }
    /* 한쪽 문장에 마우스를 올리면 양쪽의 짝이 되는 문장을 함께 짚어 준다. */
    .sentence-highlight.pair-active { background:var(--brand-100); box-shadow:inset 0 0 0 1px var(--brand-400), 0 1px 6px rgba(28,113,108,.18); }
    .similar .diff-fragment { color:#b8442a; font-weight:800; }
    .keywords { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:0 25px 18px; }
    .keywords span { margin-right:4px; color:#1c534d; font-size:12px; font-weight:700; }
    .keywords i { padding:4px 7px; border-radius:7px; background:#fdfcf7; color:var(--brand-600); font-size:12px; font-style:normal; font-weight:700; }
    .keywords small { flex-basis:100%; margin-top:6px; color:#3b7871; font-size:12px; }
    .dialog-sheet > footer { padding:12px 25px; border-top:1px solid var(--line); background:#fdfcf7; color:#3b7871; font-size:12px; }
    @media (max-width:900px) { .summary-grid{grid-template-columns:repeat(2,1fr)} .insight-grid,.comparison-grid{grid-template-columns:1fr} .audit-grid{grid-template-columns:repeat(2,1fr)} .report-hero,.results-heading{align-items:flex-start;flex-direction:column} .snapshot-controls{width:100%;flex-wrap:wrap} .snapshot-search{flex:1} }
    @media (max-width:560px) { .report-main{width:min(100% - 24px,1180px)} .summary-grid{grid-template-columns:1fr} .distribution-legend{grid-template-columns:repeat(2,1fr)} .topbar>span{display:none} .site-footer{gap:12px;flex-direction:column} }
    @media print { body{background:white} .topbar,.saved-chip,.compare-dialog{display:none!important} .report-main{width:100%;padding:0} .panel,.results-panel,.summary-card{box-shadow:none} .table-wrap{overflow:visible} table{min-width:0} .compare-button{display:none} }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">${brandMarkHtml}<strong>Record LENS</strong><small>학교생활기록부 종합점검 · 2026 기재요령 기반</small></div>
    <span><b class="maker-credit">제작: 산남고 이성훈</b> · 저장된 결과 파일 · 학생 기록을 안전하게 보관해 주세요</span>
  </header>
  <main class="report-main">
    <section class="report-hero">
      <div>
        <div class="eyebrow">점검 완료 · ${escapeHtml(generatedAt)}</div>
        <h1>확인이 필요한 기록을 모았습니다.</h1>
        <p>${sourceFiles.length.toLocaleString("ko-KR")}개 파일에서 ${records.length.toLocaleString("ko-KR")}건의 ${escapeHtml(contentLabel)}을 정리했습니다. 유사도와 기재요령 점검 결과는 보조 지표이므로 원문을 함께 확인해 주세요.</p>
      </div>
      <div class="saved-chip">결과 화면 HTML 저장본</div>
    </section>
    <section class="summary-grid" aria-label="점검 요약">
      <article class="summary-card primary"><div class="summary-icon">전체</div><span>전체 기록</span><strong>${records.length.toLocaleString("ko-KR")}</strong><small>${sourceFiles.length.toLocaleString("ko-KR")}개 원본 파일</small></article>
      <article class="summary-card danger"><div class="summary-icon">!</div><span>완전 일치</span><strong id="r-sum-exact">${counts.exact.toLocaleString("ko-KR")}</strong><small>정규화 후 100% 같은 문장</small></article>
      <article class="summary-card warning"><div class="summary-icon">≈</div><span>높은 유사도</span><strong id="r-sum-high">${counts.high.toLocaleString("ko-KR")}</strong><small id="r-sum-high-note">${Math.round(threshold * 100)}% 이상 유사한 문장</small></article>
      <article class="summary-card calm"><div class="summary-icon">✓</div><span>이상 없음</span><strong id="r-sum-normal">${counts.normal.toLocaleString("ko-KR")}</strong><small>설정 기준 미만</small></article>
    </section>
    <section class="insight-grid">
      <article class="panel">
        <div class="card-title-row"><div><span class="section-kicker">점검 분포</span><h2>위험도별 기록</h2></div><div class="issue-total" id="r-flagged-chip">${checkedCount.toLocaleString("ko-KR")}건 확인</div></div>
        <div class="distribution-bar" aria-label="위험도 분포">
          <span class="exact-fill" id="r-fill-exact" style="width:${(counts.exact / Math.max(1, records.length)) * 100}%"></span>
          <span class="high-fill" id="r-fill-high" style="width:${(counts.high / Math.max(1, records.length)) * 100}%"></span>
          <span class="review-fill" id="r-fill-review" style="width:${(counts.review / Math.max(1, records.length)) * 100}%"></span>
          <span class="normal-fill" id="r-fill-normal" style="width:${(counts.normal / Math.max(1, records.length)) * 100}%"></span>
        </div>
        <div class="distribution-legend">
          <button type="button" class="legend-item" data-risk="exact"><i class="legend-dot exact"></i><span>완전 일치</span><strong id="r-legend-exact">${counts.exact.toLocaleString("ko-KR")}</strong></button>
          <button type="button" class="legend-item" data-risk="high"><i class="legend-dot high"></i><span>높은 유사도</span><strong id="r-legend-high">${counts.high.toLocaleString("ko-KR")}</strong></button>
          <button type="button" class="legend-item" data-risk="review"><i class="legend-dot review"></i><span>확인 필요</span><strong id="r-legend-review">${counts.review.toLocaleString("ko-KR")}</strong></button>
          <button type="button" class="legend-item" data-risk="normal"><i class="legend-dot normal"></i><span>이상 없음</span><strong id="r-legend-normal">${counts.normal.toLocaleString("ko-KR")}</strong></button>
        </div>
        <div class="threshold">
          <div class="threshold-label"><label for="report-threshold">높은 유사도 기준</label><strong id="r-threshold-label">${Math.round(threshold * 100)}%</strong></div>
          <input type="range" id="report-threshold" min="0.5" max="0.95" step="0.05" value="${threshold}" aria-label="높은 유사도 기준" />
          <div class="range-note"><span>넓게 보기 50%</span><span>엄격하게 95%</span></div>
        </div>
      </article>
      <article class="panel">
        <div class="card-title-row"><div><span class="section-kicker">${escapeHtml(categoryLabel)}별 현황</span><h2>우선 확인할 ${escapeHtml(categoryLabel)}</h2></div><span>▥</span></div>
        <div class="subject-list" id="r-subject-list"></div>
      </article>
    </section>
    <section class="audit-panel">
      <header><div><span class="section-kicker">2026 학교생활기록부 기재요령 기반</span><h2>기재요령 보조 점검</h2></div><p>항목을 누르면 해당 표현이 발견된 기록만 모아볼 수 있습니다.</p></header>
      <div class="audit-grid" id="r-audit-grid"></div>
      <p class="audit-disclaimer">자동 탐지는 확인이 필요한 후보를 찾는 기능입니다. 문맥, 허용 예외, 고유명사 여부는 기재요령 원문과 대조하여 최종 판단해 주세요.</p>
    </section>
    <section class="results-panel" id="results">
      <div class="results-heading">
        <div><span class="section-kicker">상세 점검 결과</span><h2>기록별 비교 <em id="visible-count">${orderedRecords.length.toLocaleString("ko-KR")}</em></h2></div>
        <div class="snapshot-controls">
          <input id="report-search" class="snapshot-search" type="search" placeholder="이름, 학급, ${escapeHtml(categoryLabel)}, 내용 검색" aria-label="점검 결과 검색" />
          <select id="report-class" class="snapshot-select" aria-label="학급 필터">
            <option value="all">전체 학급</option>
            ${[...new Set(orderedRecords.map((record) => record.className))]
              .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }))
              .map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`)
              .join("")}
          </select>
          <select id="report-subject" class="snapshot-select" aria-label="${escapeHtml(categoryLabel)} 필터">
            <option value="all">전체 ${escapeHtml(categoryLabel)}</option>
            ${[...new Set(orderedRecords.map((record) => record.subject))]
              .sort((a, b) => a.localeCompare(b, "ko"))
              .map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`)
              .join("")}
          </select>
          <select id="report-risk" class="snapshot-select" aria-label="위험도 필터">
            <option value="all">전체 위험도</option>
            <option value="exact">완전 일치</option>
            <option value="high">높은 유사도</option>
            <option value="review">확인 필요</option>
            <option value="normal">이상 없음</option>
          </select>
          <select id="report-issue" class="snapshot-select" aria-label="기재요령 점검항목 필터">
            <option value="all">전체 점검항목</option>
            ${INSPECTION_TYPES.map(
              (type) => `<option value="${type}">${escapeHtml(INSPECTION_LABELS[type])}</option>`,
            ).join("")}
          </select>
          <select id="report-sort" class="snapshot-select" aria-label="정렬 방법">
            <option value="risk">유사도 높은 순</option>
            <option value="class">학급·번호 순</option>
            <option value="name">이름 순</option>
            <option value="subject">${escapeHtml(categoryLabel)} 순</option>
          </select>
          <label class="hide-checked-toggle"><input type="checkbox" id="report-hide-checked" />확인한 기록 숨기기</label>
        </div>
      </div>
      <div class="table-wrap">
        <table class="has-check-column">
          <thead><tr><th class="check-cell"></th><th>점검 결과</th><th>학생 / 학급</th><th>${escapeHtml(categoryLabel)}</th><th>최대 유사도</th><th>${escapeHtml(contentLabel)}</th><th>기재요령 점검</th><th>상세</th></tr></thead>
          <tbody id="report-body"></tbody>
        </table>
        <div id="report-empty" class="report-empty" hidden>조건에 맞는 기록이 없습니다. 검색어나 필터를 바꿔 보세요.</div>
      </div>
      <div class="table-footer">
        <span id="report-range">전체 ${orderedRecords.length.toLocaleString("ko-KR")}건</span>
        <span id="report-progress" class="review-progress"></span>
        <span class="report-pager">
          <button type="button" id="report-prev" aria-label="이전 페이지">‹</button>
          <span id="report-page">1 / 1</span>
          <button type="button" id="report-next" aria-label="다음 페이지">›</button>
        </span>
      </div>
    </section>
    <div class="report-notice">자카드 유사도는 전체 고유 단어의 교집합과 합집합을 비교합니다. 기재요령 점검은 2026 학교생활기록부 기재요령 p.18-19, p.30, p.61, p.82의 주요 기준을 바탕으로 한 보조 탐지이므로 원문과 허용 예외를 직접 확인하세요.</div>
  </main>
  <footer class="site-footer"><span>Record LENS · 학교생활기록부 종합점검</span><span>원본: ${escapeHtml(sourceFiles.join(", "))}</span><span>학생부 기록의 최종 책임은 작성·확인자에게 있습니다.</span></footer>
  <div id="dialog-host"></div>
  <script type="application/json" id="record-data">${payloadJson}</script>
  <script>${REPORT_SCRIPT}</script>
</body>
</html>`;
    const blob = new Blob(["\uFEFF", html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `RecordLENS_종합점검결과화면_${date}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const issueCount = counts.exact + counts.high + counts.review;
  /** PDF에서 읽은 자료는 띄어쓰기가 원문과 달라질 수 있어 결과 화면에 따로 알린다. */
  const usedPdfSource = sourceFiles.some((name) => name.toLowerCase().endsWith(".pdf"));
  const progressWidth = progress?.stage === "comparing" ? progress.value : progress?.value ?? 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          type="button"
          onClick={reset}
          aria-label="Record LENS 홈"
        >
          {/* next/image는 GitHub Pages 정적 빌드에서 쓸 수 없어 순수 img를 쓴다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src={BRAND_ICON_SRC} alt="" width={42} height={42} />
          <span>
            <strong>Record LENS</strong>
            <small>학교생활기록부 종합점검</small>
          </span>
        </button>
        <div className="topbar-side">
          <span className="maker-credit">제작: 산남고 이성훈</span>
          <div className="privacy-badge">
            <LockKeyhole size={15} />
            <span>파일은 이 기기에서만 처리됩니다</span>
          </div>
        </div>
      </header>

      {records.length === 0 ? (
        <main>
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span />
                교과 세특 · 창의적체험활동 특기사항
              </div>
              <h1>
                학생부 기록, 올리면
                <br />
                <em>종합 점검합니다.</em>
              </h1>
              <p>
                나이스 엑셀을 한 번에 합치고 유사도, 오탈자, 특수기호, 기재금지어,
                기관명과 상호명을 함께 확인합니다.
              </p>
              <div className="hero-points" aria-label="주요 기능">
                <span>
                  <Check size={16} /> 여러 파일 자동 병합
                </span>
                <span>
                  <Check size={16} /> 교과 세특·창체 자동 인식
                </span>
                <span>
                  <Check size={16} /> 유사도·기재요령 통합 점검
                </span>
              </div>
              <div className="privacy-note">
                <ShieldCheck size={24} />
                <div>
                  <strong>학생부 데이터는 외부로 전송하지 않습니다.</strong>
                  <span>분석은 현재 브라우저 안에서만 이루어지며 서버에 보관되지 않습니다.</span>
                </div>
              </div>
            </div>

            <div className="upload-panel">
              <div className="panel-heading">
                <span className="step-pill">1</span>
                <div>
                  <h2>점검 파일 준비</h2>
                  <p>필독 안내를 확인한 뒤 파일을 선택하세요.</p>
                </div>
              </div>

              <label className={`consent-box ${consented ? "checked" : ""}`}>
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(event) => {
                    setConsented(event.target.checked);
                    setError("");
                  }}
                />
                <span className="checkbox-visual">
                  <Check size={14} />
                </span>
                <span>
                  <strong>필독 안내를 확인했습니다.</strong>
                  <small>
                    이 도구는 감사·컨설팅 준비를 위한 보조 수단입니다. 최종 기록은 반드시
                    개별 확인하고, 공유 전 학생 정보가 남아 있지 않은지 점검하세요.
                  </small>
                </span>
              </label>

              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                multiple
                accept={ACCEPTED_EXTENSIONS.join(",")}
                onChange={(event) => event.target.files && handleFiles(event.target.files)}
              />
              <button
                className={`dropzone ${dragging ? "dragging" : ""} ${!consented ? "disabled" : ""}`}
                type="button"
                onClick={() => {
                  if (!consented) {
                    setError("먼저 필독 안내를 확인하고 동의해 주세요.");
                    return;
                  }
                  inputRef.current?.click();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  handleFiles(event.dataTransfer.files);
                }}
              >
                <span className="upload-icon">
                  <UploadCloud size={30} />
                </span>
                <strong>반별 엑셀 파일을 여기에 놓으세요</strong>
                <span>또는 클릭해서 여러 파일을 한꺼번에 선택</span>
                <span>학교생활기록부 PDF도 읽을 수 있습니다</span>
                <small>XLS · XLSX · XLSM · XLSB · PDF</small>
              </button>

              <div className="threshold-setting">
                <div>
                  <label htmlFor="threshold">높은 유사도 기준</label>
                  <span>{Math.round(threshold * 100)}% 이상</span>
                </div>
                <input
                  id="threshold"
                  type="range"
                  min="0.5"
                  max="0.95"
                  step="0.05"
                  value={threshold}
                  onChange={(event) => changeThreshold(Number(event.target.value))}
                />
                <div className="range-labels">
                  <span>넓게 보기 50%</span>
                  <span>엄격하게 95%</span>
                </div>
              </div>

              {error && (
                <div className="inline-error" role="alert">
                  <AlertTriangle size={17} />
                  <span>{error}</span>
                </div>
              )}

              <button className="demo-button" type="button" onClick={loadDemo}>
                <Sparkles size={16} />
                익명 예시 자료로 먼저 둘러보기
                <ArrowRight size={16} />
              </button>

              <a className="guide-link" href="#neis-guide">
                <HelpCircle size={15} />
                반별 엑셀 파일은 어디서 받나요?
              </a>
            </div>
          </section>

          <section className="guide-section" id="neis-guide">
            <div className="guide-copy">
              <div className="eyebrow">
                <span />
                파일 준비
              </div>
              <h2>나이스에서 반별 세특 엑셀 받기</h2>
              <p>
                나이스에 교과담임 또는 부서장 권한으로 접속한 뒤, 아래 순서로 들어가
                <strong> XLS data</strong> 형식으로 저장하면 됩니다. 반별로 저장한 파일을
                한꺼번에 올리면 자동으로 합쳐 점검합니다.
              </p>
            </div>
            <ol className="guide-steps">
                <li>
                  <span>1</span>
                  <div>
                    <strong>학교생활기록부</strong>
                    <small>왼쪽 메뉴에서 선택</small>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>학생부 항목별 조회</strong>
                    <small>상단 단계 중 세 번째</small>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>학년도·학년·반 선택 후 조회</strong>
                    <small>반을 바꿔 가며 반복</small>
                  </div>
                </li>
                <li>
                  <span>4</span>
                  <div>
                    <strong>교과학습발달상황 › 세부능력및특기사항</strong>
                    <small>창의적체험활동 특기사항도 같은 방법으로</small>
                  </div>
                </li>
                <li>
                  <span>5</span>
                  <div>
                    <strong>저장 아이콘 › XLS data</strong>
                    <small>XLS가 아니라 XLS data로 저장해야 합니다</small>
                  </div>
                </li>
            </ol>
            <figure className="guide-figure">
              {/* next/image는 GitHub Pages 정적 빌드에서 쓸 수 없어 순수 img를 쓴다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={NEIS_GUIDE_SRC}
                alt="나이스 학교생활기록부 화면에서 학생부 항목별 조회로 들어가 세부능력및특기사항을 고른 뒤, 저장 메뉴에서 XLS data를 선택하는 모습"
                width={1500}
                height={726}
                loading="lazy"
              />
              <figcaption>학교명·교사명·학생 이름과 기록 내용은 가려 두었습니다.</figcaption>
            </figure>
            <p className="guide-note">
              <ShieldCheck size={16} />
              내려받은 파일에는 학생 이름과 기록이 그대로 들어 있습니다. 점검이 끝나면 파일을
              안전하게 관리해 주세요.
            </p>
            <p className="guide-note">
              <Info size={16} />
              엑셀을 구할 수 없다면 <strong>학생부 조회 및 출력</strong>에서 저장한 학교생활기록부
              PDF를 올려도 됩니다. 학급과 번호는 학생의 학적사항에서 읽으므로 파일 이름은 자유롭게
              지어도 됩니다. 다만 PDF는 줄이 바뀌는 자리의 띄어쓰기가 원문과 달라질 수 있어,
              엑셀이 있으면 엑셀을 쓰는 편이 정확합니다.
            </p>
          </section>

          <section className="workflow-section">
            <div className="section-heading">
              <span>학교생활기록부 종합점검 과정을 한 번에</span>
              <h2>클릭을 반복할 필요 없이 자동으로 정리합니다.</h2>
            </div>
            <div className="workflow-grid">
              {[
                {
                  number: "01",
                  icon: <Files size={21} />,
                  title: "반별 파일 합치기",
                  text: "선택한 모든 파일의 Sheet1 데이터를 하나로 모읍니다.",
                },
                {
                  number: "02",
                  icon: <FileSpreadsheet size={21} />,
                  title: "학급·과목·영역 보정",
                  text: "빈 셀과 분리된 값을 앞뒤 문맥에 맞게 채웁니다.",
                },
                {
                  number: "03",
                  icon: <RefreshCcw size={21} />,
                  title: "특기사항 문장 병합",
                  text: "같은 학생·과목 또는 활동 영역에 나뉜 내용을 한 문장으로 정리합니다.",
                },
                {
                  number: "04",
                  icon: <BarChart3 size={21} />,
                  title: "유사도·기재요령 점검",
                  text: "중복 문장과 기재금지어, 특수기호, 기관명·상호명을 함께 확인합니다.",
                },
              ].map((item) => (
                <article className="workflow-card" key={item.number}>
                  <div className="workflow-icon">{item.icon}</div>
                  <span>{item.number}</span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </section>
        </main>
      ) : (
        <main className="report-main">
          <section className="report-hero">
            <div>
              <button className="back-button" type="button" onClick={reset}>
                <ChevronLeft size={17} />
                새 파일 점검
              </button>
              <div className="eyebrow">
                <span />
                점검 완료 · {reportTime}
              </div>
              <h1>확인이 필요한 기록을 모았습니다.</h1>
              <p>
                {sourceFiles.length}개 파일에서 {records.length.toLocaleString("ko-KR")}건을
                정리했습니다. 유사도와 2026 기재요령 보조 점검 결과를 원문과 함께 확인해
                주세요.
              </p>
            </div>
            <div className="export-actions">
              <button
                className="export-button secondary"
                type="button"
                onClick={exportHtmlReport}
              >
                <FileText size={19} />
                결과 화면 HTML 저장
              </button>
              <button className="export-button" type="button" onClick={exportWorkbook}>
                <Download size={19} />
                점검 결과 엑셀 받기
              </button>
            </div>
          </section>

          <section className="summary-grid" aria-label="점검 요약">
            <article className="summary-card primary">
              <div className="summary-icon">
                <FileCheck2 size={21} />
              </div>
              <span>전체 기록</span>
              <strong>{records.length.toLocaleString("ko-KR")}</strong>
              <small>{sourceFiles.length}개 원본 파일</small>
            </article>
            <article className="summary-card danger">
              <div className="summary-icon">
                <AlertTriangle size={21} />
              </div>
              <span>완전 일치</span>
              <strong>{counts.exact.toLocaleString("ko-KR")}</strong>
              <small>정규화 후 100% 같은 문장</small>
            </article>
            <article className="summary-card warning">
              <div className="summary-icon">
                <Sparkles size={21} />
              </div>
              <span>높은 유사도</span>
              <strong>{counts.high.toLocaleString("ko-KR")}</strong>
              <small>{Math.round(threshold * 100)}% 이상 유사한 문장</small>
            </article>
            <article className="summary-card calm">
              <div className="summary-icon">
                <CheckCircle2 size={21} />
              </div>
              <span>이상 없음</span>
              <strong>{counts.normal.toLocaleString("ko-KR")}</strong>
              <small>설정 기준 미만</small>
            </article>
          </section>

          <section className="insight-grid">
            <article className="risk-panel">
              <div className="card-title-row">
                <div>
                  <span>점검 분포</span>
                  <h2>위험도별 기록</h2>
                </div>
                <div className="issue-total">{issueCount}건 확인</div>
              </div>
              <div className="distribution-bar" aria-label="위험도 분포">
                {(["exact", "high", "review", "normal"] as RiskStatus[]).map((status) => (
                  <span
                    className={status}
                    key={status}
                    style={{
                      width: `${(counts[status] / Math.max(1, records.length)) * 100}%`,
                    }}
                  />
                ))}
              </div>
              <div className="distribution-legend">
                {(["exact", "high", "review", "normal"] as RiskStatus[]).map((status) => (
                  <button
                    type="button"
                    key={status}
                    className={riskFilter === status ? "active" : ""}
                    onClick={() => changeRiskFilter(riskFilter === status ? "all" : status)}
                  >
                    <i className={status} />
                    <span>{riskLabel(status)}</span>
                    <strong>{counts[status]}</strong>
                  </button>
                ))}
              </div>
              <div className="threshold-inline">
                <label htmlFor="report-threshold">
                  <span>높은 유사도 기준</span>
                  <strong>{Math.round(threshold * 100)}%</strong>
                </label>
                <input
                  id="report-threshold"
                  type="range"
                  min="0.5"
                  max="0.95"
                  step="0.05"
                  value={threshold}
                  onChange={(event) => changeThreshold(Number(event.target.value))}
                />
              </div>
            </article>

            <article className="subject-panel">
              <div className="card-title-row">
                <div>
                  <span>{categoryLabel}별 현황</span>
                  <h2>우선 확인할 {categoryLabel}</h2>
                </div>
                <BarChart3 size={21} />
              </div>
              <div className="subject-list">
                {subjectSummaries.slice(0, 5).map((summary) => {
                  const flagged = summary.exact + summary.high;
                  return (
                    <button
                      type="button"
                      key={summary.subject}
                      onClick={() => {
                        changeSubjectFilter(summary.subject);
                        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      <span className="subject-name">{summary.subject}</span>
                      <span className="subject-track">
                        <i
                          style={{
                            width: `${Math.max(4, (flagged / Math.max(1, summary.total)) * 100)}%`,
                          }}
                        />
                      </span>
                      <strong>{flagged}건</strong>
                    </button>
                  );
                })}
                {!subjectSummaries.length && (
                  <p className="empty-copy">{categoryLabel} 정보가 없습니다.</p>
                )}
              </div>
            </article>
          </section>

          <section className="audit-panel">
            <div className="audit-heading">
              <div>
                <span>2026 학교생활기록부 기재요령 기반</span>
                <h2>기재요령 보조 점검</h2>
              </div>
              <p>항목을 누르면 해당 표현이 발견된 기록만 모아볼 수 있습니다.</p>
            </div>
            <div className="audit-grid">
              {INSPECTION_TYPES.map((type) => (
                <button
                  type="button"
                  key={type}
                  className={issueFilter === type ? "active" : ""}
                  onClick={() => changeIssueFilter(issueFilter === type ? "all" : type)}
                >
                  <span>{INSPECTION_LABELS[type]}</span>
                  <strong>{issueCounts[type].toLocaleString("ko-KR")}건</strong>
                </button>
              ))}
            </div>
            <p className="audit-disclaimer">
              자동 탐지는 확인이 필요한 후보를 찾는 기능입니다. 문맥, 허용 예외, 고유명사
              여부는 기재요령 원문과 대조하여 최종 판단해 주세요.
            </p>
            {!ENTITY_RULES_SUPPORTED && (
              <p className="audit-disclaimer" role="alert">
                이 브라우저는 기관명·상호명 탐지에 필요한 기능을 지원하지 않아 해당 두 항목은
                건너뛰었습니다. 최신 브라우저(iOS 16.4 이상)에서 다시 확인해 주세요.
              </p>
            )}
          </section>

          <section className="results-panel" id="results">
            <div className="results-heading">
              <div>
                <span>상세 점검 결과</span>
                <h2>
                  기록별 비교 <em>{filteredRecords.length.toLocaleString("ko-KR")}</em>
                </h2>
                <p className="review-progress" aria-live="polite">
                  확인 완료 <strong>{reviewedCount.toLocaleString("ko-KR")}</strong> /{" "}
                  {records.length.toLocaleString("ko-KR")}건
                </p>
              </div>
              <div className="results-actions">
                <div className="search-box">
                  <Search size={18} />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => changeSearch(event.target.value)}
                    placeholder={`이름, 학급, ${categoryLabel}, 내용 검색`}
                    aria-label="점검 결과 검색"
                  />
                  {search && (
                    <button type="button" onClick={() => changeSearch("")} aria-label="검색어 지우기">
                      <X size={15} />
                    </button>
                  )}
                </div>
                <select
                  value={classFilter}
                  onChange={(event) => changeClassFilter(event.target.value)}
                  aria-label="학급 필터"
                >
                  <option value="all">전체 학급</option>
                  {classOptions.map((className) => (
                    <option value={className} key={className}>
                      {className}
                    </option>
                  ))}
                </select>
                <select
                  value={subjectFilter}
                  onChange={(event) => changeSubjectFilter(event.target.value)}
                  aria-label={`${categoryLabel} 필터`}
                >
                  <option value="all">전체 {categoryLabel}</option>
                  {subjectOptions.map((subject) => (
                    <option value={subject} key={subject}>
                      {subject}
                    </option>
                  ))}
                </select>
                <select
                  value={riskFilter}
                  onChange={(event) =>
                    changeRiskFilter(event.target.value as "all" | RiskStatus)
                  }
                  aria-label="위험도 필터"
                >
                  <option value="all">전체 위험도</option>
                  <option value="exact">완전 일치</option>
                  <option value="high">높은 유사도</option>
                  <option value="review">확인 필요</option>
                  <option value="normal">이상 없음</option>
                </select>
                <select
                  value={issueFilter}
                  onChange={(event) =>
                    changeIssueFilter(event.target.value as "all" | InspectionIssueType)
                  }
                  aria-label="기재요령 점검항목 필터"
                >
                  <option value="all">전체 점검항목</option>
                  {INSPECTION_TYPES.map((type) => (
                    <option value={type} key={type}>
                      {INSPECTION_LABELS[type]}
                    </option>
                  ))}
                </select>
                <select
                  value={sortMode}
                  onChange={(event) => changeSortMode(event.target.value as SortMode)}
                  aria-label="정렬 방법"
                >
                  <option value="risk">유사도 높은 순</option>
                  <option value="class">학급·번호 순</option>
                  <option value="name">이름 순</option>
                  <option value="subject">{categoryLabel} 순</option>
                </select>
                <label className="hide-checked-toggle">
                  <input
                    type="checkbox"
                    checked={hideChecked}
                    onChange={(event) => {
                      setHideChecked(event.target.checked);
                      setPage(1);
                    }}
                  />
                  확인한 기록 숨기기
                </label>
              </div>
            </div>

            <div className="table-wrap">
              <table className="has-check-column">
                <thead>
                  <tr>
                    <th className="check-cell">
                      <span className="visually-hidden">확인 여부</span>
                    </th>
                    <th>점검 결과</th>
                    <th>학생 / 학급</th>
                    <th>{categoryLabel}</th>
                    <th>최대 유사도</th>
                    <th>{contentLabel}</th>
                    <th>기재요령 점검</th>
                    <th>
                      <span className="visually-hidden">상세</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((record) => {
                    const status = riskStatus(record, threshold);
                    const isChecked = checkedKeys.has(record.checkKey);
                    return (
                      <tr key={record.id} className={isChecked ? "row-checked" : ""}>
                        <td className="check-cell">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleChecked(record.checkKey)}
                            aria-label={`${record.name} ${record.subject} 확인 여부`}
                          />
                        </td>
                        <td>
                          <span className={`status-badge ${status}`}>
                            <i />
                            {riskLabel(status)}
                          </span>
                        </td>
                        <td>
                          <strong className="student-name">{record.name}</strong>
                          <span className="muted">{record.className}</span>
                        </td>
                        <td>
                          <span className="subject-chip">{record.subject}</span>
                        </td>
                        <td>
                          <strong className={`similarity-number ${status}`}>
                            {formatPercent(record.similarity)}
                          </strong>
                          {record.matchName && (
                            <span className="muted">↔ {record.matchName}</span>
                          )}
                        </td>
                        <td>
                          <p className="record-preview">
                            <InspectionHighlightedText text={record.text} issues={record.issues} />
                          </p>
                        </td>
                        <td>
                          <div className="record-issues">
                            {record.issues.slice(0, 3).map((issue, index) => (
                              <span
                                className={`inspection-chip ${issue.severity}`}
                                key={`${issue.type}-${issue.index}-${index}`}
                                title={`${issue.match}: ${issue.guidance}`}
                              >
                                {issue.label}
                              </span>
                            ))}
                            {record.issues.length > 3 && (
                              <small>+{record.issues.length - 3}</small>
                            )}
                            {!record.issues.length && <span className="muted-inline">없음</span>}
                          </div>
                        </td>
                        <td>
                          <button
                            className="compare-button"
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            disabled={!record.matchText && !record.issues.length}
                          >
                            상세
                            <ChevronRight size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visibleRecords.length && (
                <div className="empty-state">
                  <Search size={28} />
                  <strong>조건에 맞는 기록이 없습니다.</strong>
                  <span>검색어나 위험도 필터를 바꿔 보세요.</span>
                </div>
              )}
            </div>

            <div className="table-footer">
              <span>
                총 {filteredRecords.length.toLocaleString("ko-KR")}건 중{" "}
                {filteredRecords.length ? (page - 1) * PAGE_SIZE + 1 : 0}–
                {Math.min(page * PAGE_SIZE, filteredRecords.length)}건
              </span>
              <div className="pagination">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  aria-label="이전 페이지"
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page === totalPages}
                  aria-label="다음 페이지"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </section>

          {usedPdfSource && (
            <div className="report-notice pdf-notice">
              <AlertTriangle size={18} />
              <p>
                <strong>PDF에서 읽은 기록이 섞여 있습니다.</strong> PDF는 문단을 양쪽 정렬로
                인쇄하기 때문에 줄이 바뀌는 자리의 띄어쓰기가 원문과 달라질 수 있습니다. 그
                영향으로 유사도와 맞춤법 점검 결과가 조금씩 어긋날 수 있으니, 가능하면
                나이스에서 <strong>XLS data</strong>로 내려받은 엑셀을 사용해 주세요.
              </p>
            </div>
          )}

          <div className="report-notice">
            <Info size={18} />
            <p>
              자카드 유사도는 두 기록의 전체 고유 단어를 사용합니다. 오탈자·특수기호·
              기재금지어·기관명·상호명 점검은 2026 학교생활기록부 기재요령의 주요 기준을
              바탕으로 한 보조 탐지이므로, 표시된 원문과 허용 예외를 직접 대조해 최종
              확인하세요.
            </p>
          </div>
        </main>
      )}

      <footer>
        <span>Record LENS · 학교생활기록부 종합점검</span>
        <span>학생부 기록의 최종 책임은 작성·확인자에게 있습니다.</span>
      </footer>

      {progress && (
        <div className="progress-overlay" role="status" aria-live="polite">
          <div className="progress-card">
            <div className="progress-orbit">
              <FileSpreadsheet size={28} />
            </div>
            <span className="progress-stage">
              {progress.stage === "reading"
                ? "파일 읽기"
                : progress.stage === "cleaning"
                  ? "데이터 정리"
                  : "유사도 분석"}
            </span>
            <h2>{progress.label}</h2>
            <p>창을 닫지 않아도 다른 작업을 계속할 수 있습니다.</p>
            <div className="progress-track">
              <span style={{ width: `${Math.max(4, progressWidth)}%` }} />
            </div>
            <strong>{Math.round(progressWidth)}%</strong>
          </div>
        </div>
      )}

      {activeRecord && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedRecord(null);
          }}
        >
          <section className="compare-modal" role="dialog" aria-modal="true" aria-labelledby="compare-title">
            <div className="modal-header">
              <div>
                <span className={`status-badge ${riskStatus(activeRecord, threshold)}`}>
                  <i />
                  {riskLabel(riskStatus(activeRecord, threshold))}
                </span>
                <h2 id="compare-title">기록 종합점검</h2>
              </div>
              <button type="button" onClick={() => setSelectedRecord(null)} aria-label="상세 창 닫기">
                <X size={20} />
              </button>
            </div>
            {activeRecord.issues.length > 0 && (
              <>
                <section className="inspection-source">
                  <div>
                    <strong>지적 위치가 표시된 원문</strong>
                    <small>색칠된 표현에 마우스를 올리면 점검 이유가 표시됩니다.</small>
                  </div>
                  <p>
                    <InspectionHighlightedText
                      text={activeRecord.text}
                      issues={activeRecord.issues}
                    />
                  </p>
                </section>
                <section className="rule-findings">
                  <div className="rule-findings-heading">
                    <div>
                      <span>기재요령 보조 점검</span>
                      <h3>확인할 표현 {activeRecord.issues.length}건</h3>
                    </div>
                    <small>자동 탐지 결과이므로 문맥과 예외를 확인하세요.</small>
                  </div>
                  <div className="rule-finding-list">
                    {activeRecord.issues.map((issue, index) => (
                      <article key={`${issue.type}-${issue.index}-${index}`}>
                        <div>
                          <span className={`inspection-chip ${issue.severity}`}>{issue.label}</span>
                          <strong>{issue.match}</strong>
                          <small>{issue.reference}</small>
                          <button
                            type="button"
                            className="exception-button"
                            title="이 지적을 집계와 결과에서 제외합니다"
                            onClick={() => toggleException(issueKeyOf(activeRecord, issue))}
                          >
                            예외 처리
                          </button>
                        </div>
                        <p>{issue.guidance}</p>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}
            {(activeRecord.exceptedIssues?.length ?? 0) > 0 && (
              <section className="excepted-findings">
                <div>
                  <strong>예외 처리된 표현 {activeRecord.exceptedIssues?.length}건</strong>
                  <small>집계·저장본·엑셀에서 빠집니다. 해제하면 되살아납니다.</small>
                </div>
                <ul>
                  {activeRecord.exceptedIssues?.map((issue, index) => (
                    <li key={`${issue.type}-${issue.index}-${index}`}>
                      <span className="inspection-chip">{issue.label}</span>
                      <s>{issue.match}</s>
                      <button
                        type="button"
                        onClick={() => toggleException(issueKeyOf(activeRecord, issue))}
                      >
                        해제
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {(() => {
              const reused = reusedSentencesOf(activeRecord, sentenceReuseCounts);
              if (!reused.length) return null;
              return (
                <section className="reuse-section">
                  <div>
                    <strong>재사용된 문장</strong>
                    <small>
                      이 기록의 문장이 전체 업로드에서 몇 개의 기록에 그대로 나오는지입니다.
                    </small>
                  </div>
                  <ul>
                    {reused.map((sentence) => (
                      <li key={sentence.text}>
                        <span>{sentence.text}</span>
                        <b>{sentence.count}개 기록</b>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })()}
            {activeRecord.matchText && (
              <>
                <div className="similarity-callout">
                  <div>
                    <span>자카드 유사도</span>
                    <strong>{formatPercent(activeRecord.similarity)}</strong>
                  </div>
                  <p>
                    완전 일치 문장 {exactSentenceCount(activeRecord)}개 · 실제 공통 고유 단어{" "}
                    {sharedKeywordCount(activeRecord)}개
                  </p>
                </div>
                <div className="highlight-legend" aria-label="문장 강조 표시 안내">
                  <span>
                    <i className="exact" />
                    완전 일치 문장·공통 부분
                  </span>
                  <span>
                    <i className="similar" />
                    문장 내 다른 부분
                  </span>
                  <small>붉은 음영은 같은 부분, 붉은 글자는 서로 다른 부분입니다.</small>
                </div>
                <div className="comparison-grid" onMouseOver={linkPair} onMouseOut={clearPair}>
                  <article>
                    <div className="comparison-label">
                      <span>A</span>
                      <div>
                        <strong>{activeRecord.name}</strong>
                        <small>
                          {activeRecord.className} · {activeRecord.subject}
                        </small>
                      </div>
                    </div>
                    <HighlightedComparisonText
                      text={activeRecord.text}
                      comparisonText={activeRecord.matchText}
                      pairFrom="match"
                    />
                  </article>
                  <article>
                    <div className="comparison-label">
                      <span>B</span>
                      <div>
                        <strong>{activeRecord.matchName || "비교 대상"}</strong>
                        <small>가장 유사한 다른 기록</small>
                      </div>
                    </div>
                    <HighlightedComparisonText
                      text={activeRecord.matchText}
                      comparisonText={activeRecord.text}
                      pairFrom="self"
                    />
                  </article>
                </div>
                <div className="keyword-section">
                  <span>두 기록의 공통 단어 목록</span>
                  <div>
                    {sharedKeywords(activeRecord).map((keyword) => (
                      <i key={keyword}>{keyword}</i>
                    ))}
                    {!sharedKeywords(activeRecord).length && (
                      <small>공통 핵심 단어가 없습니다.</small>
                    )}
                  </div>
                  <p className="keyword-note">
                    ※ 아래 기록을 대조하여 공통 단어 목록은 최대 18개까지 표시합니다. 유사도
                    계산은 두 기록의 전체 고유 단어를 사용합니다.
                  </p>
                </div>
              </>
            )}
            <div className="modal-footer">
              <span>
                원본: {activeRecord.sourceFile} · {activeRecord.sourceRow}행
              </span>
              <div className="modal-nav" aria-label="기록 이동">
                <button
                  className="modal-nav-button"
                  type="button"
                  onClick={() => openNeighbor(-1)}
                  disabled={selectedIndex <= 0}
                  aria-label="이전 기록"
                >
                  <ChevronLeft size={16} />
                  이전
                </button>
                <span className="modal-nav-position">
                  {selectedIndex + 1} / {filteredRecords.length}
                </span>
                <button
                  className="modal-nav-button"
                  type="button"
                  onClick={() => openNeighbor(1)}
                  disabled={selectedIndex < 0 || selectedIndex >= filteredRecords.length - 1}
                  aria-label="다음 기록"
                >
                  다음
                  <ChevronRight size={16} />
                </button>
                <button className="modal-confirm" type="button" onClick={confirmAndAdvance}>
                  <Check size={16} />
                  {checkedKeys.has(activeRecord.checkKey) ? "확인됨 · 다음" : "확인 완료 · 다음"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
