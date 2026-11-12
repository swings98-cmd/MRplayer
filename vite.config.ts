import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 주소가 https://<아이디>.github.io/MRplayer/ 이므로 base를 저장소 이름에 맞춘다.
const base = '/MRplayer/'

/** 설정 화면에 보여줄 빌드 정보 */
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return ''
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(gitCommit()),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': 새 버전이 있어도 자동으로 바꾸지 않는다.
      // 앱이 "새 버전이 있습니다" 알림을 띄우고, 사용자가 "업데이트"를 눌렀을 때만 적용한다.
      // (등록은 src/store/appUpdate.ts에서 직접 한다)
      registerType: 'prompt',
      injectRegister: false,
      // 아이콘은 globPatterns로 이미 캐시되므로 중복으로 넣지 않는다
      includeManifestIcons: false,
      manifest: {
        name: 'MR 큐 플레이어',
        short_name: 'MR 큐',
        description: '수업과 공연용 MR 큐 플레이어',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#0e0f13',
        theme_color: '#0e0f13',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 빌드 결과물의 모든 정적 파일을 미리 캐시해서 오프라인에서 열리게 한다.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
})
