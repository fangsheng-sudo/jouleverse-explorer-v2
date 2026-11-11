# 焦耳宇宙链开发者接入套件 V1

面向接入方的只读入口。使用现有网络配置、合约目录和部署核验，不另外维护地址表。当前交付为仓库内可导入的 TypeScript（带类型的脚本）模块，尚未发布独立安装包。

## 最小接入

在仓库中通过现有构建工具导入模块；无需页面、钱包或账户。

```ts
import { createJouleverseKit } from './src/integration/jouleverse-kit'

const kit = createJouleverseKit()
const network = kit.network
const contracts = kit.listContracts() // 创建和读目录都不联网
const observation = await kit.verifyContract('wj') // 显式发起只读核验
console.log(JSON.stringify({ network, contracts, observation }, null, 2))
```

`verifyContract` 只接受目录编号，不接收任意地址。结果带合约、网络编号、区块高度和代码摘要；未获得的字段为 null（空值），高度以十进制字符串表示。错误网络、无代码、没有基线、代码不匹配和节点错误各自有明确状态。代码摘要相同不能证明源码、权限、代理实现或安全性。

## 接入已有诊断与回执核验

当部署分支已有接入诊断和回执核验模块时，直接传入其现有函数。套件不复制两套逻辑，也不改变它们的缓存及错误语义：

```ts
import { createJouleverseKit } from './src/integration/jouleverse-kit'
import { checkJouleverseReadiness } from './src/services/jouleverse-readiness'
import { verifyJouleverseReceipt } from './src/services/jouleverse-receipt'

const kit = createJouleverseKit({
  checkReadiness: checkJouleverseReadiness,
  observeReceipt: verifyJouleverseReceipt,
})
// 只在需要时调用 kit.checkReadiness() 或 kit.observeTransaction(交易哈希)
```

上述两个服务不在本改动中重复提交。若尚未合入，可用 `capabilities` 判断可用功能；调用未配置的适配器会明确报错。交易哈希必须是 32 字节十六进制。应用层仅应传入可信适配器；入口不会审计适配器本身的行为，也不会替其验证回执。

错误编号：`unknown-contract`（未知合约）、`invalid-transaction-hash`（交易哈希无效）、`adapter-unavailable`（未配置适配器）。由既有适配器抛出的错误原样保留。

## 网络身份校验

需要更强网络绑定的接入方，可配合 `src/integration/network-identity.ts` 同时核对链编号与创世区块哈希（fail-closed 五态，见 `docs/network-identity.md`）。该 helper 不内置创世哈希，期望值须由维护者独立确认。

## 边界与保证

- 创建套件与读取合约目录不发起网络请求；网络访问只发生在显式调用核验或适配器方法之后。
- 合约核验只接受目录编号，不接收任意地址；比对运行时代码前先校验网络编号与基线区块哈希，不符即停止。
- 交易回执观察只接受 32 字节交易哈希，并委托给调用方提供的受信适配器；缺失的可选适配器以类型化错误 fail-closed。
- 套件不连接钱包、不签名、不广播交易、不转移资产、不结算订单。

## 下一步：付款核验

回执成功仅表示交易顶层执行成功。付款核验需另行匹配指定网络、代币合约、收款地址、金额与交易日志，并处理确认数和重组。当前套件不判断付款、订单履约或结算，也不提供签名和发送交易能力。
