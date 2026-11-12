# src/audio

오디오 엔진. Web Audio API 관련 코드는 모두 이 폴더 안에만 둔다.

- UI 코드(React 컴포넌트, JSX) 금지
- 출력 경로 선택(아이패드/아이폰은 MediaStreamDestination → `<audio>`, 윈도우/맥은
  AudioContext.destination 직결)은 이 폴더의 한 곳에서만 한다

아직 코드 없음 (뼈대 단계).
