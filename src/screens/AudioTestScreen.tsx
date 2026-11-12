/**
 * ⚠️ 임시 확인용 화면 — 오디오 엔진 동작 확인이 끝나면 지운다.
 * 지울 때: 이 파일, AudioTestScreen.css, uiStore의 'test' 탭, TabBar/App의 test 항목
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { audioEngine, type CueSettings, type OutputMode } from '../audio/index.ts'
import './AudioTestScreen.css'

const AUDIO_ID = 'test'
const BEEP_ID = 'beep'
const MODE_KEY = 'mr.test.outputMode'
/** 이 크기(-60dBFS)를 넘으면 소리가 나기 시작한 것으로 본다 */
const ONSET_THRESHOLD = 0.001

const STATE_LABEL: Record<string, string> = {
  stopped: '정지',
  playing: '재생',
  paused: '일시정지',
  fading: '페이드 중',
}
const MODE_LABEL: Record<OutputMode, string> = { auto: '자동', stream: 'B 경로', direct: '직접 출력' }
const KIND_LABEL = { stream: 'B 경로 (MediaStream → <audio>)', direct: '직접 출력 (destination)' }

function readMode(): OutputMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'auto' || v === 'stream' || v === 'direct') return v
  } catch {
    /* 무시 */
  }
  return 'auto'
}

/** 첫 샘플부터 바로 소리가 나는 2초짜리 1kHz 테스트 톤 (WAV) */
function makeToneWav(): ArrayBuffer {
  const sr = 48000
  const n = sr * 2
  const ab = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(ab)
  const w = (o: number, str: string) => [...str].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  w(36, 'data'); dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 1000 * i) / sr) * 0.3 * 32767), true)
  return ab
}

/** from(초) 이후 처음으로 소리가 나는 지점까지의 무음 길이(초) */
function leadingSilence(buf: AudioBuffer, from: number): number {
  const start = Math.max(0, Math.floor(from * buf.sampleRate))
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
  for (let i = start; i < buf.length; i++) {
    for (const ch of chans) if (Math.abs(ch[i]) > ONSET_THRESHOLD) return (i - start) / buf.sampleRate
  }
  return 0
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

function clock(): string {
  const d = new Date()
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

export function AudioTestScreen() {
  const snap = useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot)

  const [fileInfo, setFileInfo] = useState('선택된 파일 없음')
  const [loaded, setLoaded] = useState(audioEngine.isLoaded(AUDIO_ID))
  const [mode, setMode] = useState<OutputMode>(readMode)
  const [f, setF] = useState({
    inPoint: '0',
    outPoint: '',
    fadeIn: '0',
    fadeOut: '0',
    volumeDb: '0',
    startAt: '30',
    fadeSec: '3',
    masterDb: '0',
  })
  const [goMs, setGoMs] = useState<string>('-')
  const [logs, setLogs] = useState<string[]>([])
  const measureRef = useRef<number | null>(null)
  const buffers = useRef(new Map<string, AudioBuffer>())

  const log = (msg: string) => setLogs((l) => [`[${clock()}] ${msg}`, ...l].slice(0, 200))

  // 저장된 출력 경로 설정 적용 + 테스트 톤 미리 로드 (탭 안에서 기다리지 않도록)
  useEffect(() => {
    audioEngine.setOutputMode(readMode())
    audioEngine.load(BEEP_ID, makeToneWav()).then((b) => buffers.current.set(BEEP_ID, b))
  }, [])

  // AudioContext state / 출력 경로 변화 로그
  const prev = useRef({ ctx: snap.contextState, kind: snap.outputKind })
  useEffect(() => {
    if (prev.current.ctx !== snap.contextState) log(`AudioContext state → ${snap.contextState}`)
    if (prev.current.kind !== snap.outputKind && snap.outputKind) log(`출력 경로 → ${KIND_LABEL[snap.outputKind]}`)
    prev.current = { ctx: snap.contextState, kind: snap.outputKind }
  }, [snap.contextState, snap.outputKind])

  // visibilitychange 로그
  useEffect(() => {
    const onVis = () =>
      log(`visibilitychange → ${document.visibilityState} (ctx ${audioEngine.getSnapshot().contextState})`)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => () => {
    if (measureRef.current !== null) clearInterval(measureRef.current)
  }, [])

  const num = (s: string, fallback: number) => {
    const v = parseFloat(s)
    return Number.isFinite(v) ? v : fallback
  }

  const cue = (): CueSettings => ({
    audioId: AUDIO_ID,
    inPoint: num(f.inPoint, 0),
    outPoint: f.outPoint.trim() === '' ? null : num(f.outPoint, 0),
    fadeIn: num(f.fadeIn, 0),
    fadeOut: num(f.fadeOut, 0),
    volumeDb: num(f.volumeDb, 0),
  })

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    audioEngine.unload(AUDIO_ID)
    setLoaded(false)
    setFileInfo(`${file.name} — 디코딩 중…`)
    try {
      const buf = await audioEngine.load(AUDIO_ID, await file.arrayBuffer())
      buffers.current.set(AUDIO_ID, buf)
      setLoaded(true)
      setFileInfo(`${file.name} — ${buf.duration.toFixed(2)}초, 앞 무음 ${(leadingSilence(buf, 0) * 1000).toFixed(0)}ms`)
      log(`로드 완료: ${file.name} (${buf.duration.toFixed(2)}초)`)
    } catch (err) {
      setFileInfo(`${file.name} — 디코딩 실패`)
      log(`디코딩 실패: ${String(err)}`)
    }
  }

  /** 버튼을 누른 시각부터 마스터 출력에 소리가 감지될 때까지의 시간 */
  const startGoMeasure = (pressedAt: number, leadSec: number) => {
    if (measureRef.current !== null) clearInterval(measureRef.current)
    const an = audioEngine.getAnalyser()
    const data = new Float32Array(an.fftSize)
    const sr = an.context.sampleRate
    setGoMs('측정 중…')
    measureRef.current = window.setInterval(() => {
      an.getFloatTimeDomainData(data)
      const now = performance.now()
      let idx = -1
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > ONSET_THRESHOLD) {
          idx = i
          break
        }
      }
      if (idx >= 0) {
        // 버퍼 안에서 소리가 시작된 위치만큼 보정
        const agoMs = ((data.length - idx) / sr) * 1000
        const ms = Math.max(0, now - pressedAt - agoMs)
        const leadMs = leadSec * 1000
        const text =
          leadMs > 5
            ? `${(ms - leadMs).toFixed(0)} ms (측정 ${ms.toFixed(0)} − 앞 무음 ${leadMs.toFixed(0)})`
            : `${ms.toFixed(0)} ms`
        setGoMs(text)
        log(`GO 지연 ${text} · 출력 경로 ${snapKind()}`)
        clearInterval(measureRef.current!)
        measureRef.current = null
      } else if (now - pressedAt > 3000) {
        setGoMs('감지 실패 (3초 안에 소리 없음)')
        clearInterval(measureRef.current!)
        measureRef.current = null
      }
    }, 2)
  }
  const snapKind = () => {
    const k = audioEngine.getSnapshot().outputKind
    return k ? MODE_LABEL[k] : '-'
  }

  const run = (name: string, fn: () => void) => {
    try {
      fn()
      log(name)
    } catch (err) {
      log(`${name} 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const goPlay = (label: string, c: CueSettings, startAt?: number) => {
    const pressedAt = performance.now()
    const before = audioEngine.getSnapshot()
    const wasSilent = before.state !== 'playing' && before.state !== 'fading'
    run(`${label} (누른 순간 ctx ${before.contextState})`, () => audioEngine.play(c, startAt))
    if (audioEngine.getSnapshot().state === 'playing') {
      if (!wasSilent) {
        setGoMs('정지 상태에서 재생해야 측정됨')
        return
      }
      const buf = buffers.current.get(c.audioId)
      const lead = buf ? leadingSilence(buf, startAt ?? c.inPoint) : 0
      startGoMeasure(pressedAt, lead)
    }
  }

  const onPlay = (withStartAt: boolean) =>
    goPlay(withStartAt ? `play (startAt ${f.startAt}초)` : 'play', cue(), withStartAt ? num(f.startAt, 0) : undefined)

  const onBeep = () =>
    goPlay('테스트 톤', { audioId: BEEP_ID, inPoint: 0, outPoint: null, fadeIn: 0, fadeOut: 0, volumeDb: -12 })

  const onMode = (m: OutputMode) => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* 무시 */
    }
    audioEngine.setOutputMode(m)
    log(`출력 경로 설정: ${MODE_LABEL[m]}`)
  }

  const info = audioEngine.getContextInfo()
  const field = (key: keyof typeof f, label: string, placeholder?: string) => (
    <label className="at-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={f[key]}
        placeholder={placeholder}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </label>
  )

  return (
    <div className="at">
      <p className="at-warn">임시 확인용 화면입니다. 엔진 확인이 끝나면 지웁니다.</p>

      <section className="at-card">
        <h2>음원</h2>
        <label className="at-file">
          음원 파일 선택
          <input type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={onFile} />
        </label>
        <p className="at-muted">{fileInfo}</p>
      </section>

      <section className="at-card">
        <h2>상태</h2>
        <dl className="at-status">
          <dt>상태</dt>
          <dd className="at-big">{STATE_LABEL[snap.state]}</dd>
          <dt>위치</dt>
          <dd className="at-big">{fmtTime(snap.position)}</dd>
          <dt>출력 경로</dt>
          <dd>{snap.outputKind ? KIND_LABEL[snap.outputKind] : '아직 없음 (화면을 한 번 탭하세요)'}</dd>
          <dt>AudioContext</dt>
          <dd>
            {snap.contextState}
            {info &&
              ` · ${info.sampleRate}Hz · base ${info.baseLatency !== null ? (info.baseLatency * 1000).toFixed(1) + 'ms' : '-'}` +
                ` · output ${info.outputLatency !== null ? (info.outputLatency * 1000).toFixed(1) + 'ms' : '-'}`}
          </dd>
          <dt>GO 지연</dt>
          <dd className="at-big">{goMs}</dd>
        </dl>
      </section>

      <section className="at-card">
        <h2>큐 설정</h2>
        <div className="at-grid">
          {field('inPoint', '인 포인트 (초)')}
          {field('outPoint', '아웃 포인트 (초)', '비우면 끝까지')}
          {field('fadeIn', '페이드 인 (초)')}
          {field('fadeOut', '페이드 아웃 (초)')}
          {field('volumeDb', '큐 볼륨 (dB)')}
          {field('startAt', '시작 지점 (초)')}
        </div>
      </section>

      <section className="at-card">
        <h2>조작</h2>
        <div className="at-buttons">
          <button className="go" disabled={!loaded} onClick={() => onPlay(false)}>
            play
          </button>
          <button className="go" disabled={!loaded} onClick={() => onPlay(true)}>
            play(시작 지점)
          </button>
          <button className="go" onClick={onBeep}>
            테스트 톤으로 GO 측정
          </button>
          <button onClick={() => run('stop', () => audioEngine.stop())}>stop</button>
          <button onClick={() => run(`fadeOutAndStop(${f.fadeSec})`, () => audioEngine.fadeOutAndStop(num(f.fadeSec, 3)))}>
            fadeOutAndStop
          </button>
          <button onClick={() => run('pause', () => audioEngine.pause())}>pause</button>
          <button onClick={() => run('resume', () => audioEngine.resume())}>resume</button>
          <button
            onClick={() =>
              run('unload', () => {
                audioEngine.unload(AUDIO_ID)
                setLoaded(false)
                setFileInfo('언로드됨 (파일을 다시 선택하세요)')
              })
            }
          >
            unload
          </button>
          <button className="panic" onClick={() => run('panic', () => audioEngine.panic())}>
            panic
          </button>
        </div>
        <div className="at-grid" style={{ marginTop: 12 }}>
          {field('fadeSec', '페이드 아웃 정지 시간 (초)')}
          <label className="at-field">
            <span>마스터 볼륨 (dB)</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={f.masterDb}
              onChange={(e) => {
                setF({ ...f, masterDb: e.target.value })
                audioEngine.setMasterVolumeDb(num(e.target.value, 0))
              }}
            />
          </label>
        </div>
      </section>

      <section className="at-card">
        <h2>출력 경로 (숨은 옵션)</h2>
        <div className="at-buttons">
          {(['auto', 'stream', 'direct'] as const).map((m) => (
            <button key={m} className={mode === m ? 'selected' : ''} onClick={() => onMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </section>

      <section className="at-card">
        <h2>로그 (최신이 위)</h2>
        <div className="at-buttons" style={{ marginBottom: 12 }}>
          <button onClick={() => setLogs([])}>로그 지우기</button>
        </div>
        <pre className="at-log">{logs.join('\n')}</pre>
      </section>
    </div>
  )
}
