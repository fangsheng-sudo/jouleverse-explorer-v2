# 商业接入清单与离线门禁独立复审

复审日期：2026-11-12。复审任务指定的配置模型名：`gpt-6-astra`；模型名记录不构成运行服务商证明或链方授权。复审者未参与本轮实现编辑，仅新增本报告。原六个实现文件与既有独立复审不被本报告替代。

范围：`src/deployment-manifest.ts`、draft JSON、离线 CLI、对应测试、readiness 阶段文档及精简 GitHub 状态。本轮不访问真实 RPC、不签名、不广播、不部署；GitHub 状态只核对本地保存记录与文档是否一致，没有再次独立联网认证。

## 结论

离线业务门禁未发现误授权：draft 缺项保持 `blocked`；完整配置也只返回 `configuration-complete`，网络、部署、授权和主网写入四项标志始终为 `false`。没有把 URL 存在、格式正确、PR OPEN 或模拟测试通过描述为真实性、链方授权、生产部署或上线验收。

初审发现的一项中风险 CLI 资源问题 R-01 已修复并独立复验关闭。修复版使用同一描述符核查普通文件，并将读取缓冲与实际读取上限限制为 65537 字节，以识别超过 64 KiB 的输入；特殊文件不进入读取流程。当前范围内没有未关闭发现。未发现本轮高风险问题；本结论不是安全保证，也不是生产就绪证明。

## R-01：CLI 可在特殊文件上无限等待（中风险，已关闭）

位置：`scripts/check-deployment-manifest.mjs` 中 `stat(path)` 后调用 `readFile(path, 'utf8')` 的读取流程。

初审版本仅检查路径当时报告的大小，未限制输入为普通文件，后续全量读取也未设置实际字节上限。无写入者 FIFO 的 `stat.size` 为 0，可以通过预检查，随后 `readFile` 一直等待。设备文件、读取过程中增长的文件或路径替换也说明两次大小检查不能替代有界读取；初审未对无限设备进行实际读取，避免耗尽资源。

实测反例：临时目录创建 FIFO，以该路径运行 CLI；1 秒外部超时发生前无输出且未退出，测试进程被测试驱动安全终止。此问题影响显式传入特殊路径时的本地工具/CI 可用性，不产生主网写入或链方授权。

建议：非阻塞打开后使用同一文件描述符核查普通文件类型；最多读取 65537 字节，以第 65537 字节判定超限；关闭描述符；固定错误码且不回显路径或内容。补充 FIFO、非普通文件、65536/65537 字节边界与追加/替换风险对应的回归验证。

关闭证据（2026-11-12）：修复采用 `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`、同一描述符 `stat()`、普通文件检查、固定 65537 字节缓冲与限长循环、严格 UTF-8 解码和 `finally` 关闭描述符。独立复查确认不再按路径二次打开，且文件增长也不能扩大读取字节上限。下列 Linux 实测均在3秒测试超时以内完成，stdout 不含路径、stderr 为空：

| 修复复验输入 | 结果 |
|---|---|
| 无写入者 FIFO、`/dev/zero`、目录 | 退出 1，`MANIFEST_NOT_REGULAR_FILE`，不读取设备内容 |
| 65535、65536字节合法 draft JSON（尾随空白填充） | 退出 2，`blocked`，大小边界内正常解析但不放行部署 |
| 65537字节文件 | 退出 1，`MANIFEST_SIZE_LIMIT` |
| 指向合法 draft 的符号链接 | 退出 1，固定 `MANIFEST_UNREADABLE_OR_INVALID_JSON` |
| 非法 UTF-8 字节 | 退出 1，固定 `MANIFEST_UNREADABLE_OR_INVALID_JSON` |
| 完整包 `npm test`（含构建与新增两项回归） | 45/45通过，退出 0，无跳过 |

以上特殊文件行为在当前 Linux 环境实测；没有宣称各平台文件系统调用均具备统一的总执行时限。

## 初审验证记录（保留历史）

| 验证 | 独立运行结果 |
|---|---|
| 包内 `npm test`（包含真实 `tsc -p tsconfig.json` 构建） | 43/43 通过，退出 0 |
| 真实 draft | 9项缺失/策略问题，`blocked`；CLI 退出 2；禁止生成试验 profile |
| 伪造完整 mainnet 配置，引用均为 `example.invalid` | 可形成只读 profile，状态仅 `configuration-complete`；四项核验/写入标志均为 `false`，符合限定语义 |
| 65537字节普通文件 | `MANIFEST_SIZE_LIMIT`，退出 1 |
| 含虚构敏感标记的非法 JSON | 固定错误码，退出 1；stdout/stderr 不回显标记或路径 |
| JSON `null` | `INVALID_OBJECT`，退出 1 |
| FIFO 无写入者 | 1秒外部超时，复现 R-01 |
| 零地址/零哈希、非规范高度、未知字段、凭证/query/fragment URL、代理/未知升级策略 | 对应测试拒绝或 blocked |

普通对象接口明确用于可信操作员配置；URL 仅为引用，不进行抓取、真实性认证或来源授权认证。未来如果接入网页、任意 JavaScript 对象或不可信自动上传，应另行评估相应入口；当前测试不宣称覆盖这些新入口。

## 阶段与证据边界

`capability-checklist.md`、`chain-decisions.md`、`acceptance-gates.md` 与保存的 GitHub 状态一致：主线记录为 `90b032e`；#78–#84记录为 OPEN；商业合约没有可信部署清单；G0尚待答复、G1为本地模拟原型、G2未完成商业官方PR路径、G3/G4没有生产闭环证据。没有由 Pages 工作流存在推断本功能已部署，也没有把事件包含性替代当前业务有效性。

链方问题单尚未发送；本复审未联系任何人员。可信部署、授权治理、费用及真实验收仍待有来源的决定与证据；本报告不能替代这些条件。

## 修复复验文件指纹

以下 SHA-256 对应完成45项测试与独立反例复验的当前新增实现、脚本、测试和配置；后续修改这些文件需重新判断本复审是否仍适用。

```text
9ced61816b9d91e116fcae5634818bf21a575a0dbe0f0cfb8bd208607791187a  src/deployment-manifest.ts
d5f5d5e593eab682929ceee85b74510b0a121fe0dfb95031a8af69c63d012fb5  scripts/check-deployment-manifest.mjs
5c1dbe0f4e99a6c14d418fd64a818ad3b998cdfe44531ce4e58b5f3df9b1db1a  tests/deployment-manifest.test.mjs
243cde76d14a2377cc8bb80ec0040d0c6ae46ea2094310fb43bc61b69ca8b020  config/deployment.jouleverse.draft.json
```
