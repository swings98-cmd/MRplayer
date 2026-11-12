import { defineConfig } from 'vitest/config'

// 단위 테스트는 브라우저 없이 돌린다 (PWA 등 빌드용 플러그인은 쓰지 않음)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
