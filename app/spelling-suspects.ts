/**
 * 사전·빈도 대조 오탈자 탐지.
 *
 * 내장 한국어 맞춤법 사전(hunspell)과 업로드된 전체 기록의 어절 빈도를 함께 써서,
 * `해박과 지식`(→해박한), `차이을`(→차이를), `인사적임`(→인상적임) 같은
 * 규칙 목록으로는 못 잡는 오타를 찾는다. 학생 기록은 브라우저 밖으로 나가지 않는다.
 *
 * 사전에 없는 어절을 모두 지적하면 합성어·고유명사 때문에 못 쓴다.
 * (실제 자료에서 고유 어절의 26%가 사전 미등재였다.) 그래서 세 갈래 규칙만 쓴다.
 *
 *  1. 조사 받침 불일치 — `차이을`처럼 어근은 사전에 있는데 받침과 조사가 안 맞는 경우.
 *  2. 하다-어근 + 조사 — `해박과`처럼 어근 홀로는 말이 안 되는데(사전 미등재)
 *     `해박한`은 말이 되는 경우. 하다-형용사 어근에 조사가 잘못 붙은 오타다.
 *     `스토킹에`처럼 어근이 명사로도 널리 쓰이면(다른 조사 용례가 있으면) 제외한다.
 *  3. 이웃 대조 — 사전에 없고 전체 기록에서 드문 어절이, 자주 쓰이고 사전에도 있는
 *     어절과 **자모 하나 차이**인 경우(`인사적임`↔`인상적임`, `꾸진히`↔`꾸준히`).
 *     글자 하나 차이까지 넓히면 사전이 못 담은 정상 합성어(가품, 집밥, 개형)가
 *     쏟아져서, 타이핑 실수 모양인 자모 하나 차이로만 제한한다.
 */

export type SpellingSuspect = {
  /** 본문에서의 위치 */
  index: number;
  /** 의심 어절 */
  match: string;
  /** 고쳐 쓸 표기 제안 */
  suggestion: string;
  /** 지적 이유 설명 */
  explanation: string;
};

type SpellFn = (word: string) => boolean;

/** 받침에 따라 골라 쓰는 조사 짝. 왼쪽이 받침 있는 말에 붙는다. */
const JOSA_PAIRS: Array<[string, string]> = [
  ["을", "를"],
  ["은", "는"],
  ["이", "가"],
  ["과", "와"],
];

/** 조사를 떼어 보고 어근이 사전에 있으면 정상 표기로 본다. 긴 것부터 시도한다. */
const STRIP_JOSA = [
  "에서의", "으로의", "이라는", "만으로", "로의", "과의", "와의", "만을", "만이", "라는",
  "에서", "에게", "부터", "까지", "처럼", "보다", "조차", "마다", "으로",
  "을", "를", "이", "가", "은", "는", "과", "와", "의", "에", "도", "만", "뿐", "로",
];

/**
 * 이웃 대조에서 끝 글자 차이 지적을 하지 않는 생산적 접미사.
 * `조건화`, `반응열`, `분산계`, `깊이값`처럼 사전에 없어도 정상인 파생어가 많다.
 */
const FINAL_SUFFIX_SKIP = new Set(
  "화율열계값도제기시세광체차문어위비량력률색식론권법형별학적성사부판표치포재음".split(""),
);

const PURE_HANGUL = /^[가-힣]+$/;

function hasBatchim(char: string) {
  return (char.charCodeAt(0) - 0xac00) % 28 !== 0;
}

/** 음절을 초성·중성·종성 번호로 푼다. */
function decompose(char: string): [number, number, number] {
  const code = char.charCodeAt(0) - 0xac00;
  return [Math.floor(code / 588), Math.floor(code / 28) % 21, code % 28];
}

/**
 * 두 어절이 `타이핑 실수 한 번` 차이인지: 길이가 같고, 음절 하나만 다르며,
 * 그 음절의 초성·중성·종성 중 하나만 다르다. (사↔상, 진↔준, 암↔함)
 */
function isSingleJamoDifference(word: string, other: string): boolean {
  if (word.length !== other.length) return false;
  let differingAt = -1;
  for (let i = 0; i < word.length; i += 1) {
    if (word[i] === other[i]) continue;
    if (differingAt >= 0) return false;
    differingAt = i;
  }
  if (differingAt < 0) return false;
  const left = decompose(word[differingAt]);
  const right = decompose(other[differingAt]);
  let jamoDifferences = 0;
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) jamoDifferences += 1;
  return jamoDifferences === 1;
}

function extractWords(text: string): Array<{ word: string; index: number }> {
  const out: Array<{ word: string; index: number }> = [];
  for (const match of text.matchAll(/[가-힣]+/g)) {
    out.push({ word: match[0], index: match.index ?? 0 });
  }
  return out;
}

export function computeSpellingSuspects(texts: string[], spell: SpellFn): SpellingSuspect[][] {
  const spellCache = new Map<string, boolean>();
  const known = (word: string) => {
    const cached = spellCache.get(word);
    if (cached !== undefined) return cached;
    const result = spell(word);
    spellCache.set(word, result);
    return result;
  };

  const frequency = new Map<string, number>();
  for (const text of texts) {
    for (const { word } of extractWords(text)) {
      if (word.length < 2 || !PURE_HANGUL.test(word)) continue;
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
  }

  // 이웃 대조용: 자주 쓰이고 사전에도 있는 어절을, 음절 하나를 지운 열쇠로 색인한다.
  // 같은 자리 음절만 다른 두 어절은 열쇠가 겹치므로 전수 비교 없이 찾을 수 있다.
  const substitutionIndex = new Map<string, string[]>();
  const substitutionKeys = (word: string) => {
    const keys: string[] = [];
    for (let i = 0; i < word.length; i += 1) {
      keys.push(`${i}|${word.slice(0, i)}${word.slice(i + 1)}`);
    }
    return keys;
  };
  for (const [word, count] of frequency) {
    if (count < 10 || word.length < 3 || !known(word)) continue;
    for (const key of substitutionKeys(word)) {
      const bucket = substitutionIndex.get(key);
      if (bucket) bucket.push(word);
      else substitutionIndex.set(key, [word]);
    }
  }

  type Verdict = { suggestion: string; explanation: string } | null;
  const verdictCache = new Map<string, Verdict>();

  const judge = (word: string): Verdict => {
    const cached = verdictCache.get(word);
    if (cached !== undefined) return cached;
    const store = (verdict: Verdict) => {
      verdictCache.set(word, verdict);
      return verdict;
    };

    const count = frequency.get(word) ?? 0;
    if (word.length < 3 || count > 5 || known(word)) return store(null);

    const lastChar = word[word.length - 1];
    const stem = word.slice(0, -1);

    // 1. 조사 받침 불일치
    for (const [withBatchim, withoutBatchim] of JOSA_PAIRS) {
      if (lastChar !== withBatchim && lastChar !== withoutBatchim) continue;
      if (stem.length < 2 || !known(stem)) break;
      const correct = hasBatchim(stem[stem.length - 1]) ? withBatchim : withoutBatchim;
      if (correct === lastChar) break;
      return store({
        suggestion: stem + correct,
        explanation: `'${stem}' 뒤에는 받침에 따라 '${correct}'가 붙어야 합니다.`,
      });
    }

    // 2. 하다-어근 + 조사 (`해박과`): 어근 홀로는 사전에 없는데 `어근+한`은 있다.
    // 조사는 격조사만 본다. `도`까지 넣으면 복잡도·과년도 같은 파생 명사가 걸린다.
    if (
      "을를이가은는과와".includes(lastChar) &&
      stem.length >= 2 &&
      !known(stem) &&
      known(`${stem}한`)
    ) {
      // `스토킹에`처럼 어근이 명사로도 널리 쓰이면(다른 조사 용례가 있으면) 정상이다.
      let nounUses = 0;
      for (const josa of "을를이가은는과와의에도로") {
        if (josa === lastChar) continue;
        nounUses += frequency.get(stem + josa) ?? 0;
      }
      if (nounUses === 0) {
        return store({
          suggestion: `${stem}한`,
          explanation: `'${stem}'은 '${stem}한'처럼 쓰는 말이라 '${word}'는 오타로 보입니다.`,
        });
      }
    }

    // 3. 이웃 대조 — 드문 어절만
    if (count > 2) return store(null);
    // 조사를 떼면 말이 되는 어절(문제뿐, 관점에서의)은 사전이 못 담은 정상 표기다.
    for (const josa of STRIP_JOSA) {
      if (!word.endsWith(josa)) continue;
      const stripped = word.slice(0, -josa.length);
      if (stripped.length >= 2 && known(stripped)) return store(null);
    }
    const candidates = new Set<string>();
    for (const key of substitutionKeys(word)) {
      for (const candidate of substitutionIndex.get(key) ?? []) candidates.add(candidate);
    }
    let best: { suggestion: string; count: number } | null = null;
    for (const candidate of candidates) {
      if (candidate[0] !== word[0] || !isSingleJamoDifference(word, candidate)) continue;
      // 끝 글자만 다른데 그 끝 글자가 생산적 접미사이면(조건화, 반응열, 분산계…)
      // 사전이 못 담은 정상 파생어일 가능성이 높다.
      if (
        word.slice(0, -1) === candidate.slice(0, -1) &&
        FINAL_SUFFIX_SKIP.has(lastChar)
      ) {
        continue;
      }
      const candidateCount = frequency.get(candidate) ?? 0;
      if (!best || candidateCount > best.count) {
        best = { suggestion: candidate, count: candidateCount };
      }
    }
    if (!best) return store(null);
    return store({
      suggestion: best.suggestion,
      explanation: `맞춤법 사전에 없는 표기입니다. 전체 기록에서 ${best.count}회 쓰인 '${best.suggestion}'의 오타가 아닌지 확인해 주세요.`,
    });
  };

  return texts.map((text) => {
    const hits: SpellingSuspect[] = [];
    for (const { word, index } of extractWords(text)) {
      if (!PURE_HANGUL.test(word)) continue;
      const verdict = judge(word);
      if (!verdict) continue;
      hits.push({ index, match: word, ...verdict });
      if (hits.length >= 3) break;
    }
    return hits;
  });
}
