# 生态接入清单与只读验收工具包 V1

状态：本分支实现，待审、未部署。入口 `/tools/integration`，实际地址 `#/tools/integration`。

## 用途

复用既有chain.ts配置、viem读取能力及design-system，为生态开发者提供统一机器可读接入清单和有明确边界的节点能力观察。不是完整SDK、节点SLA认证、轻客户端或FireFly兼容证明。

首次进入页面0请求；下载本地清单0请求；仅用户点击开始检测才访问配置中的公开RPC，不允许输入任意端点。

## 机器接口

- `jouleverse.integration-profile/v1`：网络编号、名称、RPC/浏览器地址、原生币显示信息、多调用合约地址、可选可信创世哈希。
- `jouleverse.integration-observation/v1`：本地观察时间、固定高度、区块/创世哈希、建议价格、基础费用、代码摘要、各检查状态和限制。
- `probeNetwork(read,profile)`：核心不依赖Vue/钱包，read只须支持所列只读方法。
- `createNetworkProbe(...)`：同模块并发合并、60秒内存缓存；返回深克隆，调用者不能污染缓存。

## 请求预算

| 步骤 | 方法 | 上限 |
|---|---|---:|
| 先核对链 | eth_chainId | 1 |
| 获取固定高度与自报版本 | eth_blockNumber + web3_clientVersion | 2 |
| 创世、固定高度区块、建议价格、代码 | eth_getBlockByNumber ×2 + eth_gasPrice + eth_getCode | 4 |
| 代码存在且区块读取成功后 | eth_call getChainId | 1 |

总计最多8次，同时最多2次；无重试、无轮询、无日志扫描/区块遍历。单请求超时10秒；多阶段总耗时可能更长，不能称“10秒整轮超时”。错链1次后终止；无代码不调用合约，最多7次。

有fail时result为blocked且不缓存；可选信息未知保留warn；没有fail时也仅称observed，不称“全面兼容”。节点版本、费用建议和区块均为该节点自报。缓存标注原始时间，不用于推断实时在线率。

## 信任与兼容范围

- 主网配置没有擅自加入“官方确认创世哈希”。当未配置可信预期值时，记录观察值且明确warn；未来由链方确认后再设置锚点。
- 创世锚点匹配也不独立验证共识或证明节点可信。
- 固定高度读区块/代码/只读方法减少标签漂移，但没有对整个区间重组进行独立证明。
- 多调用只检查非空代码和getChainId，代码摘要仅作指纹，不保证部署来源或完整ABI正确。
- 不测试写交易、钱包签名、WebSocket、归档历史、回执、事件流、nonce管理或FireFly全流程。
- gasPrice是建议值，不是实际支出；缺失baseFee或费用查询失败保留null而非0。不推导本链完整费用/经济/法律政策。
- 各检查即使通过，也不构成生产接入全部验收条件。

## 验证与交接

运行 `npm run build`（实际vue-tsc -b && vite build）及 `npm test`。

Node.js 24+手动真链只读：

```bash
node scripts/smoke-integration-readonly.mjs
```

可加 `--save-fixture <路径>` 保存原始响应。默认自动测试离线回放现场fixture，不在CI循环查询公共节点。

没有新增npm依赖，没有修改部署合约，不含链上交易，不改变共识或公共RPC配置。
