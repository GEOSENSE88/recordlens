/**
 * 이미지 import 타입 선언.
 * Vite는 URL 문자열을, Next는 { src, width, height } 객체를 돌려주므로
 * 두 경우를 모두 받을 수 있도록 선언한다. 실제 정규화는 brand-icon.ts에서 한다.
 */
declare module "*.png" {
  const asset: string | { src: string; width: number; height: number };
  export default asset;
}
