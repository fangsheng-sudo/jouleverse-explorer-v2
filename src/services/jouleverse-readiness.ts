import { createPublicClient, http } from 'viem'
import { jouleverseChain } from '../config/chain'
import { createNetworkProbe, type ReadinessProfile } from './network-readiness'
export const integrationProfile: ReadinessProfile = {
  schema: 'jouleverse.integration-profile/v1', chainId: jouleverseChain.id, name: jouleverseChain.name,
  rpcUrl: jouleverseChain.rpcUrls.default.http[0], explorerUrl: jouleverseChain.blockExplorers.default.url,
  nativeCurrency: { ...jouleverseChain.nativeCurrency }, multicall3: jouleverseChain.contracts.multicall3.address,
}
const client = createPublicClient({ chain: jouleverseChain, transport: http(integrationProfile.rpcUrl, { retryCount: 0, timeout: 10_000 }) })
export const checkJouleverseReadiness = createNetworkProbe(request => client.request(request), integrationProfile)
