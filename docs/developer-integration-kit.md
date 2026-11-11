# Jouleverse 开发者只读接入套件 V1

这是仓库内的 TypeScript 模块，尚未发布 npm 包。供第三方前端或 Node 应用导入，复用唯一网络配置、合约目录和部署基线。创建实例、查看网络信息和目录均为本地操作；不需要钱包、账户、私钥或后端。套件不提供签名、交易发送、授权、任意 RPC 方法或全链扫描接口。

## 最小接入

以下相对导入以仓库根目录的 TypeScript 调用文件为例，使用项目现有 Vite/TypeScript 工具链构建；不是独立安装包。浏览器需支持 `structuredClone`、`AbortController` 和 Fetch。Node 使用支持原生 Fetch 的受维护版本；本仓库测试环境为 Node 24，CI 为 Node 22。

```ts
import { createJouleverseKit, IntegrationError } from './src/integration/jouleverse-kit'

const kit = createJouleverseKit({}, { timeoutMs: 15000 })
console.log(kit.network, kit.listContracts()) // 零 RPC
console.log(kit.listReadMethods('wj')) // 只有 view / pure 的 ABI 副本

try {
  const verification = await kit.verifyContract('wj')
  console.log(JSON.stringify(verification))
  // 也会独立核验网络及代码；不会把前一次核验当作长期授权缓存。
  const supply = await kit.readContract('wj', 'totalSupply')
  console.log(JSON.stringify(supply, (_, v) => typeof v === 'bigint' ? v.toString() : v))
} catch (error) {
  if (error instanceof IntegrationError) console.log(error.code)
  else throw error
}
```

`network` 包含 chainId（3666）、名称、原生币元数据、RPC、浏览器、Multicall3 地址及固定基线区块号/哈希；对象和嵌套对象冻结。链 ID 单独不足以区分克隆链，代码核验还会核对已登记的基线区块哈希。高度字段以十进制字符串导出；合约读取的 `value` 保留 viem 解码类型，可能包含 bigint，需像示例一样序列化。目录数组、合约条目和部署核验报告被冻结，且从创建时的隔离目录生成，不受共享注册表后续修改影响。只读 ABI 仍为可修改的独立副本，不暴露内部引用。

## API 与请求预算

| 接口 | 行为与上限（默认 transport，无自动重试） |
| --- | --- |
| `verifyNetworkIdentity()` | 未配置受信创世哈希时零请求、返回 unconfigured；配置后最多 2 次请求，受统一超时/并发控制 |
| `listContracts()` / `listReadMethods(key)` | 本地快照，无 RPC；只接受登记的合约编号 |
| `verifyContract(key)` | 默认最多 4 次顺序只读 RPC：链 ID、基线区块、当前高度、该高度的运行时代码；首次失败后停止 |
| `readContract(key, functionName, args?)` | 默认最多上述 4 次 + 1 次 `eth_call`，代码与调用使用同一区块号；仅允许目录 ABI 中无重载歧义的 view/pure 函数 |
| `checkReadiness()` | 需显式适配器；现有主线服务最多 8 次只读请求 |
| `observeTransaction(hash)` | 需显式适配器；现有主线服务最多 5 次只读请求；32 字节哈希预校验并转小写 |

`readContract` 在联网前校验方法和 ABI 参数，只在代码核验为 `match` 时读取。缺基线的合约可以通过 `verifyContract` 获得 `unverified` 报告，但不能用此入口调用。不会接受任意合约地址、用户提供的 ABI、写方法、钱包连接或 `value`。不支持重载名称，接入方不得用任意方法调用绕开限制。校验输入错误、未知编号或缺失适配器时请求数为零。

每实例最多 2 个未完成操作，不排队、不轮询、不缓存 RPC 结果。总截止时间默认 15 秒，允许 1–30000 毫秒；超时抛出 `timeout` 并通知适配器取消。原生 viem 请求有自身超时；已发出的请求不保证立即取消，但超时后不会启动后续核验/读取。忽略取消且永不结束的适配器会继续占用槽位，防止无限后台请求。调用方应停止重复调用并修复适配器；不得循环新建实例逃避预算。

## 可选的受信创世身份

融合版吸收独立 `verifyNetworkIdentity` helper，并把它接入套件的部署/合约读取前置检查。`expectedGenesisHash` 必须由维护者通过独立受信链规范提供，不得从正在检测的 RPC 读取后自动接受，也不内置未经独立确认的值。

```ts
import type { Hex } from 'viem'
import { createJouleverseKit } from './src/integration/jouleverse-kit'

export function createForTrustedNetwork(expectedGenesisHash: Hex) {
  return createJouleverseKit({}, { expectedGenesisHash, timeoutMs: 15000 })
}
```

未配置时 `network.genesisHash === null`、`network.identityPolicy === 'checkpoint-only'`、`capabilities.networkIdentity === false`；保留主线既有链 ID＋固定区块锚＋代码基线检查。显式 `verifyNetworkIdentity()` 返回 unconfigured，而不是 verified。

配置合法受信值后策略为 `genesis-and-checkpoint`：先核对链 ID 与创世哈希，再核对固定区块锚与当前代码。错误创世立即停止；每次操作内部复用链 ID 观测，部署核验最多 5 次请求，合约读取最多 6 次，不缓存跨操作授权。配置格式非法在创建时抛 invalid-argument。

此策略约束套件自己的部署与合约读取，以及显式身份检查；传入的诊断/回执适配器仍须负责自己的网络绑定和业务验证，不会因 networkIdentity capability 为 true 自动变为可信。独立 helper 的用法、取消边界和信任限制见 [网络身份说明](network-identity.md)。

## 核验状态与信任边界

`verifyContract` 返回 `{ contract, status, blockNumber, codeHash }`，未获得的观察字段为 null。状态：

| 状态 | 含义 |
| --- | --- |
| `match` | 响应代码的摘要与已登记的观察基线一致 |
| `mismatch` | 有代码，但摘要不同 |
| `unverified` | 有代码，未登记摘要基线 |
| `no-code` | 返回空代码（viem 会把 `0x` 规范化为 undefined） |
| `wrong-chain` | 链 ID 不符合配置，未查询基线/代码 |
| `genesis-mismatch` | 配置的受信创世哈希与节点响应不符，未继续查代码 |
| `identity-unavailable` | 配置了创世策略，但身份探测失败，未继续查代码 |
| `baseline-mismatch` | 固定高度区块哈希不符合配置，未查询当前代码 |
| `error` | RPC 失败、非法代码、无效/过旧高度或其他核验异常 |

超时以异常报告，不伪装成匹配。代码摘要基线是链上观察结果，不是独立源码编译证明；不能证明源码正确、权限安全、代理实现或存储状态不变。RPC 可以伪造所有响应，基线核验不取代可信节点或共识验证。按区块号固定读取不能防止两次请求之间的重组，也不是结算终局性保证。需要防重组、确认数或付款判断的应用应另行执行相应业务核验。Jouleverse 已禁用普通原生 J 转账；付款场景需正确验证代币事件，不能把顶层回执成功当作付款成功。

## 诊断、回执和自定义 transport

可直接接入主线已有服务，不复制其业务语义：

```ts
import { createJouleverseKit } from './src/integration/jouleverse-kit'
import { checkJouleverseReadiness } from './src/services/jouleverse-readiness'
import { verifyJouleverseReceipt } from './src/services/jouleverse-receipt'

const kit = createJouleverseKit({
  checkReadiness: checkJouleverseReadiness,
  observeReceipt: verifyJouleverseReceipt,
})
// capabilities 标记功能配置情况，不表示网络已就绪或合约可信。
const report = await kit.checkReadiness()
```

自定义适配器接口见 `IntegrationAdapters` / `ReadContractRequest`。诊断、回执和读取适配器收到 AbortSignal，应尊重取消、限制请求并自行验证返回值。其输出原样交付，不代表套件额外审计了输出。适配器是可信应用代码，套件无法阻止恶意适配器写链或泄漏数据。

自定义合约读取时，必须成对提供连接同一可信节点的 `deploymentReader` 和 `readContract` 适配器；只提供任意一个时读取明确失败，避免把自定义核验节点与默认读取节点混用。自定义适配器自行负责 transport 超时、无重试策略和预算。没有注入适配器时，默认部署及合约读取使用配置中的公共 HTTPS RPC。

默认路径需要允许 `rpc.jnsdao.com` 出站 HTTPS。浏览器跨域访问受节点 CORS 策略约束。代理环境下 Node Fetch 必须使用运行环境支持的代理和 CA 信任配置（本次云环境 Node 24 使用 `--use-env-proxy` 验证），不要关闭 TLS 校验、把凭据放进 URL 或将私钥打包进前端。

## 错误、隐私与安全

`IntegrationError.code` 稳定且可用于分支处理：

- `unknown-contract`、`invalid-transaction-hash`、`invalid-argument`：输入无效。
- `read-not-allowed`：非允许的函数或有重载歧义。
- `adapter-unavailable`：未配置功能或读取适配器。
- `deployment-untrusted`：读取前的部署核验没有得到 match；可显式调用 verifyContract 获取状态。
- `adapter-error`：适配器同步抛出或异步拒绝。原始错误、cause、请求和节点消息不暴露。
- `timeout`：整体操作超过截止时间。
- `busy`：已有两个底层操作未结束，未启动新请求。

套件不写 localStorage/IndexedDB、无遥测和持久化日志。RPC 服务仍可看到访问源、查询地址、交易哈希和调用参数。接入方应获得必要的数据使用授权，避免把业务订单号、用户身份或原始 RPC 错误上传到日志。任何含身份信息的业务适配器输出均由接入方负责，错误脱敏不等于输出脱敏。

## 验证与限制

运行 `npx vitest run tests/jouleverse-kit.spec.ts tests/jouleverse-kit.integration.spec.ts`。集成测试启动临时本地 HTTP JSON-RPC 服务，使用真实 viem transport、ABI 编解码和部署核验，覆盖成功、错误网络、代码变化、空代码和固定高度。WJ fixture 仅含公开运行时代码，采样摘要必须与主线观察基线一致；不是源码证明。测试不发送交易，不需要公共 RPC，不修改基线。

完整门禁为 `npm test`、`npm run build`（包含应用及测试类型检查）、`node scripts/check-feature-roadmap.ts`。本功能分支不改动依赖声明、锁文件或 registry 配置；依赖治理单独处理，功能门禁通过不代表依赖审计零告警。


`capabilities.contractRead` 表示内置默认读取可用，或自定义部署与读取适配器已完整配对；它不表示节点在线或代码已经匹配。
