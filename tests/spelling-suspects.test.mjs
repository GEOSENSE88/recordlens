import assert from "node:assert/strict";
import test from "node:test";

import { computeSpellingSuspects } from "../app/spelling-suspects.ts";

// 실제 hunspell 대신 작은 사전으로 규칙만 검증한다.
const DICTIONARY = new Set([
  "차이", "차이를", "차이점", "차이점을", "문제", "문제를", "관점에서",
  "해박한", "꾸준히", "인상적임", "조건과", "조건화한", "발표함", "탐구함",
  "정리하여", "모둠", "토의에서", "의견을", "스토킹한", "수업에서", "내용을",
]);
const spell = (word) => DICTIONARY.has(word);

/** 고빈도 어절을 만들기 위해 같은 문장을 여러 번 넣는다. */
function corpus(extra) {
  const filler = "꾸준히 발표함 조건과 의견을 정리하여 탐구함 수업에서 내용을 인상적임.";
  return [...Array.from({ length: 12 }, () => filler), ...extra];
}

test("finds josa that disagrees with the final consonant", () => {
  const texts = corpus(["두 함수의 차이을 정리하여 발표함."]);
  const hits = computeSpellingSuspects(texts, spell).at(-1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, "차이을");
  assert.equal(hits[0].suggestion, "차이를");
});

test("finds a hada-adjective root glued to a josa", () => {
  // 해박과: `해박`은 사전에 없고 `해박한`은 있다.
  const texts = corpus(["해박과 지식과 탐구열이 돋보이는 학생임."]);
  const hits = computeSpellingSuspects(texts, spell).at(-1);
  assert.equal(hits.some((hit) => hit.match === "해박과" && hit.suggestion === "해박한"), true);
});

test("keeps a noun-like root that also has hada forms", () => {
  // 스토킹에: `스토킹한`이 사전에 있어도, 명사 용례(스토킹을)가 있으면 정상이다.
  const texts = corpus(["스토킹을 다룬 기사와 스토킹에 대한 법을 조사함."]);
  const hits = computeSpellingSuspects(texts, spell).at(-1);
  assert.equal(hits.some((hit) => hit.match === "스토킹에"), false);
});

test("finds a single-jamo slip against a frequent word", () => {
  const texts = corpus(["문학 감상평이 꾸진히 발전하는 모습이 돋보임."]);
  const hits = computeSpellingSuspects(texts, spell).at(-1);
  assert.equal(hits.some((hit) => hit.match === "꾸진히" && hit.suggestion === "꾸준히"), true);
});

test("keeps words that are valid once a josa is stripped", () => {
  // 문제뿐: 사전에 없지만 `뿐`을 떼면 `문제`가 있으므로 정상 표기다.
  const texts = corpus(["문제뿐 아니라 대안을 함께 논의함."]);
  const hits = computeSpellingSuspects(texts, spell).at(-1);
  assert.equal(hits.some((hit) => hit.match === "문제뿐"), false);
});

test("keeps derived words that differ only by a productive final suffix", () => {
  // 조건화: `조건과`와 끝 글자만 다르지만 -화 파생어라 지적하지 않는다.
  const texts = corpus(["고전적 조건화 개념을 실험으로 살펴봄."]);
  const hits = computeSpellingSuspects(texts, spell).at(-1);
  assert.equal(hits.some((hit) => hit.match === "조건화"), false);
});

test("does not flag frequent or dictionary-listed words", () => {
  const texts = corpus(["모둠 토의에서 의견을 정리하여 발표함."]);
  const hits = computeSpellingSuspects(texts, spell).at(-1);
  assert.equal(hits.length, 0);
});
