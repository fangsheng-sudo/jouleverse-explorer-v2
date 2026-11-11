# 独立复核记录

审查日期：2026-11-11（UTC）。仅阅读仓库；未切换 checkout、修改仓库文件、提交、推送或操作 GitHub。仅按主代理授权写入本临时审查记录。

## 最终结论

本轮发现并独立复现 1 个 P2：PR7 并行余额读取一项失败、另一项挂起时提前释放并发槽位。已在 `6e78cc509862976b95dae69ecdbe18dac32a2df0` 修复，并完成独立重测；最终 PR7 tip `eeeb314e676d00bd9e90932591784c222452ca09` 仅补充同一回归用例的晚到请求与槽位恢复断言，生产代码完全相同，测试追加经阅读确认合适。该发现关闭。其余所列模块未发现新的阻塞性代码问题。此结论不表示公网生产验证完成，也不消除 PR 元数据和 #78 的依赖事项。

## 审查范围及基线

阅读 AGENTS.md；检查以下固定源码及相应测试、文档：

| PR | 固定审查提交 | 主要模块 |
| --- | --- | --- |
| 4 | 841832842007e5c7fa02c6cd0125cc8966efd2a0 | wj-payment-verifier.ts |
| 5 | afe0011e1d833baf7e7a3041665886c907bbc171 | 本地只读 RPC fixture 与 HTTP 测试 |
| 6 | d4335cd0654389b3437861352bdd2a3bdeeb58cc | delivery-inbox.ts、indexeddb-inbox.ts |
| 7 | eeeb314e676d00bd9e90932591784c222452ca09 | gas-replenishment.ts（包括本次 P2 修复） |
| 8 | 40b28fe558743042e7de4c7f006868a813afe64a | agent-authorization.ts、agent-read-gateway.ts |
| 9 | 8b5f40e781749b8e49b652298dbf976f587114fa | service-quality.ts、bound-service-quality.ts |

直接用 git 核验：4、6、7、8、9 的 merge-base 为官方 `90b032e5fc558863885a6b6bb45e2f095bacd2ed`；5 的 merge-base 为实际官方 PR #78 提交 `784ca2d44e0d21bdc8d85d21e68175d09f2df3ef`，其后仅两个 harness 提交。最初六个 signoff 源码树均等于对应 complete 源码树；PR7 此后另加本次缺陷修复。所有新增提交 author/committer 均为用户授权的 `fangsheng-sudo <fangsheng-sudo@users.noreply.github.com>`。文件差异未混入其他功能或依赖变更。

## 已关闭 P2：提前释放 RPC 槽位

旧代码：`src/integration/gas-replenishment.ts:99` 的 `Promise.all`，配合原第 110 行 task.finally 释放 pending。

触发：目标余额不足；sponsor getBalance 永不 settle；readContract 立即 reject。旧 Promise.all 提前 reject，任务 finally 立即释放 pending，但第一个 RPC 仍在途。连续 5 次预检全部 unavailable，并积累 5 个挂起 sponsor 读取；第三次起未按约定 busy。违反每 reader 有界任务约束，重复错误可无限累积后台 RPC。

修复：两项读取使用 Promise.allSettled，均 fulfilled 才检查金额；任意 rejected 返回 unavailable；两个底层请求结束前保留任务槽位。总截止时间仍可提前向调用者返回 unavailable。文档准确区分两个预检任务与最多四个并行余额 RPC。新增测试覆盖一项快速失败、一项挂起，并在最终 eeeb314e 追加挂起项晚到结束后没有额外 RPC、正常新任务可恢复的断言。本人 git diff 确认最终 tip 仅改变该测试，无生产代码差异；该提交 author/committer 正确。

独立重测直接从固定 Git 提交读取 TypeScript，用已安装 TypeScript 转为 CommonJS 后在 VM 执行。保留真实 viem 地址处理；仅把 chain/contract 配置替换为固定测试值，因此检查的是并发控制逻辑，不是实际节点或 ABI 集成。

修前输出（旧 d9133e2 源码）：

- attempt 1..5：均 unavailable。
- 未完成 sponsor 读取数：1、2、3、4、5。

修后输出（固定 6e78cc5 源码）：

- native 挂起 / wrapped 失败：连续五次 unavailable、unavailable、busy、busy、busy；挂起请求共 2 个。
- native 失败 / wrapped 挂起：同样 unavailable、unavailable、busy、busy、busy；挂起请求共 2 个。
- 两个方向均在晚到请求 settle 后确认无额外 RPC 自动发出；随后新的正常预检返回 review-required，证明槽位能够恢复。
- 两个方向全部断言通过，执行退出码 0。

## 验证边界与待办

本人完成源码审查、Git 基线/源码树/署名核验、上述独立缺陷复现及修后对称/恢复测试。本人没有重新运行六分支全量 npm test/build/roadmap，也没有独立启动浏览器重做 IndexedDB 测试。读取到主代理已有验证 JSON：PR4 275、PR5 314、PR6 268、PR7 修后 278、PR8 271、PR9 270 个 Vitest 用例，各 Node 测试 3 个，记录的 test/build/roadmap 均 exit 0；这是既有验证证据，不是本人的独立全量执行结果。

主代理提供的远端状态：PR #78 仍 OPEN，因此 PR5 仍是叠加依赖，不能称为已基于合并主线完全独立；六个个人 PR 的 GitHub base 元数据仍需调整（4、6–9 指向 explorer-v2；5 暂指向 submit/jouleverse-developer-kit-final）。API Forbidden 与共享浏览器缺少平台 BROWSER_CONFIG_AUTH_TOKEN 导致元数据编辑受阻。本人未再次查询远端或尝试编辑，不将本地正确祖先关系等同于 GitHub PR base 已修改。

依赖未修改；已知基线 audit 18 项（10 high、8 moderate）不能描述为零漏洞。本轮未独立重跑 audit。
