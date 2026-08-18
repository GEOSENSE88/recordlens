/*
 * hunspell 런타임 초기화 부트스크립트.
 * 번들(모듈) 컨텍스트에서 Module 공장을 호출하면 초기화 콜백이 돌아오지 않는
 * 문제가 있어, 검증된 일반 스크립트 컨텍스트에서 초기화까지 마치고
 * 준비된 인스턴스를 프라미스로 넘긴다. hunspell.js 다음에 실려야 한다.
 */
window.__recordlensHunspellReady = new Promise(function (resolve, reject) {
  try {
    var instance = window.Module({
      onRuntimeInitialized: function () {
        // 주의: 인스턴스를 그대로 resolve 하면 안 된다. 구형 엠스크립튼 모듈은
        // 자기 자신을 되돌려 주는 then 메서드를 갖고 있어서, 프라미스가 이를
        // thenable 로 보고 끝없이 풀려다 영원히 대기한다. 객체로 감싸서 넘긴다.
        resolve({ instance: instance });
      },
      onAbort: function (reason) {
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      },
    });
  } catch (error) {
    reject(error);
  }
});
