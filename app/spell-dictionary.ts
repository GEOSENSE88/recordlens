/**
 * 내장 한국어 맞춤법 사전 로딩.
 *
 * 사전은 spellcheck-ko 프로젝트의 hunspell 한국어 사전(ko.aff, ko.dic)이고,
 * 검사 엔진은 hunspell 을 웹어셈블리로 컴파일한 hunspell-asm 이다.
 * 사전과 엔진 모두 이 사이트에 함께 배포되어 있어(public/dict), 검사 전 과정이
 * 브라우저 안에서만 이루어진다. 학생 기록은 어디로도 전송되지 않는다.
 *
 * 엠스크립튼 런타임(hunspell.js)은 번들에 넣지 않고 일반 스크립트로 따로 싣는다.
 * UMD 형식이라 번들러가 청크로 나누면 모듈 헬퍼가 깨져 브라우저에서 실패했다.
 *
 * 사전 출처: https://github.com/spellcheck-ko/hunspell-dict-ko (MPL 2.0/GPL/LGPL)
 */

// 런타임을 만든 뒤 파일 시스템·검사 함수를 붙여 주는 내부 로더만 깊은 경로로 가져온다.
// (패키지의 기본 loadModule 은 UMD 런타임까지 번들에 끌어들여 위 문제를 다시 일으킨다.)
// @ts-expect-error -- 내부 파일이라 타입 선언이 없다.
import { hunspellLoader } from "hunspell-asm/dist/esm/hunspellLoader";

export type SpellFn = (word: string) => boolean;

let loaderPromise: Promise<SpellFn | null> | null = null;

async function fetchBuffer(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function appendScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`${url} 로딩 실패`));
    document.head.appendChild(script);
  });
}

/**
 * 엠스크립튼 UMD 런타임을 일반 스크립트 두 개(엔진, 부트)로 실어 초기화까지 마친다.
 * 번들(모듈) 컨텍스트에서 Module 공장을 호출하면 초기화 콜백이 돌아오지 않아,
 * 초기화는 부트스크립트(일반 스크립트 컨텍스트)에서 한다.
 */
// 구형 엠스크립튼 인스턴스는 자기 자신을 돌려주는 then 을 갖고 있어 await 하면
// 영원히 풀리지 않는다. 부트스크립트가 { instance } 로 감싸 넘기고, 여기서도
// 감싼 채로 주고받는다. (프라미스에 인스턴스를 그대로 태우면 안 된다.)
type RuntimeBox = { instance: unknown };
let runtimePromise: Promise<RuntimeBox> | null = null;

function loadRuntime(base: string): Promise<RuntimeBox> {
  runtimePromise ??= (async () => {
    await appendScript(new URL("dict/hunspell.js", base).toString());
    await appendScript(new URL("dict/hunspell-boot.js", base).toString());
    const ready = (window as { __recordlensHunspellReady?: Promise<RuntimeBox> })
      .__recordlensHunspellReady;
    if (!ready) throw new Error("hunspell 부트스크립트가 실행되지 않았습니다.");
    return await ready;
  })();
  return runtimePromise;
}

/**
 * 사전과 엔진을 처음 필요할 때 한 번만 내려받는다. (합쳐서 15MB, 압축 전송 시 약 4MB)
 * 실패하면(오프라인 등) null 을 돌려주고, 호출한 쪽은 사전 검사만 조용히 건너뛴다.
 */
export function loadSpellChecker(): Promise<SpellFn | null> {
  loaderPromise ??= (async () => {
    try {
      const base = document.baseURI;
      const [runtimeBox, aff, dic] = await Promise.all([
        loadRuntime(base),
        fetchBuffer(new URL("dict/ko.aff", base).toString()),
        fetchBuffer(new URL("dict/ko.dic", base).toString()),
      ]);
      const hunspellFactory = hunspellLoader(runtimeBox.instance);
      const hunspell = hunspellFactory.create(
        hunspellFactory.mountBuffer(aff, "ko.aff"),
        hunspellFactory.mountBuffer(dic, "ko.dic"),
      );
      return (word: string) => hunspell.spell(word);
    } catch (error) {
      // 사전 검사는 보조 기능이라 실패해도 점검은 계속한다. 원인은 콘솔에만 남긴다.
      console.warn("맞춤법 사전을 불러오지 못해 사전 검사를 건너뜁니다.", error);
      return null;
    }
  })();
  return loaderPromise;
}
