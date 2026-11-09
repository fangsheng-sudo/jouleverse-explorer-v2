# Jouleverse Developer Integration Kit V1

A repository-local, read-only integration facade for Jouleverse ecosystem developers, enterprises, agents, and third-party applications.

The kit reuses the chain configuration, registered contract directory, and deployment-code observation module already maintained by this repository. It does not introduce an application-specific dependency.

## Scope and guarantees

- Creating the kit and listing registered contracts do not make network requests.
- Network access occurs only after an explicit verification or adapter method call.
- Contract verification accepts a registered contract key, not an arbitrary caller-supplied address.
- Transaction receipt observation accepts a 32-byte transaction hash and delegates to a caller-provided trusted adapter.
- Missing optional adapters fail closed with a typed error.
- The kit does not connect wallets, sign messages, broadcast transactions, transfer assets, or settle orders.

## Minimal usage

```ts
import { createJouleverseKit } from './src/integration/jouleverse-kit'

const kit = createJouleverseKit()
const network = kit.network
const contracts = kit.listContracts()

// Explicitly performs read-only RPC calls for a registered contract.
const deployment = await kit.verifyContract('wj')
console.log({ network, contracts, deployment })
```

## Optional adapters

Integrators may provide existing readiness and receipt-observation functions. The kit deliberately does not duplicate node diagnostics or receipt parsing.

```ts
const kit = createJouleverseKit({
  checkReadiness: async () => readinessService.inspect(),
  observeReceipt: async (hash) => receiptService.observe(hash),
})
```

The adapters are trusted dependencies supplied by the integrator. This facade validates the transaction-hash format but does not independently establish the adapter's authenticity, receipt correctness, or data freshness. Integrators must verify adapter provenance and preserve the returned observation metadata.

## Important limitations

- A matching runtime-code hash is only a match against an observed baseline; it is not source verification or a security audit.
- A successful transaction receipt does not prove token payment, order fulfillment, or settlement.
- This module is currently imported from the repository source tree; it is not yet a separately published package with a semver compatibility guarantee.
- Production integrations must add their own authenticated identity, rate limits, monitoring, and server-side authorization where applicable.

## Validation

The associated tests cover offline initialization, immutable snapshots, unknown contract rejection, serializable results, transaction-hash validation, adapter delegation, and fail-closed behavior.
