// jvaddress 词表完整性 + 编解码往返测试（node:test + 原生 strip-types，零依赖）
// 背景：#35 发现 BIP39_CHINESE_CHARS 仅 1971 字（缺官方词表末尾 77 字），
// 导致 43% 地址 encodeJVA 出 21 字符非法 JVA。修复=补满 2048 + 越界保护 + 往返回归。
import { test } from 'node:test'
import assert from 'node:assert'
import { encodeJVA, decodeJVA, BIP39_CHARS_ARRAY } from '../src/utils/jvaddress.ts'

test('BIP39 中文词表长度 = 2048 且无重复', () => {
  assert.strictEqual(BIP39_CHARS_ARRAY.length, 2048, `词表长度应为 2048，实际 ${BIP39_CHARS_ARRAY.length}`)
  const uniq = new Set(BIP39_CHARS_ARRAY)
  assert.strictEqual(uniq.size, 2048, `词表应有 2048 个互不重复的字，实际去重后 ${uniq.size}`)
})

test('随机 hex → encodeJVA → decodeJVA 必须还原原地址', () => {
  // 用确定性伪随机，避免测试不稳定；覆盖足够样本以暴露 43% 非法问题
  let seed = 0x2f6e2b1
  const rand = () => {
    // xorshift32
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0xffffffff
  }
  const hexChar = '0123456789abcdef'
  const N = 200
  for (let i = 0; i < N; i++) {
    let hex = ''
    for (let j = 0; j < 40; j++) hex += hexChar[Math.floor(rand() * 16)]
    const addr = `0x${hex}`
    const enc = encodeJVA(addr)
    assert.strictEqual(enc.success, true, `encodeJVA 应成功: ${addr}`)
    if (!enc.success) continue
    // full 格式必须是 22 字符（此前会因缺字变 21）
    assert.strictEqual(enc.fullAddress.length, 22, `full 应为 22 字符: ${enc.fullAddress} (from ${addr})`)
    const dec = decodeJVA(enc.fullAddress)
    assert.strictEqual(dec.success, true, `decodeJVA(full) 应成功: ${enc.fullAddress}`)
    if (dec.success) {
      assert.strictEqual(dec.hexAddress.toLowerCase(), addr.toLowerCase(), `往返应还原: ${addr}`)
    }
  }
})

test('审计方真实案例地址回归：0x7fba... 必须编出 22 字符', () => {
  const addr = '0x7fba9BB966189Db8C4fE33B7bf67Bfa24203c6AD'
  const enc = encodeJVA(addr)
  assert.strictEqual(enc.success, true)
  if (enc.success) {
    assert.strictEqual(enc.fullAddress.length, 22, `full 应 22 字符，实际 ${enc.fullAddress.length}`)
    const dec = decodeJVA(enc.fullAddress)
    assert.strictEqual(dec.success, true)
    if (dec.success) {
      assert.strictEqual(dec.hexAddress.toLowerCase(), addr.toLowerCase())
    }
  }
})
