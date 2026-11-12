# src/audio

오디오 엔진. Web Audio API 관련 코드는 모두 이 폴더 안에만 둔다.
UI 코드(React 컴포넌트, JSX)는 두지 않는다. 바깥에서는 `index.ts`만 가져다 쓴다.

| 파일 | 역할 |
|---|---|
| `index.ts` | 앱 전체에서 쓰는 엔진 인스턴스 `audioEngine`와 타입 내보내기 |
| `engine.ts` | AudioContext, 음원 캐시, 재생/정지/일시정지/패닉, 마스터 볼륨, 상태 구독 |
| `voice.ts` | 한 번의 재생 (source → 큐 볼륨 곡선 → 디클릭/수동 페이드) |
| `envelope.ts` | 페이드 인/아웃 곡선 계산과 AudioParam 예약 |
| `output.ts` | **출력 경로 선택은 여기서만** (아이패드/아이폰 = MediaStream → `<audio>`, 그 외 = destination) |
| `volume.ts` | dB ↔ 선형 변환 |
| `types.ts` | 공용 타입 |

## 사용 예

```ts
import { audioEngine } from '../audio'

await audioEngine.load('song-1', await file.arrayBuffer())
audioEngine.play({ audioId: 'song-1', inPoint: 2, outPoint: 95, fadeIn: 1, fadeOut: 3, volumeDb: -3 })
audioEngine.fadeOutAndStop(2)
const unsubscribe = audioEngine.subscribe((s) => console.log(s.state, s.position))
```
