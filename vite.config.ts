import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 주소가 https://<아이디>.github.io/MRplayer/ 이므로 base를 저장소 이름에 맞춘다.
const base = '/MRplayer/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // 'prompt': 새 버전이 있어도 앱을 완전히 닫았다 다시 열 때까지 기다린다.
      // 재생 중 자동 새로고침으로 소리가 끊기는 일을 막기 위함.
      registerType: 'prompt',
      injectRegister: 'script',
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
