# #4–#9 补全开发与组合验收报告

日期：2026-11-11。结论：六项功能补全和本地功能验收完成，个人仓库分支署名已修正；PR base 元数据仍有待处理项，不代表生产部署、链上资金操作或官方上游合并。

本报告只放在组合验收分支，六个功能 PR 不包含此自审记录、依赖治理、README 或锁文件变更。

## 基线、依赖与保留

官方 explorer-v2 基线为 `90b032e5fc558863885a6b6bb45e2f095bacd2ed`。#4/#6/#7/#8/#9 独立于 #3 合并；#5 基于已经验证的 #3 精简提交 `b2d1118`，只依赖其代码存在，不要求已合并。署名修订时已改接实际 #78 提交 `784ca2d`；#78 仍为 OPEN，不能声称 #5 已完成相对合并后主线的清理。审阅 #5 的本项增量时可相对 #3 精简分支比较。

原 #3 分支没有修改。六个旧版本均在远端 `backup/prN-before-completion-20261111-旧SHA前7位` 保留；更新使用带旧 SHA 校验的 force-with-lease，并和备份创建一起原子推送。推送后逐个核对了原分支、备份和 refs/pull/N/head，六个原 PR 的 head 均已指向新成果。没有新建或合并正式上游 PR，没有修改官方上游或主线，没有重写既有备份。

按用户最新明确授权，本次新增提交 author/committer 统一为公开 GitHub 身份 `fangsheng-sudo <fangsheng-sudo@users.noreply.github.com>`，不使用真实邮箱。此前匿名提交保留在 before-signoff 备份；官方历史署名不重写。

## 独立分支验收

| 功能 | 原 PR 分支（已更新） | 提交 | Vitest + Node test | 类型/生产构建/路线图 |
| --- | --- | --- | --- | --- |
| #4 WJ 付款核验 | `feat/wj-payment-verification` | `8418328` | 275 + 3 | 通过 |
| #5 本地只读联调环境 | `test/local-readonly-integration-environment` | `afe0011` | 314 + 3 | 通过 |
| #6 可靠交付收件箱 | `feat/reliable-delivery-inbox` | `d4335cd` | 268 + 3 | 通过 |
| #7 手续费补给预检 | `feat/gas-replenishment-preflight` | `eeeb314` | 278 + 3 | 通过 |
| #8 智能体授权与只读网关 | `feat/agent-authorization` | `40b28fe` | 271 + 3 | 通过 |
| #9 服务质量与恢复评估 | `feat/service-quality-evaluation` | `8b5f40e` | 270 + 3 | 通过 |

计数包括各自基线的完整测试，并非新增测试数。未跳过、删除断言或放宽测试时限。六个独立分支的功能源码已与组合验收版本逐文件核对一致。

## 实际补全内容

- **#4**：显式可信时钟/最大观察年龄策略；陈旧/未来/非法日期、未知结构和非法状态拒绝；精确 uint256/Transfer 匹配、日志预算及重复日志歧义；通过实际回执核心验证规范区块变化时拒绝付款证据。
- **#5**：支持当前固定基线区块接口、成功合约读取、回执及余额白名单；真实 HTTP/JSON-RPC/ABI 联调；请求字节、记录数、连接与响应时间预算，异步响应及挂起/异常处理，幂等关闭；不代理真实节点、不接受写方法。
- **#6**：持久提交后确认、UTF-8 正文身份校验、绑定来源、超时和存储并发限制；原生 IndexedDB 原子去重、待处理恢复和处理标记；SQLite 的丢确认/重开/并发/冲突测试，以及真实 Chromium/IndexedDB 的 9 项浏览器检查。
- **#7**：政策快照、uint256 边界、固定高度余额检查、整体截止/取消、底层并发限制、整数安全序列化；只提供人工复核结果，不估算真实费用或执行补给。
- **#8**：畸形输入及授权快照 fail-closed；网关在 handler 前重新加载当前授权并核验主体、资源、撤销、有效期；冻结规范化请求与绑定摘要；错误脱敏、超时、并发限制；review-only 绝不调用执行接口。
- **#9**：采集 JSON 异常边界、服务/地点/策略隔离、不可变机器报告；沿用精确可用率上下界和最近秩 p95；只对相邻、同策略且从异常后连续健康的窗口判恢复，缺报/跳窗/导入的裸状态不能解除告警。

## 组合联调与复现

组合验收分支：`submit/ecosystem-3-9-integration`。它包含 #3 精简版和全部六项成果，另含 `tests/ecosystem-cross-module.spec.ts`；不作为范围精简的单项 PR。

两条组合路径通过真实本地 HTTP：

1. #8 授权 → #3 回执入口与生产回执核心 → #4 新鲜 WJ 付款匹配 → #6 收件/重投去重 → #9 质量记录。
2. #7 手续费预检 → #5 本地余额/合约只读 RPC，确认固定高度、最多五个逻辑调用，不释放资金。

组合完整结果：32 个 Vitest 文件、378 个测试通过；Node test 3 个通过；应用及测试项目类型检查、Vite 生产构建、22 视图/35 模块路线图检查通过。

```sh
npm ci
npx --no-install vitest run --maxWorkers=2
node --test tests/jvaddress.test.ts
npm run build
node scripts/check-feature-roadmap.ts
```

云环境安装使用官方 registry 运行时覆盖镜像主机，保持 lockfile 与 integrity 校验，没有改锁文件或关闭 TLS。原 #4 追加回归的默认 worker 全量测试曾发生既有路线图 CLI 测试 5 秒超时；停止本任务的开发服务器并限制为两个 worker 后，使用相同断言/时限完整通过。上述命令记录了最终可靠复现方式，不把首次失败隐藏为通过。

#6 浏览器验证可在启动开发服务器后打开 `tests/fixtures/delivery-inbox-browser.html` 复现；该页面不进入生产入口。组合去重测试只验证模块接线契约，持久化可靠性另由 SQLite 和真实 IndexedDB 测试证明，不能把内存测试适配器用于生产。

## 安全、依赖与未验收范围

- 本次没有新增 npm 依赖，也未修改 dependencies、lockfile、registry 配置或 overrides。原锁文件当前 npm audit 仍为 **18 项：10 high、8 moderate、0 critical**，审计命令退出 1；属于已知基础依赖待治理事项，不声称零告警。
- 只读模块、测试节点、授权网关均未提供签名/发送交易/资金释放接口；所有集成测试使用本地固定样例，没有部署主网或广播交易。
- 网络、创世规范、RPC 诚实性、最终确认/重组冲销、真实订单绑定和服务端认证仍是外部信任边界。浏览器授权检查不能替代服务端控制，review-only 不是签名许可，付款 matched 不是自动结算。
- IndexedDB 有浏览器清理/配额风险，不能保证服务端灾备或外部业务 exactly-once；上线应独立设计持久化、幂等、来源认证和业务事务。
- 质量身份标签不认证采集者；此处未运行公网持续探针或宣称整条链服务质量达标。
- 构建保留既有动态导入与大分包提示，没有屏蔽警告。
- GitHub 远端分支和 PR head 已核实；GitHub Checks API 读取被当前访问策略返回 Forbidden，因此**未独立确认 GitHub CI 结论**，不以本地门禁替代平台检查。

原分支已按授权更新，后续是否正式提交上游、接受依赖风险或上线应由维护者审阅确认。本次未执行任何合并。

## 署名修订与另一模型独立复审

本次使用 GPT-6 Astra 对六个固定 signoff refs 作独立审查；它实际复现了 PR7 的并行 RPC 提前释放任务槽位问题：一个余额读取失败、另一个永久挂起时，原 Promise.all 会使任务提前结束，重试可累积未完成请求。

修复改用 Promise.allSettled，两个子读取结束前保留预检任务槽位；外层超时仍及时返回 unavailable。回归覆盖超时后的第三次 busy、晚到请求不补发 RPC、实际结束后恢复准入。限制准确表述为每 reader 两个预检任务、最多四个并发余额 RPC。独立模型另测了对称失败方向及晚到恢复，确认原 P2 已关闭；它没有声称独立重跑完整测试或浏览器检查。组合完整测试及构建由主执行流程运行。

签署修订对 #4/#5/#6/#8/#9 的源码树没有改变；#7 只有上述修复、回归和对应文档变化。#5 的代码树与原 c8bdff6 相同，祖先换为实际 #78，保留两个本项 harness 提交；#78 合并后仍须重新以实际合并主线为基线。

### PR base 元数据仍待网页操作

实际 GitHub PR 元数据保留旧串行 base，不只是 #4：

| 个人 PR | 当前 base | 应调整为 |
| --- | --- | --- |
| #4 | feat/jouleverse-developer-kit | explorer-v2 |
| #5 | feat/wj-payment-verification | submit/jouleverse-developer-kit-final（暂时叠在 #78）；#78 合并后重建到 explorer-v2 |
| #6 | test/local-readonly-integration-environment | explorer-v2 |
| #7 | feat/reliable-delivery-inbox | explorer-v2 |
| #8 | feat/gas-replenishment-preflight | explorer-v2 |
| #9 | feat/agent-authorization | explorer-v2 |

个人 explorer-v2 已快进同步官方 90b032e，不改写官方仓库。当前环境 GitHub API 返回 Forbidden；共享浏览器无法启动（缺平台运行时凭据），所以本次不能自动编辑 PR base。Git 推送成功不等于 PR base 已改好，也不代表 mergeable 或 GitHub CI 已确认。上述网页操作、#78 合并后的 #5 重建及既有依赖告警处理仍为待办，不能宣称六个 PR 已可直接合并。

独立模型的固定提交、旧缺陷复现、对称修后测试和未执行验证范围见 [独立复核记录](ecosystem-independent-review.md)。
