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

type RiskStatus = "exact" | "high" | "review" | "normal";

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
};

type DiffSegment = {
  text: string;
  changed: boolean;
};

const PAGE_SIZE = 30;
const HEADER_TEXT = "세부능력 및 특기사항";
const ACCEPTED_EXTENSIONS = [".xls", ".xlsx", ".xlsm", ".xlsb"];

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
  const prepared: SourceRow[] = rows.map((row, index) => ({
    cells: ["", ...Array.from({ length: 6 }, (_, column) => cellText(row[column]))],
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

const KNOWN_SUBJECTS = new Set([
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
]);

function isNeisExport(rows: unknown[][]) {
  return rows.some((row) => {
    const values = row.slice(0, 4).map(cellText);
    return (
      normalizeHeader(values[0]).includes("번호") &&
      normalizeHeader(values[1]).includes("성명") &&
      normalizeHeader(values[2]).includes("학년") &&
      normalizeHeader(values[3]).includes(normalizeHeader(HEADER_TEXT))
    );
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function subjectNamesFromRows(rows: unknown[][]) {
  const counts = new Map<string, number>();
  const atCellStart = new Set<string>();
  const candidatePattern =
    /(?:^|[.!?]\s+|\([12]학기\)\s*)([가-힣A-Za-z][가-힣A-Za-z0-9· ]{0,24}):\s*/g;

  for (const row of rows) {
    const text = cellText(row[3]);
    for (const match of text.matchAll(candidatePattern)) {
      const candidate = cleanVisibleText(match[1]);
      if (!candidate || /\d/.test(candidate) || candidate.endsWith("에서")) continue;
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      if (
        match.index === 0 ||
        /^\([12]학기\)\s*/.test(text) ||
        text.slice(0, match.index).trim() === ""
      ) {
        atCellStart.add(candidate);
      }
    }
  }

  return [...new Set([...KNOWN_SUBJECTS, ...counts.keys()])]
    .filter(
      (candidate) =>
        KNOWN_SUBJECTS.has(candidate) ||
        atCellStart.has(candidate) ||
        (counts.get(candidate) ?? 0) >= 2,
    )
    .sort((a, b) => b.length - a.length);
}

function parseNeisRows(rows: unknown[][], sourceFile: string): CheckRecord[] {
  const subjects = subjectNamesFromRows(rows);
  const subjectAlternation = subjects.map(escapeRegExp).join("|");
  const subjectPattern = new RegExp(
    `(?:\\([12]학기\\)\\s*)?(${subjectAlternation}):\\s*`,
    "g",
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
      if (!existing.text.includes(cleanChunk)) existing.text = `${existing.text} ${cleanChunk}`.trim();
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

  rows.forEach((rawRow, rowIndex) => {
    const row = Array.from({ length: 12 }, (_, column) => cellText(rawRow[column]));
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

    subjectPattern.lastIndex = 0;
    const matches = [...detail.matchAll(subjectPattern)];
    if (!matches.length) {
      appendChunk(currentSubject, detail, rowIndex + 1, false);
      return;
    }

    const leading = detail.slice(0, matches[0].index).trim();
    if (leading) appendChunk(currentSubject, leading, rowIndex + 1, false);

    matches.forEach((match, matchIndex) => {
      const subject = cleanVisibleText(match[1]);
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[matchIndex + 1]?.index ?? detail.length;
      const chunk = detail.slice(start, end);
      currentSubject = subject;
      appendChunk(subject, chunk, rowIndex + 1, true);
    });
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
      };
    });
}

function mergeCheckRecords(records: CheckRecord[]) {
  const merged = new Map<string, CheckRecord>();

  for (const record of records) {
    const key = [record.className, record.grade, record.subject, record.name].join("|");
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
      const text = cells[6];
      const normalizedText = normalizeText(text);

      return {
        id: `record-${index}-${row.sourceRow}`,
        className: className || "학급 미상",
        grade: cleanVisibleText(grade) || "학년 미상",
        subject: cleanVisibleText(subject) || "과목 미상",
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

    if (index % 40 === 0 || index === analyzed.length - 1) {
      onProgress(Math.round(((index + 1) / Math.max(1, analyzed.length)) * 100));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  return analyzed;
}

function riskStatus(record: CheckRecord, threshold: number): RiskStatus {
  if (record.exactGroupSize > 1 || record.similarity >= 0.9995) return "exact";
  if (record.similarity >= threshold) return "high";
  if (record.similarity >= Math.max(0.45, threshold - 0.2)) return "review";
  return "normal";
}

function riskLabel(status: RiskStatus) {
  return {
    exact: "완전 일치",
    high: "높은 유사도",
    review: "확인 권장",
    normal: "특이 없음",
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
  ];

  return samples.map((sample, index) => {
    const text = sample[4];
    const normalizedText = normalizeText(text);
    return {
      id: `demo-${index}`,
      className: sample[0],
      grade: sample[1],
      subject: sample[2],
      name: sample[3],
      text,
      sourceFile: "익명 예시 자료.xlsx",
      sourceRow: index + 5,
      rawCells: [sample[0], "", sample[1], "", sample[2], sample[3], text],
      normalizedText,
      tokens: [...new Set(normalizedText.split(" ").filter(Boolean))],
      similarity: 0,
      matchId: null,
      matchName: "",
      matchText: "",
      exactGroupSize: 1,
    };
  });
}

function sharedKeywords(record: CheckRecord) {
  if (!record.matchText) return [];
  const other = new Set(normalizeText(record.matchText).split(" "));
  return record.tokens.filter((token) => token.length > 1 && other.has(token)).slice(0, 18);
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
    let matchedText = "";
    let exact = false;

    for (const candidate of comparisonSentences) {
      const candidateNormalized = normalizeText(candidate);
      if (normalized.length >= 8 && normalized === candidateNormalized) {
        exact = true;
        bestScore = 1;
        matchedText = candidate;
        break;
      }

      const result = sentenceSimilarity(sentence, candidate);
      if (result.score > bestScore) {
        bestScore = result.score;
        bestIntersection = result.intersection;
        matchedText = candidate;
      }
    }

    return {
      text: sentence,
      level: exact ? "exact" : bestScore >= 0.5 && bestIntersection >= 3 ? "similar" : "none",
      score: bestScore,
      matchedText,
    };
  });
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
}: {
  text: string;
  comparisonText: string;
}) {
  return (
    <p className="comparison-text">
      {highlightSentences(text, comparisonText).map((sentence, index) => {
        if (sentence.level === "none") {
          return <span key={`${index}-${sentence.text}`}>{sentence.text}</span>;
        }

        const label = sentence.level === "exact" ? "완전 일치" : "높은 유사도";
        if (sentence.level === "similar") {
          return (
            <span
              className="sentence-highlight similar"
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlightedReportHtml(text: string, comparisonText: string) {
  return highlightSentences(text, comparisonText)
    .map((sentence) => {
      const content = escapeHtml(sentence.text);
      if (sentence.level === "none") return content;
      const label = sentence.level === "exact" ? "완전 일치" : "높은 유사도";
      if (sentence.level === "similar") {
        const diffContent = diffSegments(sentence.text, sentence.matchedText)
          .map((segment) => {
            if (segment.changed) {
              return `<span class="diff-fragment">${escapeHtml(segment.text)}</span>`;
            }
            if (/[\p{L}\p{N}]/u.test(segment.text)) {
              return `<mark class="common-fragment">${escapeHtml(segment.text)}</mark>`;
            }
            return escapeHtml(segment.text);
          })
          .join("");
        return `<span class="similar" title="${label} ${formatPercent(sentence.score)} · 같은 부분은 음영, 다른 부분은 붉은 글자">${diffContent}</span>`;
      }
      return `<mark class="${sentence.level}" title="${label} ${formatPercent(sentence.score)}">${content}</mark>`;
    })
    .join("");
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
  const [sortMode, setSortMode] = useState<"risk" | "name" | "subject">("risk");
  const [page, setPage] = useState(1);
  const [selectedRecord, setSelectedRecord] = useState<CheckRecord | null>(null);
  const [reportTime, setReportTime] = useState("");

  useEffect(() => {
    if (!selectedRecord) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedRecord(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedRecord]);

  const counts = useMemo(() => {
    const initial = { exact: 0, high: 0, review: 0, normal: 0 };
    return records.reduce((accumulator, record) => {
      accumulator[riskStatus(record, threshold)] += 1;
      return accumulator;
    }, initial);
  }, [records, threshold]);

  const subjectSummaries = useMemo<SubjectSummary[]>(() => {
    const map = new Map<string, SubjectSummary>();
    for (const record of records) {
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
  }, [records, threshold]);

  const filteredRecords = useMemo(() => {
    const term = normalizeText(search);
    const filtered = records.filter((record) => {
      const status = riskStatus(record, threshold);
      if (riskFilter !== "all" && status !== riskFilter) return false;
      if (!term) return true;
      return normalizeText(
        `${record.name} ${record.className} ${record.subject} ${record.text} ${record.matchName}`,
      ).includes(term);
    });

    return filtered.sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name, "ko");
      if (sortMode === "subject") return a.subject.localeCompare(b.subject, "ko");
      return b.similarity - a.similarity || a.name.localeCompare(b.name, "ko");
    });
  }, [records, riskFilter, search, sortMode, threshold]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const visibleRecords = filteredRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

  function changeSortMode(value: "risk" | "name" | "subject") {
    setSortMode(value);
    setPage(1);
  }

  async function finishAnalysis(baseRecords: CheckRecord[], files: string[]) {
    if (!baseRecords.length) {
      throw new Error(
        "세부능력 및 특기사항 데이터를 찾지 못했습니다. 나이스에서 내려받은 파일의 Sheet1 구조를 확인해 주세요.",
      );
    }

    setProgress({ stage: "comparing", value: 0, label: "문장 유사도를 비교하고 있습니다" });
    const analyzed = await analyzeSimilarity(baseRecords, (value) =>
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
      setError("엑셀 파일(.xls, .xlsx, .xlsm, .xlsb)을 선택해 주세요.");
      return;
    }

    try {
      setProgress({ stage: "reading", value: 5, label: "엑셀 파일을 안전하게 읽고 있습니다" });
      const sourceRows: SourceRow[] = [];
      const parsedRecords: CheckRecord[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
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
        if (isNeisExport(rows)) {
          parsedRecords.push(...parseNeisRows(rows, file.name));
        } else {
          sourceRows.push(...preprocessRows(rows, file.name));
        }
        setProgress({
          stage: "reading",
          value: Math.round(((index + 1) / files.length) * 55),
          label: `${file.name} 읽는 중`,
        });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      setProgress({ stage: "cleaning", value: 68, label: "학급·과목 정보를 정리하고 있습니다" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
    setSelectedRecord(null);
    setPage(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportWorkbook() {
    const workbook = XLSX.utils.book_new();
    const cleanedRows = [
      ["학년 반", "학년", "과목", "이름", HEADER_TEXT, "원본 파일", "원본 행"],
      ...records.map((record) => [
        record.className,
        record.grade,
        record.subject,
        record.name,
        record.text,
        record.sourceFile,
        record.sourceRow,
      ]),
    ];
    const checkRows = [
      ["이름", "내용", "최대 일치율", "일치하는 문장(가장 유사한 행 기준)", "일치 이름", "점검 결과"],
      ...records.map((record) => [
        record.name,
        record.text,
        record.similarity,
        record.matchText,
        record.matchName,
        riskLabel(riskStatus(record, threshold)),
      ]),
    ];
    const grades = [...new Set(records.map((record) => record.grade))].sort((a, b) =>
      a.localeCompare(b, "ko"),
    );
    const summaryRows = [
      ["과목", ...grades, "합계", "완전 일치", "높은 유사도", "확인 권장"],
      ...subjectSummaries.map((summary) => [
        summary.subject,
        ...grades.map((grade) => summary.grades[grade] ?? 0),
        summary.total,
        summary.exact,
        summary.high,
        summary.review,
      ]),
    ];

    const cleanedSheet = XLSX.utils.aoa_to_sheet(cleanedRows);
    const checkSheet = XLSX.utils.aoa_to_sheet(checkRows);
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    cleanedSheet["!cols"] = [
      { wch: 13 },
      { wch: 9 },
      { wch: 18 },
      { wch: 12 },
      { wch: 90 },
      { wch: 30 },
      { wch: 10 },
    ];
    checkSheet["!cols"] = [
      { wch: 12 },
      { wch: 75 },
      { wch: 14 },
      { wch: 75 },
      { wch: 12 },
      { wch: 14 },
    ];
    summarySheet["!cols"] = Array.from({ length: summaryRows[0].length }, (_, index) => ({
      wch: index === 0 ? 20 : 13,
    }));

    for (let row = 2; row <= records.length + 1; row += 1) {
      const cell = checkSheet[`C${row}`];
      if (cell) cell.z = "0%";
    }

    XLSX.utils.book_append_sheet(workbook, cleanedSheet, "과세특 정리");
    XLSX.utils.book_append_sheet(workbook, checkSheet, "생기부 점검");
    XLSX.utils.book_append_sheet(workbook, summarySheet, "분석자료");
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    XLSX.writeFile(workbook, `과세특_점검결과_${date}.xlsx`, { compression: true });
  }

  function exportHtmlReport() {
    const generatedAt =
      reportTime ||
      new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date());
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const orderedRecords = [...filteredRecords];
    const currentRiskLabel = riskFilter === "all" ? "전체 위험도" : riskLabel(riskFilter);
    const currentSortLabel =
      sortMode === "name" ? "이름 순" : sortMode === "subject" ? "과목 순" : "유사도 높은 순";
    const checkedCount = counts.exact + counts.high + counts.review;
    const reportRows = orderedRecords
      .map((record, index) => {
        const status = riskStatus(record, threshold);
        return `
          <tr>
            <td><span class="status-badge ${status}"><i></i>${escapeHtml(riskLabel(status))}</span></td>
            <td><strong class="student-name">${escapeHtml(record.name)}</strong><span class="muted">${escapeHtml(record.className)}</span></td>
            <td><span class="subject-chip">${escapeHtml(record.subject)}</span></td>
            <td><strong class="similarity-number ${status}">${formatPercent(record.similarity)}</strong>${
              record.matchName
                ? `<span class="muted">↔ ${escapeHtml(record.matchName)}</span>`
                : ""
            }</td>
            <td><p class="record-preview">${escapeHtml(record.text)}</p></td>
            <td>${
              record.matchText
                ? `<a class="compare-button" href="#comparison-${index + 1}">비교 <b>›</b></a>`
                : '<span class="compare-button disabled">비교</span>'
            }</td>
          </tr>`;
      })
      .join("");
    const comparisonDialogs = orderedRecords
      .map((record, index) => {
        if (!record.matchText) return "";
        const status = riskStatus(record, threshold);
        const keywords = sharedKeywords(record);
        return `
          <section class="compare-dialog" id="comparison-${index + 1}" aria-label="유사 문장 비교">
            <a class="dialog-backdrop" href="#results" aria-label="비교 창 닫기"></a>
            <article class="dialog-sheet">
              <header class="dialog-header">
                <div>
                  <span class="status-badge ${status}"><i></i>${escapeHtml(riskLabel(status))}</span>
                  <h2>유사 문장 나란히 보기</h2>
                </div>
                <a class="dialog-close" href="#results" aria-label="비교 창 닫기">×</a>
              </header>
              <div class="similarity-callout">
                <div><span>자카드 유사도</span><strong>${formatPercent(record.similarity)}</strong></div>
                <p>공통 단어 ${keywords.length}개를 기준으로 가장 가까운 기록을 찾았습니다.</p>
              </div>
              <div class="highlight-guide">
                <span><i class="exact"></i>완전 일치 문장·공통 부분</span>
                <span><i class="similar"></i>문장 내 다른 부분</span>
              </div>
              <div class="comparison-grid">
                <section>
                  <h3>A · ${escapeHtml(record.name)}</h3>
                  <small>${escapeHtml(record.className)} · ${escapeHtml(record.subject)}</small>
                  <p>${highlightedReportHtml(record.text, record.matchText)}</p>
                </section>
                <section>
                  <h3>B · ${escapeHtml(record.matchName || "비교 대상")}</h3>
                  <small>가장 유사한 다른 기록</small>
                  <p>${highlightedReportHtml(record.matchText, record.text)}</p>
                </section>
              </div>
              ${
                keywords.length
                  ? `<div class="keywords"><span>두 문장에 함께 나온 주요 단어</span>${keywords
                      .map((keyword) => `<i>${escapeHtml(keyword)}</i>`)
                      .join("")}</div>`
                  : ""
              }
              <footer>원본: ${escapeHtml(record.sourceFile)} · ${record.sourceRow}행</footer>
            </article>
          </section>`;
      })
      .join("");
    const subjectItems = subjectSummaries
      .slice(0, 5)
      .map(
        (summary) => `
          <div class="subject-row">
            <span>${escapeHtml(summary.subject)}</span>
            <i><b style="width:${Math.max(
              4,
              ((summary.exact + summary.high) / Math.max(1, summary.total)) * 100,
            )}%"></b></i>
            <strong>${(summary.exact + summary.high).toLocaleString("ko-KR")}건</strong>
          </div>`,
      )
      .join("");
    const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>과세특 점검 결과 · ${escapeHtml(generatedAt)}</title>
  <style>
    :root { color-scheme:light; --navy:#15365d; --navy-deep:#102d50; --teal:#12998b; --teal-dark:#0f766e; --ink:#172b45; --ink-soft:#607086; --line:#dce4ea; --danger:#d85050; --danger-soft:#fff0ee; --warning:#d1841d; --warning-soft:#fff6e7; --review:#7a60b3; --review-soft:#f4efff; --mint:#e6f7f2; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; background:#f5f8f7; color:var(--ink); font-family:"Noto Sans KR","Malgun Gothic",sans-serif; line-height:1.65; }
    .topbar { display:flex; align-items:center; justify-content:space-between; min-height:62px; padding:0 max(24px,calc((100% - 1180px)/2)); border-bottom:1px solid rgba(220,228,234,.85); background:rgba(255,255,255,.92); }
    .brand { display:grid; grid-template-columns:34px auto; column-gap:9px; align-items:center; }
    .brand-mark { display:grid; grid-row:1/3; width:34px; height:34px; place-items:center; border-radius:10px; background:var(--navy); color:white; font-weight:900; }
    .brand strong { align-self:end; font-size:12px; }
    .brand small { align-self:start; color:#8a98a8; font-size:8px; }
    .topbar > span { color:#6f7e90; font-size:10px; }
    .report-main { width:min(1180px,calc(100% - 40px)); margin:0 auto; padding:36px 0 80px; }
    .report-hero { display:flex; align-items:flex-end; justify-content:space-between; gap:30px; padding:28px 0 32px; }
    .eyebrow { color:var(--teal-dark); font-size:10px; font-weight:800; }
    .report-hero h1 { margin:12px 0 10px; font-size:clamp(34px,4vw,50px); letter-spacing:-.055em; line-height:1.12; }
    .report-hero p { max-width:760px; margin:0; color:var(--ink-soft); font-size:14px; }
    .saved-chip { flex:0 0 auto; padding:13px 17px; border:1px solid #cbd8df; border-radius:13px; background:white; color:var(--navy); font-size:11px; font-weight:800; }
    .summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
    .summary-card { display:grid; grid-template-columns:44px 1fr; grid-template-rows:auto auto auto; column-gap:14px; padding:21px; border:1px solid var(--line); border-radius:17px; background:white; box-shadow:0 8px 30px rgba(21,54,93,.045); }
    .summary-icon { display:grid; grid-row:1/4; width:44px; height:44px; place-items:center; border-radius:13px; font-size:13px; font-weight:900; }
    .summary-card > span { color:#758397; font-size:11px; font-weight:700; }
    .summary-card > strong { margin-top:5px; font-size:28px; letter-spacing:-.04em; }
    .summary-card > small { margin-top:3px; color:#9aa6b4; font-size:9px; }
    .summary-card.primary .summary-icon { background:#eaf3ff; color:var(--navy); }
    .summary-card.danger .summary-icon { background:var(--danger-soft); color:var(--danger); }
    .summary-card.warning .summary-icon { background:var(--warning-soft); color:var(--warning); }
    .summary-card.calm .summary-icon { background:var(--mint); color:var(--teal-dark); }
    .insight-grid { display:grid; grid-template-columns:1.2fr .8fr; gap:16px; margin-top:16px; }
    .panel,.results-panel { border:1px solid var(--line); border-radius:19px; background:white; box-shadow:0 8px 30px rgba(21,54,93,.045); }
    .panel { padding:25px; }
    .card-title-row { display:flex; align-items:center; justify-content:space-between; }
    .section-kicker { color:var(--teal-dark); font-size:9px; }
    .card-title-row h2,.results-heading h2 { margin:5px 0 0; font-size:18px; letter-spacing:-.04em; }
    .issue-total { padding:7px 10px; border-radius:9px; background:#f3f6f8; color:#607086; font-size:10px; font-weight:800; }
    .distribution-bar { display:flex; height:10px; margin:26px 0 18px; overflow:hidden; border-radius:99px; background:#edf1f3; }
    .distribution-bar span { display:block; }
    .exact-fill,.legend-dot.exact { background:var(--danger); }
    .high-fill,.legend-dot.high { background:#e79a35; }
    .review-fill,.legend-dot.review { background:var(--review); }
    .normal-fill,.legend-dot.normal { background:#75b9ae; }
    .distribution-legend { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
    .legend-item { display:grid; grid-template-columns:8px 1fr auto; align-items:center; gap:7px; padding:9px 8px; border-radius:10px; background:#fafbf9; }
    .legend-dot { width:7px; height:7px; border-radius:50%; }
    .legend-item span { color:#65758a; font-size:9px; }
    .legend-item strong { font-size:11px; }
    .threshold { margin-top:22px; padding-top:16px; border-top:1px solid #edf1f3; }
    .threshold-label { display:flex; justify-content:space-between; color:#65758a; font-size:10px; }
    .threshold-label strong { color:var(--teal-dark); font-size:12px; }
    .threshold-track { position:relative; height:5px; margin-top:13px; border-radius:99px; background:#e5eaed; }
    .threshold-track span { display:block; height:100%; border-radius:inherit; background:var(--teal); }
    .threshold-track i { position:absolute; top:50%; width:15px; height:15px; border-radius:50%; background:var(--teal); transform:translate(-50%,-50%); }
    .subject-list { display:flex; flex-direction:column; gap:5px; margin-top:18px; }
    .subject-row { display:grid; grid-template-columns:92px 1fr 42px; align-items:center; gap:10px; padding:8px; }
    .subject-row > span { overflow:hidden; font-size:10px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
    .subject-row > i { height:5px; overflow:hidden; border-radius:99px; background:#edf1f3; }
    .subject-row > i b { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#e19632,#d9604c); }
    .subject-row > strong { color:#66768b; font-size:10px; text-align:right; }
    .results-panel { margin-top:16px; overflow:hidden; }
    .results-heading { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:23px 25px; border-bottom:1px solid var(--line); }
    .results-heading h2 em { margin-left:5px; color:var(--teal-dark); font-size:13px; font-style:normal; }
    .snapshot-controls { display:flex; align-items:center; gap:8px; }
    .snapshot-search,.snapshot-select { height:38px; padding:0 12px; border:1px solid var(--line); border-radius:10px; background:#fbfcfc; color:#718095; font-size:10px; line-height:36px; }
    .snapshot-search { width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .table-wrap { overflow-x:auto; }
    table { width:100%; min-width:1000px; border-collapse:collapse; table-layout:fixed; }
    th { padding:12px 14px; border-bottom:1px solid var(--line); background:#f7f9f8; color:#728095; font-size:9px; font-weight:800; text-align:left; }
    th:nth-child(1){width:120px} th:nth-child(2){width:120px} th:nth-child(3){width:100px} th:nth-child(4){width:115px} th:nth-child(6){width:75px}
    td { padding:15px 14px; border-bottom:1px solid #edf1f3; vertical-align:middle; }
    tbody tr:hover { background:#fbfdfc; }
    .status-badge { display:inline-flex; align-items:center; gap:6px; padding:6px 8px; border-radius:8px; font-size:9px; font-weight:800; white-space:nowrap; }
    .status-badge i { width:6px; height:6px; border-radius:50%; }
    .status-badge.exact { background:var(--danger-soft); color:#b33d3d; } .status-badge.exact i { background:var(--danger); }
    .status-badge.high { background:var(--warning-soft); color:#a86416; } .status-badge.high i { background:var(--warning); }
    .status-badge.review { background:var(--review-soft); color:#6f55ab; } .status-badge.review i { background:var(--review); }
    .status-badge.normal { background:var(--mint); color:var(--teal-dark); } .status-badge.normal i { background:var(--teal); }
    .student-name,.similarity-number { display:block; font-size:11px; }
    .similarity-number { font-size:14px; } .similarity-number.exact { color:var(--danger); } .similarity-number.high { color:var(--warning); } .similarity-number.review { color:var(--review); } .similarity-number.normal { color:var(--teal-dark); }
    .muted { display:block; margin-top:4px; overflow:hidden; color:#8b98a7; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
    .subject-chip { display:inline-block; max-width:100%; overflow:hidden; padding:5px 8px; border-radius:7px; background:#eef4fa; color:#415b77; font-size:9px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
    .record-preview { display:-webkit-box; margin:0; overflow:hidden; color:#40556d; font-size:10px; line-height:1.75; -webkit-box-orient:vertical; -webkit-line-clamp:3; }
    .compare-button { display:inline-flex; align-items:center; gap:3px; padding:7px 8px; border:1px solid var(--line); border-radius:9px; background:white; color:var(--navy); font-size:9px; font-weight:800; text-decoration:none; }
    .compare-button b { font-size:14px; } .compare-button.disabled { color:#a8b1bc; }
    .table-footer { padding:14px 24px; color:#7d8a99; font-size:10px; text-align:right; }
    .report-notice { margin-top:16px; padding:15px 18px; border:1px solid #dbe7e3; border-radius:13px; background:#f3faf7; color:#557068; font-size:10px; }
    .site-footer { display:flex; justify-content:space-between; padding:22px max(24px,calc((100% - 1180px)/2)); border-top:1px solid var(--line); background:white; color:#8794a3; font-size:9px; }
    .compare-dialog { display:none; position:fixed; z-index:20; inset:0; place-items:center; padding:24px; }
    .compare-dialog:target { display:grid; }
    .dialog-backdrop { position:absolute; inset:0; background:rgba(8,28,50,.58); }
    .dialog-sheet { position:relative; z-index:1; width:min(900px,100%); max-height:calc(100vh - 48px); overflow:auto; border-radius:20px; background:white; box-shadow:0 28px 80px rgba(7,27,49,.28); }
    .dialog-header { display:flex; align-items:flex-start; justify-content:space-between; padding:22px 25px; border-bottom:1px solid var(--line); }
    .dialog-header h2 { margin:10px 0 0; font-size:20px; }
    .dialog-close { display:grid; width:34px; height:34px; place-items:center; border-radius:10px; background:#f3f6f8; color:var(--navy); font-size:24px; text-decoration:none; }
    .similarity-callout { display:flex; align-items:center; justify-content:space-between; gap:20px; margin:18px 25px 0; padding:18px 20px; border-radius:14px; background:var(--navy-deep); color:white; }
    .similarity-callout span { color:#adc0d4; font-size:9px; } .similarity-callout strong { display:block; color:#62d4c5; font-size:28px; }
    .similarity-callout p { margin:0; color:#c8d5e3; font-size:10px; }
    .highlight-guide { display:flex; gap:18px; padding:15px 25px 0; color:#66768b; font-size:9px; font-weight:700; }
    .highlight-guide span { display:flex; align-items:center; gap:6px; } .highlight-guide i { width:13px; height:13px; border-radius:4px; }
    .highlight-guide i.exact { background:#ffe0dc; } .highlight-guide i.similar { position:relative; background:white; box-shadow:inset 0 0 0 1px #efb7b2; }
    .highlight-guide i.similar::after { position:absolute; inset:-2px 0 0; color:#bd3f3f; content:"가"; font-size:9px; font-style:normal; text-align:center; }
    .comparison-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:18px 25px; }
    .comparison-grid > section { padding:18px; border:1px solid var(--line); border-radius:14px; background:#fbfcfc; }
    .comparison-grid h3 { margin:0; font-size:12px; } .comparison-grid small { color:#8795a5; font-size:9px; }
    .comparison-grid p { min-height:120px; margin:14px 0 0; color:#40556d; font-size:11px; line-height:1.85; white-space:pre-wrap; }
    mark { margin:0 -1px; padding:2px 3px; border-radius:4px; color:inherit; box-decoration-break:clone; -webkit-box-decoration-break:clone; }
    mark.exact { background:#ffe0dc; box-shadow:inset 0 -1px 0 rgba(198,66,66,.24); }
    .similar .common-fragment { background:#ffe0dc; box-shadow:inset 0 -1px 0 rgba(198,66,66,.24); }
    .similar .diff-fragment { color:#bd3f3f; font-weight:800; }
    .keywords { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:0 25px 18px; }
    .keywords span { margin-right:4px; color:#65758a; font-size:9px; font-weight:700; }
    .keywords i { padding:4px 7px; border-radius:7px; background:#e6f7f2; color:var(--teal); font-size:8px; font-style:normal; font-weight:700; }
    .dialog-sheet > footer { padding:12px 25px; border-top:1px solid var(--line); background:#f8faf9; color:#8b98a7; font-size:9px; }
    @media (max-width:900px) { .summary-grid{grid-template-columns:repeat(2,1fr)} .insight-grid,.comparison-grid{grid-template-columns:1fr} .report-hero,.results-heading{align-items:flex-start;flex-direction:column} .snapshot-controls{width:100%;flex-wrap:wrap} .snapshot-search{flex:1} }
    @media (max-width:560px) { .report-main{width:min(100% - 24px,1180px)} .summary-grid{grid-template-columns:1fr} .distribution-legend{grid-template-columns:repeat(2,1fr)} .topbar>span{display:none} .site-footer{gap:12px;flex-direction:column} }
    @media print { body{background:white} .topbar,.saved-chip,.compare-dialog{display:none!important} .report-main{width:100%;padding:0} .panel,.results-panel,.summary-card{box-shadow:none} .table-wrap{overflow:visible} table{min-width:0} .compare-button{display:none} }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><span class="brand-mark">✓</span><strong>과세특 점검</strong><small>감사 점검 도우미</small></div>
    <span>저장된 결과 파일 · 학생 기록을 안전하게 보관해 주세요</span>
  </header>
  <main class="report-main">
    <section class="report-hero">
      <div>
        <div class="eyebrow">점검 완료 · ${escapeHtml(generatedAt)}</div>
        <h1>확인이 필요한 기록을 모았습니다.</h1>
        <p>${sourceFiles.length.toLocaleString("ko-KR")}개 파일에서 ${records.length.toLocaleString("ko-KR")}건을 정리했습니다. 유사도는 보조 지표이므로 원문을 함께 확인해 주세요.</p>
      </div>
      <div class="saved-chip">결과 화면 HTML 저장본</div>
    </section>
    <section class="summary-grid" aria-label="점검 요약">
      <article class="summary-card primary"><div class="summary-icon">전체</div><span>전체 기록</span><strong>${records.length.toLocaleString("ko-KR")}</strong><small>${sourceFiles.length.toLocaleString("ko-KR")}개 원본 파일</small></article>
      <article class="summary-card danger"><div class="summary-icon">!</div><span>완전 일치</span><strong>${counts.exact.toLocaleString("ko-KR")}</strong><small>정규화 후 100% 같은 문장</small></article>
      <article class="summary-card warning"><div class="summary-icon">≈</div><span>높은 유사도</span><strong>${counts.high.toLocaleString("ko-KR")}</strong><small>${Math.round(threshold * 100)}% 이상 유사한 문장</small></article>
      <article class="summary-card calm"><div class="summary-icon">✓</div><span>특이 없음</span><strong>${counts.normal.toLocaleString("ko-KR")}</strong><small>설정 기준 미만</small></article>
    </section>
    <section class="insight-grid">
      <article class="panel">
        <div class="card-title-row"><div><span class="section-kicker">점검 분포</span><h2>위험도별 기록</h2></div><div class="issue-total">${checkedCount.toLocaleString("ko-KR")}건 확인</div></div>
        <div class="distribution-bar" aria-label="위험도 분포">
          <span class="exact-fill" style="width:${(counts.exact / Math.max(1, records.length)) * 100}%"></span>
          <span class="high-fill" style="width:${(counts.high / Math.max(1, records.length)) * 100}%"></span>
          <span class="review-fill" style="width:${(counts.review / Math.max(1, records.length)) * 100}%"></span>
          <span class="normal-fill" style="width:${(counts.normal / Math.max(1, records.length)) * 100}%"></span>
        </div>
        <div class="distribution-legend">
          <div class="legend-item"><i class="legend-dot exact"></i><span>완전 일치</span><strong>${counts.exact.toLocaleString("ko-KR")}</strong></div>
          <div class="legend-item"><i class="legend-dot high"></i><span>높은 유사도</span><strong>${counts.high.toLocaleString("ko-KR")}</strong></div>
          <div class="legend-item"><i class="legend-dot review"></i><span>확인 권장</span><strong>${counts.review.toLocaleString("ko-KR")}</strong></div>
          <div class="legend-item"><i class="legend-dot normal"></i><span>특이 없음</span><strong>${counts.normal.toLocaleString("ko-KR")}</strong></div>
        </div>
        <div class="threshold">
          <div class="threshold-label"><span>높은 유사도 기준</span><strong>${Math.round(threshold * 100)}%</strong></div>
          <div class="threshold-track"><span style="width:${((threshold - 0.5) / 0.45) * 100}%"></span><i style="left:${((threshold - 0.5) / 0.45) * 100}%"></i></div>
        </div>
      </article>
      <article class="panel">
        <div class="card-title-row"><div><span class="section-kicker">과목별 현황</span><h2>우선 확인할 과목</h2></div><span>▥</span></div>
        <div class="subject-list">${subjectItems || '<p class="muted">과목 정보가 없습니다.</p>'}</div>
      </article>
    </section>
    <section class="results-panel" id="results">
      <div class="results-heading">
        <div><span class="section-kicker">상세 점검 결과</span><h2>기록별 비교 <em>${orderedRecords.length.toLocaleString("ko-KR")}</em></h2></div>
        <div class="snapshot-controls">
          <div class="snapshot-search">${search ? `검색: ${escapeHtml(search)}` : "이름, 학급, 과목, 내용 검색"}</div>
          <div class="snapshot-select">${escapeHtml(currentRiskLabel)}⌄</div>
          <div class="snapshot-select">${escapeHtml(currentSortLabel)}⌄</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>점검 결과</th><th>학생 / 학급</th><th>과목</th><th>최대 유사도</th><th>세부능력 및 특기사항</th><th>비교</th></tr></thead>
          <tbody>${reportRows || '<tr><td colspan="6">조건에 맞는 기록이 없습니다.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="table-footer">현재 조건에 맞는 전체 ${orderedRecords.length.toLocaleString("ko-KR")}건을 저장했습니다.</div>
    </section>
    <div class="report-notice">이 결과는 문장 내 고유 단어의 교집합과 합집합을 비교한 자카드 유사도입니다. 단어 순서와 교육적 맥락은 별도로 판단하지 않으므로, 표시된 두 문장을 직접 대조해 최종 확인하세요.</div>
  </main>
  <footer class="site-footer"><span>과세특 점검 도움자료 웹 버전</span><span>원본: ${escapeHtml(sourceFiles.join(", "))}</span><span>학생부 기록의 최종 책임은 작성·확인자에게 있습니다.</span></footer>
  ${comparisonDialogs}
</body>
</html>`;
    const blob = new Blob(["\uFEFF", html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `과세특_점검결과화면_${date}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const issueCount = counts.exact + counts.high + counts.review;
  const progressWidth = progress?.stage === "comparing" ? progress.value : progress?.value ?? 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={reset} aria-label="과세특 점검 홈">
          <span className="brand-mark">
            <FileCheck2 size={21} strokeWidth={2.2} />
          </span>
          <span>
            <strong>과세특 점검</strong>
            <small>감사 점검 도우미</small>
          </span>
        </button>
        <div className="privacy-badge">
          <LockKeyhole size={15} />
          <span>파일은 이 기기에서만 처리됩니다</span>
        </div>
      </header>

      {records.length === 0 ? (
        <main>
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span />
                학교생활기록부 · 과목별 세부능력 및 특기사항
              </div>
              <h1>
                과세특, 올리면
                <br />
                <em>바로 점검합니다.</em>
              </h1>
              <p>
                반별로 내려받은 엑셀을 한 번에 합치고, 중복 문장과 높은 유사도를 찾아
                확인이 필요한 기록부터 보여드립니다.
              </p>
              <div className="hero-points" aria-label="주요 기능">
                <span>
                  <Check size={16} /> 여러 파일 자동 병합
                </span>
                <span>
                  <Check size={16} /> 자카드 유사도 분석
                </span>
                <span>
                  <Check size={16} /> 점검 결과 엑셀·HTML 저장
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
                <small>XLS · XLSX · XLSM · XLSB</small>
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
            </div>
          </section>

          <section className="workflow-section">
            <div className="section-heading">
              <span>엑셀 매크로의 5단계를 한 번에</span>
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
                  title: "학급·과목 정보 보정",
                  text: "빈 셀과 분리된 값을 앞뒤 문맥에 맞게 채웁니다.",
                },
                {
                  number: "03",
                  icon: <RefreshCcw size={21} />,
                  title: "세특 문장 병합",
                  text: "같은 학생·과목에 나뉜 내용을 한 문장으로 정리합니다.",
                },
                {
                  number: "04",
                  icon: <BarChart3 size={21} />,
                  title: "중복·유사도 점검",
                  text: "완전 중복과 가장 유사한 문장을 과목별로 보여드립니다.",
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
                정리했습니다. 유사도는 보조 지표이므로 원문을 함께 확인해 주세요.
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
              <span>특이 없음</span>
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
                  <span>과목별 현황</span>
                  <h2>우선 확인할 과목</h2>
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
                        changeSearch(summary.subject);
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
                {!subjectSummaries.length && <p className="empty-copy">과목 정보가 없습니다.</p>}
              </div>
            </article>
          </section>

          <section className="results-panel" id="results">
            <div className="results-heading">
              <div>
                <span>상세 점검 결과</span>
                <h2>
                  기록별 비교 <em>{filteredRecords.length.toLocaleString("ko-KR")}</em>
                </h2>
              </div>
              <div className="results-actions">
                <div className="search-box">
                  <Search size={18} />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => changeSearch(event.target.value)}
                    placeholder="이름, 학급, 과목, 내용 검색"
                    aria-label="점검 결과 검색"
                  />
                  {search && (
                    <button type="button" onClick={() => changeSearch("")} aria-label="검색어 지우기">
                      <X size={15} />
                    </button>
                  )}
                </div>
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
                  <option value="review">확인 권장</option>
                  <option value="normal">특이 없음</option>
                </select>
                <select
                  value={sortMode}
                  onChange={(event) =>
                    changeSortMode(event.target.value as "risk" | "name" | "subject")
                  }
                  aria-label="정렬 방법"
                >
                  <option value="risk">유사도 높은 순</option>
                  <option value="name">이름 순</option>
                  <option value="subject">과목 순</option>
                </select>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>점검 결과</th>
                    <th>학생 / 학급</th>
                    <th>과목</th>
                    <th>최대 유사도</th>
                    <th>세부능력 및 특기사항</th>
                    <th>
                      <span className="visually-hidden">비교</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((record) => {
                    const status = riskStatus(record, threshold);
                    return (
                      <tr key={record.id}>
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
                          <p className="record-preview">{record.text}</p>
                        </td>
                        <td>
                          <button
                            className="compare-button"
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            disabled={!record.matchText}
                          >
                            비교
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

          <div className="report-notice">
            <Info size={18} />
            <p>
              이 결과는 문장 내 고유 단어의 교집합과 합집합을 비교한 자카드 유사도입니다.
              단어 순서와 교육적 맥락은 별도로 판단하지 않으므로, 표시된 두 문장을 직접
              대조해 최종 확인하세요.
            </p>
          </div>
        </main>
      )}

      <footer>
        <span>과세특 점검 도움자료 웹 버전</span>
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

      {selectedRecord && (
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
                <span className={`status-badge ${riskStatus(selectedRecord, threshold)}`}>
                  <i />
                  {riskLabel(riskStatus(selectedRecord, threshold))}
                </span>
                <h2 id="compare-title">유사 문장 나란히 보기</h2>
              </div>
              <button type="button" onClick={() => setSelectedRecord(null)} aria-label="비교 창 닫기">
                <X size={20} />
              </button>
            </div>
            <div className="similarity-callout">
              <div>
                <span>자카드 유사도</span>
                <strong>{formatPercent(selectedRecord.similarity)}</strong>
              </div>
              <p>
                공통 단어 {sharedKeywords(selectedRecord).length}개를 기준으로 가장 가까운 기록을
                찾았습니다.
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
            <div className="comparison-grid">
              <article>
                <div className="comparison-label">
                  <span>A</span>
                  <div>
                    <strong>{selectedRecord.name}</strong>
                    <small>
                      {selectedRecord.className} · {selectedRecord.subject}
                    </small>
                  </div>
                </div>
                <HighlightedComparisonText
                  text={selectedRecord.text}
                  comparisonText={selectedRecord.matchText}
                />
              </article>
              <article>
                <div className="comparison-label">
                  <span>B</span>
                  <div>
                    <strong>{selectedRecord.matchName || "비교 대상"}</strong>
                    <small>가장 유사한 다른 기록</small>
                  </div>
                </div>
                <HighlightedComparisonText
                  text={selectedRecord.matchText}
                  comparisonText={selectedRecord.text}
                />
              </article>
            </div>
            <div className="keyword-section">
              <span>두 문장에 함께 나온 주요 단어</span>
              <div>
                {sharedKeywords(selectedRecord).map((keyword) => (
                  <i key={keyword}>{keyword}</i>
                ))}
                {!sharedKeywords(selectedRecord).length && <small>공통 핵심 단어가 없습니다.</small>}
              </div>
            </div>
            <div className="modal-footer">
              <span>
                원본: {selectedRecord.sourceFile} · {selectedRecord.sourceRow}행
              </span>
              <button type="button" onClick={() => setSelectedRecord(null)}>
                확인 완료
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
