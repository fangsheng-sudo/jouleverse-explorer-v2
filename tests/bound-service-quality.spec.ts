import { expect, it } from 'vitest'
import { evaluateBoundServiceQuality, evaluateServiceRecovery, type QualitySeries } from '../src/integration/bound-service-quality'
const series = { serviceId: 'rpc-main', collectorId: 'collector-a', policyId: 'read-v1' }
const targets = { minCoverageBps: 10000, minAvailabilityBps: 10000, minObservations: 2, minLatencySamples: 1, maxP95Ms: 100 }
function report(startMs: number, healthy: boolean, identity: QualitySeries = series) {
  return evaluateBoundServiceQuality(identity, { startMs, endMs: startMs + 20, intervalMs: 10 }, targets,
    [{ ...identity, slotMs: startMs, outcome: 'success', durationMs: 10 },
      healthy ? { ...identity, slotMs: startMs + 10, outcome: 'success', durationMs: 10 } : { ...identity, slotMs: startMs + 10, outcome: 'timeout' }], startMs + 20)
}
it('相邻同一服务/地点/政策两次健康窗口才判恢复，报告可序列化且不可改写', () => {
  const degraded = report(0, false), healthy = report(20, true), second = report(40, true)
  expect(evaluateServiceRecovery([degraded, healthy])).toEqual({ status: 'incomparable' })
  expect(evaluateServiceRecovery([degraded, healthy, second])).toMatchObject({ status: 'recovered', healthyWindows: 2, throughMs: 60 })
  expect(JSON.parse(JSON.stringify(second))).toMatchObject({ schema: 'jouleverse.service-quality/v1', assessment: { status: 'within-target' } })
  expect(Object.isFrozen(second)).toBe(true)
  if ('schema' in second) expect(Object.isFrozen(second.targets)).toBe(true)
})
it('不同端点/采集地点/政策、跳窗、未知来源对象不能解除告警', () => {
  for (const identity of [{ ...series, serviceId: 'other' }, { ...series, collectorId: 'other' }, { ...series, policyId: 'other' }]) {
    expect(evaluateServiceRecovery([report(0, false), report(20, true, identity)], 1).status).toBe('incomparable')
  }
  expect(evaluateServiceRecovery([report(0, false), report(40, true)], 1).status).toBe('incomparable')
  expect(evaluateServiceRecovery([report(0, false), JSON.parse(JSON.stringify(report(20, true)))], 1).status).toBe('incomparable')
})
it('缺报和采集混用不当作恢复，恢复门槛不可绕过', () => {
  const empty = evaluateBoundServiceQuality(series, { startMs: 20, endMs: 40, intervalMs: 10 }, targets, [], 40)
  expect(evaluateServiceRecovery([report(0, false), empty], 1).status).toBe('not-recovered')
  expect(evaluateBoundServiceQuality(series, { startMs: 0, endMs: 20, intervalMs: 10 }, targets,
    [{ ...series, serviceId: 'other', slotMs: 0, outcome: 'failed' }], 20)).toEqual({ status: 'invalid-series' })
  expect(evaluateServiceRecovery([report(0, false), report(20, true)], 0).status).toBe('incomparable')
})
