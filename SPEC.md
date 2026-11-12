# MR 큐 플레이어 SPEC

## 목적

수업과 공연에서 MR(음원)을 재생하는 개인용 큐 플레이어.
윈도우, 맥, 아이패드에서 같은 코드로 동작한다.

## 절대 조건

- 비용 0원: 유료 서비스, 유료 라이브러리, 서버, 로그인 금지
- 인터넷 없이 동작: 설치 후 모든 기능이 오프라인에서 동작
- 음원과 설정은 기기 안에만 저장
- 재생 안정성이 최우선: 재생 중 UI 조작이 소리를 끊으면 안 됨

## 기술

- Vite + React + TypeScript
- 상태 관리: zustand
- 저장: IndexedDB (idb 라이브러리)
- 오디오: Web Audio API (오디오 관련 코드는 src/audio 아래에만 둔다)
  - 출력 경로는 기기에 따라 다르게 쓴다
    - 아이패드/아이폰: AudioBufferSourceNode → GainNode → MediaStreamAudioDestinationNode
      → `<audio>` 요소의 srcObject (백그라운드 재생 유지용)
    - 윈도우/맥: GainNode → AudioContext.destination에 직접 연결
  - 출력 경로 선택은 src/audio의 한 곳에서만 한다
  - 아이패드에서 destination에 직접 연결하면 화면을 벗어나는 즉시 interrupted 되어
    소리가 멈춘다 (2026-11-12 mr-audio-test로 확인)
- PWA: vite-plugin-pwa
- 배포: GitHub Actions로 GitHub Pages 자동 배포

## 기능 범위

- 큐 리스트 재생: GO, 정지, 일시정지, 페이드 아웃 정지, 패닉(전체 즉시 정지)
- 편집(비파괴): 트림(인/아웃 포인트), 페이드 인/아웃 길이, 큐별 볼륨
  원본 파일은 절대 수정하지 않고 설정값만 저장한다
- 마커: 재생 중 찍기, 이름 붙이기, 마커 지점부터 즉시 재생, 프리롤
- 프로젝트 내보내기/가져오기
- 제외: EQ 등 이펙트, 기기 간 자동 동기화, 녹음

## 작업 규칙

- 한 번에 요청한 단계만 구현하고, 다음 단계 기능을 미리 만들지 않는다
- 작업이 끝나면 변경 내용을 요약하고, 내가 직접 확인할 방법을 알려준다
- 확인이 끝나면 의미 있는 커밋 메시지로 커밋하고 푸시한다
- UI 문구는 한국어
