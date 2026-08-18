export type CreativeActivityRecord = {
  className: string;
  grade: string;
  activity: string;
  name: string;
  number: string;
  text: string;
  sourceRow: number;
};

const ACTIVITY_NAMES = new Map([
  ["자율활동", "자율활동"],
  ["자율자치활동", "자율·자치활동"],
  ["동아리활동", "동아리활동"],
  ["진로활동", "진로활동"],
  ["봉사활동", "봉사활동"],
]);

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString("ko-KR");
  return String(value).replace(/\u0000/g, "").trim();
}

function cleanText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, "").replace(/[()·･・]/g, "");
}

function classLabel(value: string) {
  const match = value.match(/(\d+)\s*학년[\s\S]*?(\d+)\s*반/);
  return match ? `${match[1]}학년 ${match[2]}반` : cleanText(value);
}

function activityLabel(value: string) {
  return ACTIVITY_NAMES.get(normalizeHeader(value)) ?? "";
}

/** 빈 행이나 짧은 행이 섞여 있어도 항상 같은 길이의 문자열 배열을 돌려준다. */
function rowCells(rows: unknown[][], rowIndex: number, length: number) {
  const row = rows[rowIndex] ?? [];
  return Array.from({ length }, (_, column) => cellText(row[column]));
}

export function isCreativeActivityExport(rows: unknown[][]) {
  const hasTitle = rows.some((_, rowIndex) =>
    rowCells(rows, rowIndex, 6).some((cell) => normalizeHeader(cell).includes("창의적체험활동상황")),
  );
  const hasHeader = rows.some((_, rowIndex) => {
    const values = rowCells(rows, rowIndex, 6).map(normalizeHeader);
    return (
      values[0].includes("번호") &&
      values[1].includes("성명") &&
      values[2].includes("학년") &&
      values[3].includes("창의적체험활동")
    );
  });
  return hasTitle || hasHeader;
}

export function parseCreativeActivityRows(rows: unknown[][]): CreativeActivityRecord[] {
  const records = new Map<string, CreativeActivityRecord>();
  let currentClass = "";
  let currentNumber = "";
  let currentName = "";
  let currentGrade = "";
  let currentActivity = "";

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rowCells(rows, rowIndex, 12);
    const firstCell = cleanText(row[0]);

    if (/^\d+\s*학년\s*\d+\s*반/.test(firstCell)) {
      currentClass = classLabel(firstCell);
      continue;
    }

    const normalizedCells = row.slice(0, 6).map((value) => normalizeHeader(value));
    if (
      (normalizedCells[0].includes("번호") &&
        normalizedCells[1].includes("성명") &&
        normalizedCells[2].includes("학년")) ||
      (normalizedCells[3] === "영역" && normalizedCells[5] === "특기사항") ||
      row[7] === "/"
    ) {
      continue;
    }

    const nextNumber = cleanText(row[0]);
    const nextName = cleanText(row[1]);
    if (/^\d+$/.test(nextNumber)) currentNumber = nextNumber;
    if (nextName) {
      currentName = nextName;
      currentGrade = "";
      currentActivity = "";
    }

    const gradeValue = cleanText(row[2]);
    if (/^[1-3]$/.test(gradeValue)) currentGrade = `${gradeValue}학년`;

    const nextActivity = activityLabel(row[3]);
    if (nextActivity) currentActivity = nextActivity;

    const detail = cleanText(row[5]);
    if (
      !currentName ||
      !currentActivity ||
      !detail ||
      detail === "0" ||
      detail === "희망분야" ||
      /^\d+$/.test(detail)
    ) {
      continue;
    }

    const key = [currentClass, currentNumber, currentName, currentGrade, currentActivity].join("|");
    const existing = records.get(key);
    if (existing) {
      // 쪽이 바뀔 때 같은 내용이 다시 오면 공백 차이가 있어도 이어 붙이지 않는다.
      const spaceless = (value: string) => value.replace(/\s+/g, "");
      if (!spaceless(existing.text).includes(spaceless(detail))) {
        existing.text = `${existing.text} ${detail}`.trim();
      }
    } else {
      records.set(key, {
        className: currentClass || "학급 미상",
        grade: currentGrade || "학년 미상",
        activity: currentActivity,
        name: currentName,
        number: currentNumber,
        text: detail,
        sourceRow: rowIndex + 1,
      });
    }
  }

  return [...records.values()].filter((record) => record.text.length > 3);
}
