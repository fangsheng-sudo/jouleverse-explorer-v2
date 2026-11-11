import { createPublicClient, encodeFunctionData, http, type Abi, type Address } from 'viem'
import { jouleverseChain } from '../config/chain'
import { toolboxContracts } from '../contracts/toolbox'
import { baselineBlock, getDeploymentBaseline, verifyDeployment, type DeploymentReader } from '../contracts/deployment-verification'

export const JOULEVERSE_KIT_VERSION = 1
export type IntegrationErrorCode = 'unknown-contract' | 'invalid-transaction-hash' | 'adapter-unavailable'
  | 'adapter-error' | 'timeout' | 'busy' | 'invalid-argument' | 'read-not-allowed' | 'deployment-untrusted'

/** Stable, deliberately sanitized errors: upstream messages may contain credentials or user data. */
export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode
  constructor(code: IntegrationErrorCode) {
    super(`Jouleverse integration: ${code}`)
    this.code = code
    this.name = 'IntegrationError'
  }
}

export interface ReadContractRequest {
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  blockNumber: bigint
}
export interface IntegrationAdapters<Readiness, Receipt> {
  deploymentReader?: DeploymentReader
  readContract?: (request: ReadContractRequest, signal: AbortSignal) => Promise<unknown>
  checkReadiness?: (signal: AbortSignal) => Promise<Readiness>
  observeReceipt?: (hash: string, signal: AbortSignal) => Promise<Receipt>
}
export interface IntegrationOptions {
  /** 1..30000 ms; applies to the entire operation, including injected adapters. */
  timeoutMs?: number
}

function contractSnapshot(contract: (typeof toolboxContracts)[number]) {
  return {
    key: contract.key, name: contract.name, category: contract.category, address: contract.address,
    chainId: jouleverseChain.id,
    observedCodeHash: getDeploymentBaseline(contract.address) ?? null,
  }
}

/** No wallet, storage, telemetry or request is started during creation. */
export function createJouleverseKit<Readiness = never, Receipt = never>(
  adapters: IntegrationAdapters<Readiness, Receipt> = {}, options: IntegrationOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 15000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new IntegrationError('invalid-argument')
  const { deploymentReader, readContract, checkReadiness, observeReceipt } = adapters
  // Detach the public registry's mutable objects. No ABI with write methods crosses the boundary.
  const contracts = structuredClone(toolboxContracts)
  const find = (key: string) => {
    const contract = contracts.find(item => item.key === key)
    if (!contract) throw new IntegrationError('unknown-contract')
    return contract
  }
  const client = () => createPublicClient({
    chain: jouleverseChain, cacheTime: 0, ccipRead: false,
    transport: http(undefined, { retryCount: 0, timeout: timeoutMs }),
  })
  // Keep a slot until the underlying adapter settles, even after timeout; an adapter
  // ignoring cancellation cannot create an unbounded set of background requests.
  let active = 0
  async function run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (active >= 2) throw new IntegrationError('busy')
    active++
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const task = Promise.resolve().then(() => operation(controller.signal)).finally(() => { active-- })
    try {
      return await Promise.race([task, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new IntegrationError('timeout'))
          controller.abort()
        }, timeoutMs)
      })])
    } catch (error) {
      if (error instanceof IntegrationError) throw new IntegrationError(error.code)
      throw new IntegrationError('adapter-error')
    } finally {
      clearTimeout(timer)
    }
  }
  const verify = (key: string, signal: AbortSignal) => {
    const reader = deploymentReader ?? client()
    const check = () => { if (signal.aborted) throw new IntegrationError('timeout') }
    return verifyDeployment(find(key).address, {
      getChainId: async () => { check(); return reader.getChainId() },
      getBlock: async args => { check(); return reader.getBlock(args) },
      getBlockNumber: async () => {
        check()
        const height = await reader.getBlockNumber()
        if (typeof height !== 'bigint' || height < baselineBlock.number) throw new IntegrationError('adapter-error')
        return height
      },
      getCode: async args => {
        check()
        // viem normalizes a valid empty `0x` response to undefined.
        return reader.getCode(args)
      },
    })
  }
  return Object.freeze({
    version: JOULEVERSE_KIT_VERSION,
    network: Object.freeze({
      chainId: jouleverseChain.id, name: jouleverseChain.name,
      nativeCurrency: Object.freeze({ ...jouleverseChain.nativeCurrency }),
      rpcUrl: jouleverseChain.rpcUrls.default.http[0],
      explorerUrl: jouleverseChain.blockExplorers.default.url,
      multicall3: jouleverseChain.contracts.multicall3.address,
      baseline: Object.freeze({ blockNumber: baselineBlock.number.toString(), blockHash: baselineBlock.hash }),
    }),
    capabilities: Object.freeze({ deployment: true, contractRead: Boolean(deploymentReader) === Boolean(readContract),
      readiness: Boolean(checkReadiness), receipt: Boolean(observeReceipt) }),
    listContracts: () => contracts.map(contractSnapshot),
    listReadMethods(key: string) {
      return find(key).abi
        .filter(item => item.type === 'function' && (item.stateMutability === 'view' || item.stateMutability === 'pure'))
        .map(item => structuredClone(item))
    },
    async verifyContract(key: string) {
      const contract = find(key)
      return run(async signal => {
        const result = await verify(key, signal)
        return {
          contract: contractSnapshot(contract), status: result.status,
          blockNumber: 'blockNumber' in result ? result.blockNumber.toString() : null,
          codeHash: 'codeHash' in result ? result.codeHash : null,
        }
      })
    },
    /** Only registered, unambiguous view/pure functions on matching observed code. */
    async readContract(key: string, functionName: string, args: readonly unknown[] = []) {
      const contract = find(key)
      const functions = contract.abi.filter(item => item.type === 'function' && item.name === functionName)
      const fn = functions[0]
      if (functions.length !== 1 || !fn || fn.type !== 'function'
        || !['view', 'pure'].includes(fn.stateMutability)) throw new IntegrationError('read-not-allowed')
      if (!Array.isArray(args) || args.length !== fn.inputs.length) throw new IntegrationError('invalid-argument')
      // Never silently mix an injected verification endpoint with the default read endpoint.
      if (Boolean(deploymentReader) !== Boolean(readContract)) throw new IntegrationError('adapter-unavailable')
      let readArgs: readonly unknown[]
      try {
        readArgs = structuredClone(args)
        encodeFunctionData({ abi: [fn], functionName, args: readArgs })
      } catch { throw new IntegrationError('invalid-argument') }
      return run(async signal => {
        const result = await verify(key, signal)
        if (signal.aborted) throw new IntegrationError('timeout')
        if (result.status !== 'match') throw new IntegrationError('deployment-untrusted')
        const request = { address: contract.address, abi: structuredClone([fn]), functionName,
          args: readArgs, blockNumber: result.blockNumber }
        const value = readContract ? await readContract(request, signal) : await client().readContract(request)
        return { chainId: jouleverseChain.id, address: contract.address, blockNumber: result.blockNumber.toString(),
          codeHash: result.codeHash, value }
      })
    },
    async checkReadiness() {
      if (!checkReadiness) throw new IntegrationError('adapter-unavailable')
      return run(signal => checkReadiness(signal))
    },
    async observeTransaction(hash: string) {
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new IntegrationError('invalid-transaction-hash')
      if (!observeReceipt) throw new IntegrationError('adapter-unavailable')
      return run(signal => observeReceipt(hash.toLowerCase(), signal))
    },
  })
}
