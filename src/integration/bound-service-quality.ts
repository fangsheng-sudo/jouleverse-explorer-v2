import { evaluateServiceQuality, type QualityWindow, type QualityTargets, type QualityProbe } from './service-quality'

export interface QualitySeries { serviceId: string; collectorId: string; policyId: string }
export type BoundQualityProbe = QualityProbe & QualitySeries
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const trusted = new WeakSet<object>()
function validSeries(series: QualitySeries) {
  return series && [series.serviceId, series.collectorId, series.policyId].every(x => typeof x === 'string' && identifier.test(x))
}

/** Caller authenticates its collector. IDs isolate series but do not authenticate observations. */
export function evaluateBoundServiceQuality(
  series: Readonly<QualitySeries>, window: Readonly<QualityWindow>, targets: Readonly<QualityTargets>,
  probes: readonly BoundQualityProbe[], nowMs: number,
) {
  if (!validSeries(series) || !window || typeof window !== 'object' || !targets || typeof targets !== 'object' || !Array.isArray(probes) || probes.length > 10000 || probes.some(p => !p ||
      p.serviceId !== series.serviceId || p.collectorId !== series.collectorId || p.policyId !== series.policyId)) {
    return { status: 'invalid-series' } as const
  }
  const assessment = evaluateServiceQuality(window, targets, probes, nowMs)
  const snapshot = Object.freeze({ ...assessment,
    ...('counts' in assessment ? { counts: Object.freeze({ ...assessment.counts }), availability: Object.freeze({ ...assessment.availability }) } : {}),
  })
  const report = Object.freeze({
    schema: 'jouleverse.service-quality/v1' as const,
    series: Object.freeze({ serviceId: series.serviceId, collectorId: series.collectorId, policyId: series.policyId }),
    window: Object.freeze({ startMs: window.startMs, endMs: window.endMs, intervalMs: window.intervalMs }),
    targets: Object.freeze({ minCoverageBps: targets.minCoverageBps, minAvailabilityBps: targets.minAvailabilityBps,
      minObservations: targets.minObservations, minLatencySamples: targets.minLatencySamples, maxP95Ms: targets.maxP95Ms }),
    evaluatedAtMs: nowMs, assessment: snapshot,
  })
  trusted.add(report)
  return report
}
export type BoundQualityReport = ReturnType<typeof evaluateBoundServiceQuality>

/** Transition detector, not an alert sender. Requires freshly evaluated in-process reports. */
export function evaluateServiceRecovery(reports: readonly BoundQualityReport[], minHealthyWindows = 2) {
  if (!Array.isArray(reports) || !Number.isSafeInteger(minHealthyWindows) || minHealthyWindows < 1 || minHealthyWindows > 100 ||
      reports.length < minHealthyWindows + 1) return { status: 'incomparable' } as const
  const selected = reports.slice(-(minHealthyWindows + 1))
  if (selected.some(r => !r || !trusted.has(r) || !('schema' in r))) return { status: 'incomparable' } as const
  // The provenance check above permits only frozen reports from our evaluator.
  const valid = selected as Exclude<BoundQualityReport, { status: 'invalid-series' }>[]
  const first = valid[0]!
  for (let i = 0; i < valid.length; i++) {
    const current = valid[i]!
    if (JSON.stringify(current.series) !== JSON.stringify(first.series) ||
        JSON.stringify(current.targets) !== JSON.stringify(first.targets) ||
        current.window.intervalMs !== first.window.intervalMs ||
        current.window.endMs - current.window.startMs !== first.window.endMs - first.window.startMs ||
        (i > 0 && valid[i - 1]!.window.endMs !== current.window.startMs)) return { status: 'incomparable' } as const
  }
  if (first.assessment.status === 'degraded' && valid.slice(1).every(r => r.assessment.status === 'within-target')) {
    return Object.freeze({ status: 'recovered' as const, healthyWindows: minHealthyWindows,
      fromMs: first.window.endMs, throughMs: valid.at(-1)!.window.endMs, series: first.series })
  }
  return { status: 'not-recovered' } as const
}
