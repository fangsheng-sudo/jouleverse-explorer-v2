# PR #3 融合审计与交付说明

日期：2026-11-11。仅处理开发者只读接入套件，不涉及 PR #4–#9。

## 输入与基线

- 链接提交版：`submit/jouleverse-developer-kit`，审计固定到 `93b5057c19a79637fd1a9aab41fa7aec2acd6697`。
- 本地补全版：`816afca`，保留在 `review/jouleverse-developer-kit-clean`。
- 融合版：`review/jouleverse-developer-kit-fused`，基于最新官方 explorer-v2 `90b032e5fc558863885a6b6bb45e2f095bacd2ed`。
- 相对旧基线，官方新增的 Logo 修复原样保留；融合代码没有重新改动 App.vue。两版原分支、原 PR 和全部历史均未改写。
- 本次仅本地开发和提交，无远端 push、官方仓库写入、新建 PR、合并或环境发布。

## 链接版审计发现

下列三个问题用隔离目录中的回归用例实际复现：原有两组测试共 9 项通过，但新增 3 个回归用例均失败。运行使用本云环境已安装的工具链；不是链接分支原锁文件的独立安装验收。

| 编号 | 程度 | 触发与结果 | 融合处理 |
| --- | --- | --- | --- |
| A1 | 中：错误/隐私边界 | 适配器抛出带内部细节的 Error，checkReadiness/observeTransaction 原样拒绝；调用方若记录异常会把节点、请求或凭据细节带入日志 | 保留本地版 IntegrationError 稳定编号与错误脱敏，不复制原始 cause/请求 |
| A2 | 低：快照一致性 | 创建套件后修改共享 toolboxContracts；下一次 listContracts 仍随之变化。冻结单个输出对象不等于创建时隔离快照 | 创建时克隆目录，并吸收链接版的冻结条目/核验报告；目录数组也冻结 |
| A3 | 中：异步策略一致性 | 调用 verifyNetworkIdentity 后、getChainId 返回前改写 expected.genesisHash；进行中的检查改用新值 | 在第一次 await 前复制 chainId/genesisHash；回归用例验证不受调用方变更影响 |

另外两项是集成缺口：

- 创世 helper 只存在于独立模块，没有被 createJouleverseKit 的部署/读取流程调用；不能仅因 helper 存在就声称套件已经绑定创世身份。
- 套件未提供整体超时/并发控制或受限通用合约读取。可信适配器仍可能挂起，缺少通用读接口也增加接入方自行绕过安全边界的机会。这些是功能和健壮性缺口，不代表链接版已经实施了恶意写链行为。

## 优势互补与取舍

| 能力 | 来源与最终处理 |
| --- | --- |
| 独立链 ID＋创世校验 | 吸收链接版的 NetworkIdentityReader、明确状态及“不臆造创世哈希”的信任原则；补上策略快照、取消和非法观测处理 |
| 不可变输出 | 吸收链接版的 frozen contract/report，与本地版创建时目录隔离结合；只读 ABI 返回独立副本 |
| 实际前置检查 | 新增 options.expectedGenesisHash、kit.verifyNetworkIdentity 和 identityPolicy，接入 verifyContract/readContract，失败提前停止 |
| 合约读取 | 保留本地版 view/pure 白名单、ABI 参数预校验、代码必须 match、按固定高度读取、禁用默认 CCIP Read |
| 超时与节点预算 | 保留本地版整体截止时间、最多两个未完成底层操作、超时后停止后续请求；创世检查复用同次操作的链 ID，避免重复 RPC |
| 错误与隐私 | 保留本地版错误脱敏及匿名提交；业务适配器输出不擅自改写，但不因此保证其安全 |
| 工程验证 | 保留本地版真实 HTTP JSON-RPC/ABI 集成测试、依赖修复与开发依赖兼容性测试，并加入创世前置/早停/取消回归 |

**未提供受信创世值时不冒充验证成功。** 默认策略仍为主线原有 checkpoint-only（链 ID＋固定区块锚＋运行时代码摘要），显式身份接口返回 unconfigured。配置来自独立受信链规范的 genesisHash 后才启用 genesis-and-checkpoint；不能从同一待检测节点读取后自动认可。本次没有独立受信的官方创世规范输入，因此没有宣称完成真实主网的创世绑定验收。

启用创世策略后，显式身份检查最多 2 次请求、部署核验最多 5 次、受限合约读取最多 6 次；默认未启用时部署/读取仍分别最多 4/5 次。独立 helper 本身要求 reader 设置超时；通过 kit 调用才有统一截止时间和并发限制。诊断/回执适配器仍负责自己的网络绑定，不能因为 capability 被配置就自动视为可信。

## 验证与交付

- 原链接版：原有 9 项定向测试通过；3 个新增问题复现用例失败，符合上述发现。未声称其完整构建或原依赖锁已通过审计。
- 融合版：`npm test`：24 个 Vitest 文件、308 个用例通过，随后 Node test 3 个用例通过；`npm run build`（含应用及测试类型检查）、`node scripts/check-feature-roadmap.ts` 均通过。
- HTTP 集成覆盖：默认端点、固定高度、代码摘要、成功读调用、错误链早停、错误创世两次请求后停止、显式创世身份、超时后不再查区块。
- `npm audit`：critical/high/moderate/low 均为 0；融合步骤没有新增依赖或改动本地版安全覆盖。
- 检查实际代码差异、空白问题和新增内容隐私；新增提交只使用匿名工具身份。历史中已有作者元数据原样保留，不复制为新增提交署名。

第一阶段旧自审记录 developer-integration-kit-review.md 保留为 2026-11-09 的历史证据；本记录及新版 developer-integration-kit.md 说明融合后目录不可变与可选创世策略的变化，不能把旧测试计数当作本次结果。
