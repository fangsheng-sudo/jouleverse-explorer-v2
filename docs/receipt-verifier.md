# 链上交易核验与记录导出工具：接入规范 v1

状态：本分支实现，待维护者审核合入；未声称已部署。

## 正式称谓与对外介绍

- 正式名称：**链上交易核验与记录导出工具**。
- 页面及入口简称：**交易核验与导出**。
- 核心模块：**交易与回执一致性核验模块**。
- 导出文件称谓：**链上交易观察记录**。

配套介绍：

> 核对链上交易记录的一致性，导出可供人工、业务系统和智能体复用的查询结果。

不得宣传为独立“交易证明”“可信凭证”或“支付验证器”；目前依赖单一节点查询，不独立验证链上包含性，也不核对具体付款或商业履约。

## 问题与范围

已有 TransactionDetail.vue 解决人工浏览交易，但没有面向业务系统的版本化观察记录。玄联及其他生态接入时，需要知道：是否查到了正确网络、交易与回执是否对应、该高度的规范区块是否一致、顶层执行状态是什么、观察发生在何时。

本功能提供 `/tools/receipt` 只读页面和不依赖 Vue/钱包的核验核心。复用既有 viem，不新增 npm 依赖，不修改共识或已部署合约。不是新的区块浏览器、支付网关、轻客户端或订单履约系统。

## 请求预算与失败策略

用户点击才查询；无效哈希/初次打开页面均0请求。最多5个逻辑请求，适配器关闭自动重试；同时最多2个。没有日志范围查询、区块遍历、自动轮询。

| 阶段 | 请求 | 数量 |
|---|---|---:|
| 网络门禁 | eth_chainId | 1 |
| 交易及回执 | eth_getTransactionByHash + eth_getTransactionReceipt | 2 |
| 已打包时 | eth_getBlockByNumber(回执区块,false) + eth_blockNumber | 2 |

错网1请求后停止；交易与回执均null返回not-found；交易未打包且回执null返回pending，以上3请求；已打包最多5请求。每个请求超时10秒，适配器不重试。页面加载期间禁用输入与重复操作。

同一模块实例只允许1个不同哈希的任务，同哈希并发合并。只缓存最近1个成功读取结果30秒（包括not-found/pending观察状态）；失败不缓存。命中缓存不读取最新高度，显示原观察时间；这不是实时订阅。缓存仅内存，重载清除。返回克隆避免调用者修改缓存。

网络错误不是“未找到”；数据矛盾/疑似重组不生成结果，不下载半份记录。输入改变清除旧结果；组件卸载后忽略未完成结果。

## 校验项

- 哈希为32字节；链编号先核对配置3666。
- 交易哈希与请求一致；若交易携带chainId也需一致。
- 交易和回执的区块号、区块哈希、交易编号、发送方、目标地址一致。
- 回执status只接受0或1；未知状态不当成功。
- 读取该高度的规范链区块，核对hash与number；按transactionIndex核对区块交易哈希；head不得早于回执区块。
- 每条回执日志核对交易/区块/编号归属，removed必须false；编号不可重复；主题至多4个。执行失败不应含事件日志。
- gasUsed不得大于交易gas；手续费使用实际价格，旧式/访问列表交易允许缺effectiveGasPrice时回退gasPrice；1559缺实际价格则未知。
- 大整数全程bigint计算，导出十进制字符串。未知费用保留null，不伪造0。
- 调用数据最多256KiB；日志最多512条、日志data合计最多1MiB；超过上限明确拒绝，不静默截断。网络响应整体大小仍依赖浏览器/传输层，并非流式抗恶意节点网关。

## 导出协议

`schema = jouleverse.transaction-observation/v1`。

外层 `{ integrity, report }`：

- integrity.algorithm：keccak256。
- integrity.scope：UTF-8 JSON.stringify(report)。
- integrity.digest：报告对象按文件解析顺序JSON.stringify后计算的摘要；与以太坊常用哈希一致，不是SHA3-256。
- report.source：RPC地址、预期/观察链编号、ISO8601 UTC观察时间（来自运行环境本地时钟，不是链上时间认证）。
- report.state：not-found / pending / success / reverted。
- report.transaction：from/to/nonce/valueWei/input；未找到时null。
- report.inclusion：区块号/哈希、交易序号、观察时head、确认数、区块秒时间；未打包时null。
- report.execution：status/gasUsed/gasPriceWei/feeWei/contractAddress；未打包时null。
- report.logs：回执内日志address/topics/data/logIndex；没有请求eth_getLogs。
- report.limitations：随导出附带信任边界，消费方不得忽略。

摘要是完整性比对工具，任何人都可重算，既非签名、认证，也非区块包含性证明。v1不提供离线导入“验真”，不声称符合RFC8785规范化。其他语言消费方如果无法重现JSON顺序与转义，应直接重新查询同链同交易，并核对关键字段，不凭摘要认定真实性。

## 复用方法

浏览器接入使用 `services/jouleverse-receipt.ts` 的 `verifyJouleverseReceipt(hash)`；返回 `{report,cached}`。服务层 `verifyReceipt(read,hash,options)` 与 `createReceiptVerifier(...)` 可由其他前端或智能体运行环境复用，read只须支持5个只读方法，所有输入为unknown后逐项校验。

Node.js 24+ 真链只读验收（不作为CI自动联网测试）：

```bash
node scripts/smoke-receipt-readonly.mjs <交易哈希>
```

可显式加 `--save-fixture <文件路径>` 留存现场RPC响应。不要对公共节点做批量交易扫描；测试默认使用已留存fixture离线回放。

## 对玄联的意义与后续边界

它给业务事件提供统一“链上观察记录”，可用于把订单/授权记录与交易哈希关联、人工复核及对账。当前不会自动认定一笔交易属于某订单；业务系统仍须校对链、目标合约、方法、订单标识、币种、金额与双方授权。

后续可以在本模块之上按明确业务契约增加WJ支付事件解释器、重复记账防护、回调队列或多RPC交叉读取；先由真实接入方提出验收样本。不能把本工具直接用于自动放货/结算，也不能把success等同于Gnosis内部ExecutionSuccess或ERC20转账成功。

Clique确认数包含所在区块，不是经济/共识最终性承诺。单RPC观察可能落后、被误配或被恶意伪造；本模块只检查其内部一致性，未验证交易签名、区块seal、receipt trie或后续重组。真正的无需信任验证另需共识/包含性验证机制。
