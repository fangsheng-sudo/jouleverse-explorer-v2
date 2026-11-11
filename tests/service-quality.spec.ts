import { describe, expect, it } from 'vitest'
import { evaluateServiceQuality, type QualityProbe } from '../src/integration/service-quality'

const window = { startMs: 0, endMs: 20_000, intervalMs: 1_000 }
const targets = {
  minCoverageBps: 8_000, minAvailabilityBps: 9_500,
  minObservations: 16, minLatencySamples: 10, maxP95Ms: 100,
}
const successes = (count: number, durationMs = 10): QualityProbe[] =>
  Array.from({ length: count }, (_, i) => ({ slotMs: i * 1_000, outcome: 'success', durationMs }))
const evaluate = (probes: QualityProbe[]) => evaluateServiceQuality(window, targets, probes, 20_000)

describe('service quality windows', () => {
  it('keeps missing probes separate from failures and never declares an empty window healthy', () => {
    expect(evaluate([])).toMatchObject({
      status: 'insufficient-data', coverageBps: 0, counts: { missing: 20, failed: 0 },
      availability: { lowerBps: 0, upperBps: 10_000 }, p95Ms: null,
    })
    expect(evaluate(successes(18))).toMatchObject({
      status: 'insufficient-data', availability: { lowerBps: 9_000, upperBps: 10_000 },
    })
    expect(evaluate(successes(19))).toMatchObject({
      status: 'within-target', availability: { lowerBps: 9_500, upperBps: 10_000 },
    })
  })
  it('detects an availability breach even if all missing probes would succeed', () => {
    expect(evaluate([...successes(16),
      { slotMs: 16_000, outcome: 'timeout' }, { slotMs: 17_000, outcome: 'failed' },
    ])).toMatchObject({
      status: 'degraded', availabilityState: 'breached',
      counts: { timeout: 1, failed: 1, missing: 2 }, availability: { upperBps: 9_000 },
    })
  })
  it('detects high successful-response latency, and the next adjacent window can meet targets', () => {
    const slow = [...successes(18),
      { slotMs: 18_000, outcome: 'success', durationMs: 101 },
      { slotMs: 19_000, outcome: 'success', durationMs: 500 },
    ] satisfies QualityProbe[]
    expect(evaluate(slow)).toMatchObject({ status: 'degraded', p95Ms: 101, availabilityState: 'met' })
    expect(evaluateServiceQuality({ ...window, startMs: 20_000, endMs: 40_000 }, targets,
      successes(20, 100).map(p => ({ ...p, slotMs: p.slotMs + 20_000 })), 40_000))
      .toMatchObject({ status: 'within-target', p95Ms: 100 })
  })
  it('does not report latency as healthy if there are too few successful observations', () => {
    const failed = Array.from({ length: 11 }, (_, i) => ({ slotMs: (i + 9) * 1_000, outcome: 'failed' as const }))
    expect(evaluate([...successes(9), ...failed])).toMatchObject({ status: 'degraded', latencyState: 'unknown' })
  })
  it('does not confuse rounded reporting values with decision thresholds', () => {
    const result = evaluateServiceQuality({ startMs: 0, endMs: 3, intervalMs: 1 },
      { ...targets, minCoverageBps: 6_666, minAvailabilityBps: 6_667, minObservations: 2, minLatencySamples: 1 },
      [{ slotMs: 0, outcome: 'success', durationMs: 10 }, { slotMs: 1, outcome: 'failed' }], 3)
    expect(result).toMatchObject({ status: 'degraded', availability: { upperBps: 6_667 } })
  })
  it('rejects malformed observations, windows and targets', () => {
    for (const probes of [
      [...successes(1), ...successes(1)],
      [{ slotMs: 1, outcome: 'failed' }],
      [{ slotMs: 20_000, outcome: 'failed' }],
      [{ slotMs: 0, outcome: 'success', durationMs: NaN }],
    ] satisfies QualityProbe[][]) expect(evaluate(probes)).toEqual({ status: 'invalid-probes' })

    expect(evaluateServiceQuality(window, targets, [], 19_999)).toEqual({ status: 'invalid-window' })
    expect(evaluateServiceQuality({ ...window, intervalMs: 1 }, targets, [], 20_000)).toEqual({ status: 'invalid-window' })
    expect(evaluateServiceQuality(window, { ...targets, minAvailabilityBps: 10_001 }, [], 20_000))
      .toEqual({ status: 'invalid-targets' })
  })
})

it('采集端 JSON 的空值、未知状态和超预算输入均不能判为健康', () => {
  expect(evaluateServiceQuality(null as never, targets, [], 20000)).toEqual({ status: 'invalid-window' })
  expect(evaluateServiceQuality(window, null as never, [], 20000)).toEqual({ status: 'invalid-targets' })
  expect(evaluateServiceQuality(window, targets, [null] as never, 20000)).toEqual({ status: 'invalid-probes' })
  expect(evaluateServiceQuality(window, targets, Array(10001).fill({ slotMs: 0, outcome: 'failed' }), 20000)).toEqual({ status: 'invalid-probes' })
  expect(evaluateServiceQuality(window, targets, [{ slotMs: 0, outcome: 'healthy' }] as never, 20000)).toEqual({ status: 'invalid-probes' })
})
