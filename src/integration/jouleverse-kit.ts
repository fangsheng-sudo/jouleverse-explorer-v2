import { jouleverseChain } from '../config/chain'
import { toolboxContracts } from '../contracts/toolbox'
import { getDeploymentBaseline, verifyDeployment, type DeploymentReader } from '../contracts/deployment-verification'

export const JOULEVERSE_KIT_VERSION = 1

export type IntegrationErrorCode =
  | 'unknown-contract'
  | 'invalid-transaction-hash'
  | 'adapter-unavailable'

export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode

  constructor(code: IntegrationErrorCode, message: string) {
    super(message)
    this.code = code
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

/** 面向应用的只读入口；创建时不发起任何请求，也不连接钱包、签名或广播交易。 */
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
      if (!contract) throw new IntegrationError('unknown-contract', '未知合约编号，未发送请求')
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
        throw new IntegrationError('adapter-unavailable', '未配置接入诊断适配器')
      }
      return checkReadiness()
    },
    async observeTransaction(hash: string) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        throw new IntegrationError('invalid-transaction-hash', '交易哈希格式不正确，未发送请求')
      }
      if (typeof observeReceipt !== 'function') {
        throw new IntegrationError('adapter-unavailable', '未配置交易回执核验适配器')
      }
      return observeReceipt(hash.toLowerCase() as `0x${string}`)
    },
  })
}
