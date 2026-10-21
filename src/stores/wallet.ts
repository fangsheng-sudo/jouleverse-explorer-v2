import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { getPublicClient, reconnect, connect as wagmiConnect, disconnect as wagmiDisconnect } from '@wagmi/core'
import { createDiscreteApi } from 'naive-ui'
import { useThemeStore } from './theme'
import { ChainMismatchError, isChainMismatch, isUserRejected } from '../utils/wallet-errors'

// Jouleverse chain config
const jouleverse = {
  id: 3666,
  name: 'Jouleverse',
  nativeCurrency: {
    name: 'Joule',
    symbol: 'J',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://rpc.jnsdao.com:8503'] },
  },
  blockExplorers: {
    default: { name: 'JScan', url: 'https://jscan.jnsdao.com' },
  },
} as const

// Wagmi config
export const config = createConfig({
  chains: [jouleverse],
  // 通用 injected connector：识别任何注入的 EIP-1193 provider
  // （MetaMask 扩展、MetaMask/欧易 App 内置浏览器的 window.ethereum 等），
  // 不锁定 io.metamask rdns，不依赖 @metamask/connect-evm SDK。
  connectors: [injected()],
  transports: {
    [jouleverse.id]: http('https://rpc.jnsdao.com:8503'),
  },
})

export const useWalletStore = defineStore('wallet', () => {
  const themeStore = useThemeStore()
  // 组件外弹 message（连接错误等需要在 store 层提示用户的场景）；
  // 用 computed 跟随主题，避免在模块顶层求值一次后切主题不跟随
  const { message } = createDiscreteApi(['message'], {
    configProviderProps: computed(() => ({
      theme: themeStore.naiveTheme,
      themeOverrides: themeStore.naiveThemeOverrides,
    })),
  })

  const isConnected = ref(false)
  const address = ref<string | null>(null)
  const balance = ref<bigint | null>(null)
  const wjBalance = ref<bigint | null>(null)
  const isConnecting = ref(false)

  // 检查是否连接
  const checkConnection = async () => {
    try {
      const connector = config.connectors[0]
      if (!connector) {
        isConnected.value = false
        return
      }

      // 尝试获取当前连接的账户
      const accounts = await connector.getAccounts()
      if (accounts && accounts.length > 0) {
        address.value = accounts[0]
        isConnected.value = true
        await getBalance()
      } else {
        isConnected.value = false
        address.value = null
      }
    } catch (error) {
      console.error('Failed to check connection:', error)
      isConnected.value = false
      address.value = null
    }
  }

  // 等待钱包 provider 注入就绪（刷新页面后 MetaMask 扩展注入有延迟）
  // 最长等待 5s，轮询检查 window.ethereum
  const waitForProvider = (timeoutMs = 5000): Promise<boolean> =>
    new Promise((resolve) => {
      const win = window as unknown as { ethereum?: unknown }
      const start = Date.now()
      const timer = setInterval(() => {
        if (win.ethereum) {
          clearInterval(timer)
          resolve(true)
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer)
          resolve(false)
        }
      }, 200)
    })

  // 恢复已连接状态（页面刷新后调用）：
  // 1. 等待 provider 就绪（避免扩展注入延迟导致误判未连接）
  // 2. 用 wagmi 官方 reconnect 静默恢复已授权连接（不弹窗）
  // 3. 兜底走 checkConnection
  const restoreConnection = async () => {
    try {
      const ready = await waitForProvider()
      if (!ready) {
        // 5s 内 provider 未就绪（如未安装钱包扩展），保持未连接状态
        return
      }
      let result = await reconnect(config)
      // 迁移兼容：老用户此前用 metaMask() 连过，storage 里没有 injected.connected 标记，
      // injected() 的 isAuthorized() 会判 false → reconnect 拿不到连接，UI 靠
      // checkConnection 兜底显示「已连接」，但 wagmi 内部 state.current 仍为空，
      // 后续 writeContract 会抛 ConnectorNotConnectedError（投票 / WJ 转账 / 签到全失效）。
      // 若探测到钱包侧仍授权，补写标记再 reconnect 一次（全程静默，不弹授权窗）。
      if (!result[0]) {
        const probed = await config.connectors[0]?.getAccounts().catch(() => [])
        if (probed && probed.length > 0) {
          await config.storage?.setItem('injected.connected', true)
          result = await reconnect(config)
        }
      }
      const conn = result[0]
      if (conn) {
        address.value = conn.accounts[0]
        isConnected.value = true
        await getBalance()
        await getWJBalance()
      } else {
        await checkConnection()
      }
    } catch (error) {
      console.error('Failed to restore connection:', error)
      await checkConnection()
    }
  }

  // 连接钱包
  const connect = async () => {
    if (isConnecting.value) return

    isConnecting.value = true
    try {
      const connector = config.connectors[0]
      if (!connector) {
        throw new Error('Wallet connector not found')
      }

      // 用 wagmi connect action 连接并写入 config.state.current，覆盖「直连
      // connector.connect() 不写 state」的口子，确保后续 writeContract 能
      // 找到 connector（否则会抛 ConnectorNotConnectedError）。
      // 连接时携带 chainId：若钱包当前不在 Jouleverse 网络，
      // injected connector 会自动 wallet_switchEthereumChain；
      // 若网络未添加（错误码 4902），自动 wallet_addEthereumChain 兜底。
      const result = await wagmiConnect(config, { connector, chainId: jouleverse.id })
      // chainId 校验：wallet_switchEthereumChain 返回非 4001 错误时，injected connector
      // 的 catch 会静默吞掉并返回旧 chainId（上游 injected.js:126-129），连接照样成功、
      // UI 显示已连接，但钱包仍停在错误链上，写操作（WJ 转账 / JNSVote 投票）会在错误网络签名。
      // 这里兜底校验，不一致则明确提示用户切换，不静默吞掉。
      if (result && result.chainId !== jouleverse.id) {
        message.error('请在钱包中切换到 Jouleverse 网络')
        // 状态一致性：connector.connect() 已返回账户并写入 injected.connected 标记，
        // 但上游静默吞掉 switch 错误、钱包仍停在错误链上。若不清理，刷新页面后
        // restoreConnection 会因残留标记误判已连接（在错误链上显示已连接）。
        // disconnect() 移除该标记并置 disconnected，下次 connect() 会自动清除。
        await wagmiDisconnect(config, { connector }).catch(() => {})
        // 用带上实际 chainId 的强类型错误向上抛：上层据此走确定性分支，
        // 不再靠 error.message 文本判断（文案会随库升级变化，必然漏判）。
        throw new ChainMismatchError(result.chainId, jouleverse)
      }
      if (result && result.accounts && result.accounts.length > 0) {
        address.value = result.accounts[0]
        isConnected.value = true
        await getBalance()
        await getWJBalance()
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error)
      // 分类判定全部走确定性判据：链不匹配看错误类型 + chainId 数值，
      // 用户拒绝看 viem 的 UserRejectedRequestError 类型 / EIP-1193 码 4001。
      if (isChainMismatch(error)) {
        // 上面已弹过「请在钱包中切换到 Jouleverse 网络」，此处不重复提示
      } else if (isUserRejected(error)) {
        message.error('已取消连接')
      } else {
        message.error('连接钱包失败，请重试')
      }
      isConnected.value = false
      address.value = null
      balance.value = null
      wjBalance.value = null
      throw error
    } finally {
      isConnecting.value = false
    }
  }

  // 断开连接
  const disconnect = async () => {
    try {
      const connector = config.connectors[0]
      if (!connector) return

      await wagmiDisconnect(config, { connector })
      address.value = null
      isConnected.value = false
      balance.value = null
      wjBalance.value = null
    } catch (error) {
      console.error('Failed to disconnect wallet:', error)
    }
  }

  // 获取 J 余额
  const getBalance = async () => {
    if (!address.value) return

    try {
      const client = getPublicClient(config)
      const balanceData = await client.getBalance({
        address: address.value as `0x${string}`,
      })
      balance.value = balanceData
    } catch (error) {
      console.error('Failed to get balance:', error)
    }
  }

  // 获取 WJ 余额
  const getWJBalance = async () => {
    if (!address.value) return

    try {
      const client = getPublicClient(config)
      
      // WJ 合约 ABI（简化版）
      const wjABI = [
        {
          inputs: [{ name: '', type: 'address' }],
          name: 'balanceOf',
          outputs: [{ name: '', type: 'uint256' }],
          stateMutability: 'view',
          type: 'function',
        },
      ] as const

      const wjAddress = '0x7fba9BB966189Db8C4fE33B7bf67Bfa24203c6AD' as const

      const balanceData = await client.readContract({
        address: wjAddress,
        abi: wjABI,
        functionName: 'balanceOf',
        args: [address.value as `0x${string}`],
      })

      wjBalance.value = balanceData as bigint
    } catch (error) {
      console.error('Failed to get WJ balance:', error)
    }
  }

  // 刷新所有余额
  const refreshBalances = async () => {
    await Promise.all([
      getBalance(),
      getWJBalance(),
    ])
  }

  // 格式化地址
  const formatAddress = (addr: string | null): string => {
    if (!addr) return ''
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`
  }

  // 格式化余额
  const formatBalance = (bal: bigint | null): string => {
    if (bal === null || bal === 0n) return '0'
    return (Number(bal) / 1e18).toFixed(4)
  }

  return {
    isConnected,
    address,
    balance,
    wjBalance,
    isConnecting,
    connect,
    disconnect,
    getBalance,
    getWJBalance,
    refreshBalances,
    checkConnection,
    restoreConnection,
    formatAddress,
    formatBalance,
  }
})
