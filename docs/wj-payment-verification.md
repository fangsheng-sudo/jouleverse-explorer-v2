# WJ（封装焦耳代币）付款结果核验 V1

从应用信任的回执适配器取得观测报告，再比对订单明确约定的交易、付款地址、收款地址、金额和确认门槛。核验模块本身不联网，不写状态，也不发送交易。

```ts
import { verifyWjPayment } from './src/integration/wj-payment-verifier'

// 已把原有回执核验函数接入第 3 项套件时：
const { report, cached } = await kit.observeTransaction(order.transactionHash)
const result = verifyWjPayment(report, {
  transactionHash: order.transactionHash,
  payer: order.payer,
  recipient: order.recipient,
  amountAtomic: order.amountAtomic,
  minConfirmations: order.minConfirmations,
}, { nowMs: Date.now(), maxAgeMs: 60_000 })
// 保留 cached（是否为缓存）及观测时间；结算前重新取得新鲜观测。
```

- 地址和网络使用已有焦耳宇宙链配置与 WJ 合约目录。付款双方以 Transfer（转账）日志为准，顶层交易发送者可以是其他地址。
- 金额为最小单位的十进制整数文本，要求一条转账日志精确匹配；不累计多笔、不把多付自动记为符合订单。零地址铸币、销毁、自转和零金额不算付款。
- 多条完全相同的候选日志返回「有歧义」；调用者可依据独立订单证据提供日志编号。不能随意选一条重复记账。
- 确认数含交易所在区块，门槛由接入方按订单风险设定；达到门槛只是观测时点的匹配，不保证不可逆。区块重组或节点数据变化后应重新核验。
- 证据键为「网络编号:交易哈希:日志编号」。业务端须在数据库内以此原子去重、绑定订单并记录区块哈希。本模块不保存状态，也不能证明同一日志尚未用于其他订单。
- 仅接受可信适配器直接返回的报告；导入的结构化文本不能自行证明付款。事件匹配不证明收款人仍持有资产，不证明线下履约，也不触发自动发货或结算。
- 第 3 项接入入口与现有回执服务仍需部署时接线；本次用可复现的回执观测样例验收，未广播交易。

## 新鲜度与异常输入

第三个参数为必需的可信时钟策略 `{ nowMs, maxAgeMs }`，由应用在核验时传入，模块不自行读取时钟。过期观察返回 stale-observation，未来/非法时间、缺失或异常结构返回 invalid-observation；回执时间仍由可信适配器负责，时间戳不是真实性签名。日志最多 512 条和 1 MiB 数据，与既有回执核心预算一致。历史样例必须显式使用样例时间，不能把旧样例当作实时付款。

错误条件抛固定配置错误；观察异常不抛出原始节点信息。主网终局性、重组后的冲销、订单绑定和数据库原子唯一约束仍属于业务层责任。模块的 matched 仅表示当前可信观察匹配，不自动结算。
