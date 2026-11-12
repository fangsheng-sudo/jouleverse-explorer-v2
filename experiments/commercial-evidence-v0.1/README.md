# Jouleverse 可信商业事件接入与证据核验试点 V0.1

独立 Node.js/TypeScript 库，不改 Explorer 页面和部署。面向玄联及其他商业应用，提供隐私处理后的证据协议、EVM日志核验、有界增量索引、可信快照恢复与本地联调。未部署商业锚定合约，未签名、广播或转账。

## 运行

Node.js >=22.13：

```sh
npm ci
npm test
npm run typecheck
npm run demo
```

build 输出 dist 中的 JS 和类型声明。demo 使用模拟RPC，演示 create → correct → revoke 的证据摘要、回执核验、索引与恢复；不访问主网，也不证明真实业务。tests/fixture.mjs 中所有地址、报告和事件都是测试虚构值。

## 入口

- src/protocol.ts：固定字段协议、摘要、严格事件编码。
- src/jouleverse.ts：链编号3666、公开历史检查点和无默认商业合约的配置入口。
- src/verifier.ts：只读事件包含性核验，显式返回 inclusion-only。
- src/indexer.ts：每轮最多8块、最多256条返回日志，保留32个区块检查点，最多2048条事件。
- src/rpc.ts：只读方法白名单、每轮64请求预算、两轮在途上限、全局于session的两请求并发上限、8秒总超时与取消。

底层忽略取消时，槽位保留到真实结束；拒绝启动无限后台任务。HTTP响应上限1MiB，无自动重试、轮询和全链扫描。实际同步/核验过程为顺序请求。索引器重组超出保留窗口时明确失败，须人工选择可信恢复点，不能自动从创世区块重扫。

## 接入边界

先由可信部署清单提供 registry、codeHash、startBlock、applicationId、confirmations；没有生产默认地址或默认代码哈希。createJouleverseProfile 可使用主线已公布历史检查点，生产方仍须确认该信任锚和部署来源。代码哈希不能代替源码审查；本期不支持代理升级语义。

证据正文、产品/批次原始标识和文件保留在玄联通用底座。应用提交私有envelope，由本包生成绑定网络与部署的摘要。示例salt不具备生产隐私性；生产必须用独立安全随机数。协议不接受额外业务字段，并不意味着可以自动识别所有个人信息，调用方仍须做数据分类。

索引结果是最近一次成功同步的RPC观察缓存；sync失败后仍可查询旧结果，不应显示成实时有效状态。query偏移在重组后失效，调用方须根据sync返回的rolledBack重启分页。exportCheckpoint只供授权内部存储，restoreTrustedCheckpoint的结构校验不防整体伪造；外部必须认证来源和完整性。历史窗口外恢复的数据不会逐条重取链验证。

## 文档

- docs/reuse-and-boundaries.md：与现有PR和玄联底座的关系、许可证边界。
- docs/protocol-and-contract-design.md：数据格式、隐私及待审合约方案。
- docs/network-observation.json：本次5请求公共RPC只读观察，不是独立网络认证。
- docs/independent-review.md：更换模型的反例审查及修复复核。
- docs/acceptance.md：最终门禁与未完成事项。

项目 private/UNLICENSED，尚未选择对外开源许可。没有宣称海关合规、签发者认证、真实商品真实性、共识最终性或全链兼容。

## 商业接入推进清单（2026-11-12）

先查看 [17项能力清单](docs/readiness/capability-checklist.md)，再看 [链方确认问题单](docs/readiness/chain-decisions.md) 和 [分阶段验收](docs/readiness/acceptance-gates.md)。最新核查快照见 `docs/readiness/github-status.json`，不能用历史PR状态推断未来部署。

```sh
npm run readiness:check
# 可选：npm run readiness:check -- /path/to/trusted-manifest.json
```

该命令只在本地编译和读取清单，不发RPC，不签名或广播。当前真实草稿缺少可信商业部署资料，预期输出 `blocked` 并以 **2** 退出；无效输入为 **1**，字段完整为 **0**。字段完整仅代表配置可用于准备只读试验，报告仍明确 `networkVerified/deploymentVerified/authorizationVerified/mainnetWriteEnabled=false`。引用URL不会被抓取或认证，不是授权、上线或安全审批证明。

清单文件限64KiB；CLI从同一文件描述符检查普通文件、有界读取并关闭，拒绝FIFO等特殊文件。当前不支持代理合约语义。可信配置仍需真实链核验和人工确认来源。增量复审记录见 `docs/readiness/independent-review.md`。
