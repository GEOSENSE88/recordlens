import iconAsset from "./brand-icon.png";
import guideAsset from "./neis-guide.png";

/**
 * 번들러마다 이미지 import 결과가 다르다.
 * Vite(GitHub Pages 빌드)는 URL 문자열을, Next는 { src, width, height } 객체를 준다.
 * 어느 쪽이든 문자열 URL로 맞춰 쓴다.
 */
function assetUrl(asset: string | { src: string }): string {
  return typeof asset === "string" ? asset : asset.src;
}

export const BRAND_ICON_SRC: string = assetUrl(iconAsset);

/** 나이스에서 세특 엑셀을 내려받는 화면. 개인정보는 가려 두었다. */
export const NEIS_GUIDE_SRC: string = assetUrl(guideAsset);
