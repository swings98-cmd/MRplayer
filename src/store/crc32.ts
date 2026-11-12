/** CRC-32 (zip에서 쓰는 것). 큰 파일도 조금씩 이어서 계산할 수 있다. */
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** 시작값은 0. 이어서 계산할 때는 앞 결과를 넘긴다 */
export function crc32(data: Uint8Array, prev = 0): number {
  let c = (prev ^ 0xffffffff) >>> 0
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
