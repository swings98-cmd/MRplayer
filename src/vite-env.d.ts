/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

/** 빌드 시각 (ISO 문자열) — vite.config.ts의 define */
declare const __BUILD_TIME__: string
/** 빌드한 git 커밋 (짧은 해시, 없으면 빈 문자열) */
declare const __BUILD_COMMIT__: string
