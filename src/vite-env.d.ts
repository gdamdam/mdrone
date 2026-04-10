/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module "*.css";
declare module "*?url" {
  const url: string;
  export default url;
}
