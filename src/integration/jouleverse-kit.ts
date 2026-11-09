import { jouleverseChain } from '../config/chain'
import { toolboxContracts } from '../contracts/toolbox'
import { getDeploymentBaseline, verifyDeployment, type DeploymentReader } from '../contracts/deployment-verification'

export const JOULEVERSE_KIT_VERSION = 1

export type IntegrationErrorCode =
  | 'unknown-contract'
  | 'invalid-transaction-hash'
  | 'adapter-unavailable'

export class IntegrationError extends Error {
  constructor(readonly code: IntegrationErrorCode, message: string) {
    super(message)
    this.name = 'IntegrationError'
  }
}

export interface IntegrationAdapters<Readiness, Receipt> {
  deploymentReader?: DeploymentReader
  checkReadiness?: () => Promise<Readiness>
  observeReceipt?: (hash: `0x${string}`) => Promise<Receipt>
}

function contractSnapshot(contract: (typeof toolboxContracts)[number]) {
  return Object.freeze({
    key: contract.key,
    name: contract.name,
    category: contract.category,
    address: contract.address,
    chainId: jouleverseChain.id,
    observedCodeHash: getDeploymentBaseline(contract.address) ?? null,
  })
}

/**
 * Creates an offline-by-default, read-only integration facade.
 * No network request is made until an explicit method is called.
 * This module never connects a wallet, signs, broadcasts, or settles transactions.
 */
export function createJouleverseKit<Readiness = never, Receipt = never>(
  adapters: IntegrationAdapters<Readiness, Receipt> = {},
) {
  const { deploymentReader, checkReadiness, observeReceipt } = adapters

  return Object.freeze({
    version: JOULEVERSE_KIT_VERSION,
    network: Object.freeze({
      chainId: jouleverseChain.id,
      name: jouleverseChain.name,
      rpcUrl: jouleverseChain.rpcUrls.default.http[0],
      explorerUrl: jouleverseChain.blockExplorers.default.url,
    }),
    capabilities: Object.freeze({
      deployment: true,
      readiness: typeof checkReadiness === 'function',
      receipt: typeof observeReceipt === 'function',
    }),
    listContracts: () => toolboxContracts.map(contractSnapshot),
    async verifyContract(key: string) {
      const contract = toolboxContracts.find(item => item.key === key)
      if (!contract) throw new IntegrationError('unknown-contract', 'Unknown registered contract')
      const result = await verifyDeployment(contract.address, deploymentReader)
      return Object.freeze({
        contract: contractSnapshot(contract),
        status: result.status,
        blockNumber: 'blockNumber' in result ? result.blockNumber.toString() : null,
        codeHash: 'codeHash' in result ? result.codeHash : null,
      })
    },
    async checkReadiness() {
      if (typeof checkReadiness !== 'function') {
        throw new IntegrationError('adapter-unavailable', 'Readiness adapter is not configured')
      }
      return checkReadiness()
    },
    async observeTransaction(hash: string) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        throw new IntegrationError('invalid-transaction-hash', 'Transaction hash must be 32-byte hex')
      }
      if (typeof observeReceipt !== 'function') {
        throw new IntegrationError('adapter-unavailable', 'Receipt adapter is not configured')
      }
      return observeReceipt(hash.toLowerCase() as `0x${string}`)
    },
  })
}
