/** decodeAudioData를 Promise로 감싼다. 오래된 사파리는 콜백 방식만 지원하므로 둘 다 연결한다. */
export function decodeAudio(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const ret = ctx.decodeAudioData(data, resolve, reject)
    if (ret && typeof ret.then === 'function') ret.then(resolve, reject)
  })
}
