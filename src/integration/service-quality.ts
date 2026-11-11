export interface QualityWindow {
  startMs: number
  endMs: number
  intervalMs: number
}

export interface QualityTargets {
  /** Basis points: 10,000 = 100%. */
  minCoverageBps: number
  minAvailabilityBps: number
  minObservations: number
  minLatencySamples: number
  maxP95Ms: number
}

/** A trusted collector assigns one terminal result to each scheduled slot. */
export type QualityProbe = { slotMs: number } & (
  | { outcome: 'success'; durationMs: number }
  | { outcome: 'timeout' | 'failed' }
)

const maxSlots = 10_000
const bps = 10_000
const nonnegativeInteger = (n: number) => Number.isSafeInteger(n) && n >= 0
const positiveInteger = (n: number) => nonnegativeInteger(n) && n > 0

/** Evaluate one completed, half-open window for a single service and probe policy. */
function evaluateServiceQualityUnchecked(
  window: Readonly<QualityWindow>,
  targets: Readonly<QualityTargets>,
  probes: readonly QualityProbe[],
  nowMs: number,
) {
  const { startMs, endMs, intervalMs } = window
  if (![startMs, endMs, nowMs].every(nonnegativeInteger) || !positiveInteger(intervalMs) ||
      endMs <= startMs || endMs > nowMs || (endMs - startMs) % intervalMs !== 0) {
    return { status: 'invalid-window' } as const
  }
  const expected = (endMs - startMs) / intervalMs
  if (expected > maxSlots) return { status: 'invalid-window' } as const
  if (![targets.minCoverageBps, targets.minAvailabilityBps].every(n => positiveInteger(n) && n <= bps) ||
      !positiveInteger(targets.minObservations) || targets.minObservations > expected ||
      !positiveInteger(targets.minLatencySamples) || targets.minLatencySamples > expected ||
      !positiveInteger(targets.maxP95Ms)) return { status: 'invalid-targets' } as const

  if (probes.length > expected) return { status: 'invalid-probes' } as const
  const seen = new Set<number>()
  const durations: number[] = []
  let timeout = 0
  let failed = 0
  for (const probe of probes) {
    const slot = probe.slotMs
    if (!nonnegativeInteger(slot) || slot < startMs || slot >= endMs ||
        (slot - startMs) % intervalMs !== 0 || seen.has(slot)) return { status: 'invalid-probes' } as const
    seen.add(slot)
    switch (probe.outcome) {
      case 'success':
        if (!nonnegativeInteger(probe.durationMs)) return { status: 'invalid-probes' } as const
        durations.push(probe.durationMs)
        break
      case 'timeout': timeout++; break
      case 'failed': failed++; break
      default: return { status: 'invalid-probes' } as const
    }
  }

  const observed = seen.size
  const missing = expected - observed
  const success = durations.length
  durations.sort((a, b) => a - b)
  const p95Ms = durations[Math.ceil(success * 95 / 100) - 1] ?? null
  const counts = { expected, observed, success, timeout, failed, missing }
  const coverageBps = Math.floor(observed * bps / expected)
  const availability = {
    // Display bounds are rounded outwards; decisions compare exact ratios below.
    lowerBps: Math.floor(success * bps / expected),
    upperBps: Math.ceil((success + missing) * bps / expected),
  }
  const sufficient = observed >= targets.minObservations && observed * bps >= targets.minCoverageBps * expected
  const goal = targets.minAvailabilityBps * expected
  const latencyReady = p95Ms !== null && success >= targets.minLatencySamples
  const availabilityState = !sufficient ? 'unknown' : (success + missing) * bps < goal
    ? 'breached' : success * bps >= goal ? 'met' : 'unknown'
  const latencyState = !sufficient || !latencyReady ? 'unknown' : p95Ms > targets.maxP95Ms ? 'breached' : 'met'
  const status = availabilityState === 'breached' || latencyState === 'breached' ? 'degraded'
    : availabilityState === 'met' && latencyState === 'met' ? 'within-target' : 'insufficient-data'
  return { status, counts, coverageBps, availability, availabilityState, latencyState, p95Ms } as const
}


/** Runtime boundary for collector JSON: malformed input cannot throw or become healthy. */
export function evaluateServiceQuality(
  window: Readonly<QualityWindow>, targets: Readonly<QualityTargets>, probes: readonly QualityProbe[], nowMs: number,
) {
  if (!window || typeof window !== 'object') return { status: 'invalid-window' } as const
  if (!targets || typeof targets !== 'object') return { status: 'invalid-targets' } as const
  if (!Array.isArray(probes) || probes.length > 10000 || probes.some(p => !p || typeof p !== 'object')) return { status: 'invalid-probes' } as const
  try { return evaluateServiceQualityUnchecked(window, targets, probes, nowMs) }
  catch { return { status: 'invalid-probes' } as const }
}
