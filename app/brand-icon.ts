import iconAsset from "./brand-icon.png";

/**
 * 번들러마다 이미지 import 결과가 다르다.
 * Vite(GitHub Pages 빌드)는 URL 문자열을, Next는 { src, width, height } 객체를 준다.
 * 어느 쪽이든 문자열 URL로 맞춰 쓴다.
 */
export const BRAND_ICON_SRC: string =
  typeof iconAsset === "string" ? iconAsset : (iconAsset as { src: string }).src;
