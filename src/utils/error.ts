// 从任意错误对象安全提取面向用户的可读信息
// 优先取 shortMessage（viem 面向用户的干净文案），其次 message（可能含技术细节），最后 toString
// 统一了 useJNSVote / CoreIdCheckIn / WJOperations 三处重复实现
export function safeErrorMessage(error: unknown): string {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>
    if (typeof obj.shortMessage === 'string') return obj.shortMessage
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.toString === 'function') {
      try { return String(obj.toString()) } catch { /* 忽略 */ }
    }
  }
  return String(error)
}
