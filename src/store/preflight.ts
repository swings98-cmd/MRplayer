/**
 * 공연 전 점검: 현재 프로젝트를 공연에 쓸 수 있는지 한 번에 확인한다.
 * 음원 디코딩 시험은 재생 엔진과 따로, 하나씩 디코딩했다가 바로 버려서 메모리를 크게 쓰지 않는다.
 */
import { isAppleMobile, resolveOutputKind, testDecode } from '../audio/index.ts'
import { checkOffline, useAppUpdate } from './appUpdate.ts'
import * as db from './db.ts'
import { describeAudioError, usePlayerStore } from './playerStore.ts'
import { useProjectStore } from './projectStore.ts'
import { useSettingsStore } from './settingsStore.ts'
import { useStorageStore } from './storageStore.ts'
import { useWakeLock } from './wakeLock.ts'

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'manual'

export interface CheckItem {
  label: string
  status: CheckStatus
  detail: string
  /** 문제가 있는 큐 등 */
  list?: string[]
}

/** 저장 공간 여유가 이보다 적으면 경고 */
const LOW_SPACE_BYTES = 500 * 1024 * 1024
const DAY = 24 * 60 * 60 * 1000

const mb = (b: number) => `${Math.round(b / 1024 / 1024).toLocaleString('ko-KR')}MB`

export async function runPreflight(onProgress: (label: string, ratio: number) => void): Promise<CheckItem[]> {
  const items: CheckItem[] = []
  const ps = useProjectStore.getState()
  const project = ps.projects.find((p) => p.id === ps.currentProjectId)
  const cues = ps.cues

  // 저장 공간 보호: 탭 안에서 시작했으므로 아직 허용 전이면 한 번 요청해 본다
  const storage = useStorageStore.getState()
  if (storage.persist === 'denied') await storage.requestPersist()

  // 1. 음원이 빠진 큐
  const missing = cues.filter((c) => !ps.audio[c.audioId])
  items.push(
    missing.length === 0
      ? { label: '음원이 빠진 큐', status: 'ok', detail: `큐 ${cues.length}개 모두 음원이 있습니다` }
      : {
          label: '음원이 빠진 큐',
          status: 'fail',
          detail: `${missing.length}개 큐에 음원이 없습니다. 큐 메뉴의 "음원 파일 지정"으로 다시 지정하세요.`,
          list: missing.map((c) => `${cues.indexOf(c) + 1}. ${c.name}${c.missingAudio ? ` (${c.missingAudio.fileName})` : ''}`),
        },
  )

  // 2. 모든 큐 디코딩 시험 (같은 음원은 한 번만)
  const audioIds = [...new Set(cues.map((c) => c.audioId).filter((id) => ps.audio[id]))]
  const broken: string[] = []
  const lengthOff: string[] = []
  for (const [i, id] of audioIds.entries()) {
    const meta = ps.audio[id]
    const names = cues.filter((c) => c.audioId === id).map((c) => `${cues.indexOf(c) + 1}. ${c.name}`)
    onProgress(`디코딩 시험 ${i + 1}/${audioIds.length} · ${meta.fileName}`, i / Math.max(1, audioIds.length))
    try {
      const blob = await db.getAudioBlob(id)
      if (!blob) throw new Error('저장된 음원 파일을 찾을 수 없습니다')
      const duration = await testDecode(await blob.arrayBuffer())
      usePlayerStore.getState().setAudioHealth(id, null)
      if (Math.abs(duration - meta.duration) > 0.5) lengthOff.push(`${names.join(', ')} (저장된 길이 ${meta.duration.toFixed(1)}초, 실제 ${duration.toFixed(1)}초)`)
    } catch (err) {
      const reason = describeAudioError(err)
      usePlayerStore.getState().setAudioHealth(id, reason)
      broken.push(`${names.join(', ')} — ${reason}`)
    }
  }
  onProgress('나머지 확인', 1)
  items.push(
    broken.length === 0
      ? { label: '모든 큐 디코딩', status: 'ok', detail: `음원 ${audioIds.length}개 모두 정상적으로 열립니다` }
      : { label: '모든 큐 디코딩', status: 'fail', detail: `${broken.length}개 음원을 열 수 없습니다. 원본 파일로 다시 지정하세요.`, list: broken },
  )
  if (lengthOff.length) items.push({ label: '음원 길이', status: 'warn', detail: '저장된 길이와 실제 길이가 다릅니다. 트림과 마커를 확인하세요.', list: lengthOff })

  // 3. 오프라인 준비
  await checkOffline()
  const { offline, cachedFiles } = useAppUpdate.getState()
  items.push({
    label: '오프라인 준비',
    status: offline === 'ready' ? 'ok' : offline === 'dev' ? 'manual' : 'fail',
    detail:
      offline === 'ready'
        ? `인터넷 없이 열립니다 (파일 ${cachedFiles}개)`
        : offline === 'dev'
          ? '개발 모드에서는 확인할 수 없습니다. 배포된 앱에서 다시 점검하세요.'
          : '아직 오프라인 준비가 안 됐습니다. 인터넷에 연결된 상태로 앱을 완전히 닫았다가 다시 여세요.',
  })

  // 4. 저장 공간 보호
  const persist = useStorageStore.getState().persist
  items.push({
    label: '저장 공간 보호 (persist)',
    status: persist === 'granted' ? 'ok' : 'warn',
    detail:
      persist === 'granted'
        ? '브라우저가 음원과 설정을 임의로 지우지 않습니다'
        : persist === 'unsupported'
          ? '이 브라우저는 지원하지 않습니다. 공연 전에 전체 내보내기로 백업해 두세요.'
          : '허용되지 않았습니다. 홈 화면에 추가한 앱으로 열고, 전체 내보내기로 백업해 두세요.',
  })

  // 5. 저장 공간 여유
  await useStorageStore.getState().refreshEstimate()
  const { usage, quota } = useStorageStore.getState()
  if (usage !== null && quota !== null) {
    const free = quota - usage
    items.push({
      label: '저장 공간 여유',
      status: free < LOW_SPACE_BYTES ? 'warn' : 'ok',
      detail: `사용 ${mb(usage)} · 남은 공간 약 ${mb(free)}${free < LOW_SPACE_BYTES ? ' — 부족하면 설정 저장이 실패할 수 있습니다' : ''}`,
    })
  }

  // 6. 출력 경로 (아이패드는 B 경로여야 화면이 꺼져도 재생이 이어진다)
  const settings = useSettingsStore.getState()
  if (isAppleMobile()) {
    const kind = resolveOutputKind(settings.outputMode)
    items.push({
      label: '백그라운드 재생 경로',
      status: kind === 'stream' ? 'ok' : 'fail',
      detail:
        kind === 'stream'
          ? 'B 경로(화면이 꺼져도 재생 유지)'
          : '직접 출력으로 바뀌어 있습니다. 화면이 꺼지면 소리가 멈춥니다. 설정 > 고급 > 출력 경로를 "자동"으로 바꾸세요.',
    })
  }

  // 7. 화면 꺼짐 방지
  const wake = useWakeLock.getState()
  items.push({
    label: '화면 꺼짐 방지',
    status: !wake.supported ? 'warn' : settings.keepScreenOn ? 'ok' : 'warn',
    detail: !wake.supported
      ? '이 기기에서는 지원하지 않습니다. 아이패드 설정 > 디스플레이 > 자동 잠금을 "안 함"으로 두세요.'
      : settings.keepScreenOn
        ? '재생 중에는 화면이 꺼지지 않습니다'
        : '꺼져 있습니다. 설정 > 화면에서 켜거나 자동 잠금을 길게 두세요.',
  })

  // 8. 백업
  const last = project?.lastBackupAt
  items.push({
    label: '백업',
    status: last && Date.now() - last < 7 * DAY ? 'ok' : 'warn',
    detail: last
      ? `마지막 전체 내보내기: ${new Date(last).toLocaleString('ko-KR')}`
      : '아직 백업하지 않았습니다. 편집 탭 아래에서 전체 내보내기를 해 두세요.',
  })

  // 9. 직접 확인할 것 (앱이 알 수 없는 것)
  items.push({
    label: '직접 확인',
    status: 'manual',
    detail: '앱이 확인할 수 없는 항목입니다.',
    list: [
      '방해금지 모드 켜기 (알림·알람·전화로 소리가 끊기지 않게)',
      '사용법 유도 켜기 (설정 > 손쉬운 사용 > 사용법 유도) — 실수로 앱이 바뀌지 않게',
      '기기 볼륨과 음향 장비 연결, 블루투스 기기 연결 해제 여부',
      '충전기 연결 또는 배터리 충분',
    ],
  })

  return items
}
