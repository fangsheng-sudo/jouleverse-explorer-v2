# 开发者只读接入套件：第一阶段自审记录

日期：2026-11-09。范围仅为原 PR #3 的有效代码移植和补全；不代表七项设施的最终验收。

## 基线与历史

- 最新远端 explorer-v2 基线：`bbb071b700df4bbb1fc5efd03a7d46ad6b94e18e`。
- 本地独立分支：`review/jouleverse-developer-kit-clean`，从上述基线创建。
- 原 PR #3 代码来源：`a70e60d99931be6932ec474fb3d003f1836fb8af`。仅提取其套件模块、测试、文档，未重放旧部署核验代码或旧提交的身份元数据。
- 主线已有固定区块锚定的部署核验，移植代码复用该实现。PR #3–#9 的原引用保留于本地 origin/pr-3 至 origin/pr-9；未改写、关闭或合并原 PR，未重写历史。
- 未向任何远端 push，未修改官方上游，未创建正式上游 PR，未合并 PR，未发布环境。

## 补全与复核

- 网络身份包括 chainId、公开端点、原生币信息、Multicall3 和固定区块锚；套件对象冻结，目录/ABI 使用副本。
- 只读函数按已登记 ABI 白名单校验；拒绝写方法、未知方法、重载歧义和非法参数，失败时不联网。
- 读取必须先通过链 ID、基线区块和运行时代码摘要核验。仅 match 允许 eth_call，使用与 getCode 相同区块号；过旧高度和异常结果不会得到匹配结论。
- 自定义部署及读取适配器必须成对使用，不静默混用默认节点。适配器本身仍属于可信代码。
- 错误消息脱敏，稳定错误编号；整体超时、取消信号和两个底层操作的并发上限。超时后阻止后续请求，忽略取消的适配器继续占用槽位。
- 默认关闭 RPC 自动重试和 CCIP Read，避免合约读取隐式请求第三方 URL；无钱包、写链、日志持久化、遥测或全链扫描。
- 文档明确代码观察基线、代理、重组、RPC 可信度和付款核验的限制，不把代码匹配或回执执行成功当作付款/结算证明。

实际自审中修正：旧 PR 测试缺少基线区块接口；viem 将空代码规范化为 undefined；自定义核验/读取适配器单边注入导致的端点混用；测试的 bigint 字面量类型推断。修正后重跑相应检查。

## 验证证据

- `npm ci`：按增量更新后的锁文件安装成功，TLS 和 artifact integrity 校验开启。
- `npm test`：23 个 Vitest 文件，共 290 个测试通过；随后 Node test 的 3 个测试通过。套件自身包括 23 个单元测试、5 个 HTTP/JSON-RPC 集成测试，另有 2 个测试依赖兼容性用例；没有依赖外网或钱包的自动化测试。
- `npm run build`：vue-tsc project references 类型检查（应用和测试）与 Vite 生产构建通过。未用空项目的裸 vue-tsc --noEmit 代替。
- `node scripts/check-feature-roadmap.ts`：22 个视图、35 个模块，0 漏项；本改动没有新增视图。
- 默认 transport 的离线集成测试验证仅使用配置中的 RPC、5 次请求上限、代码核验与 ABI 解码；注入 transport 测试另外验证错误网络早停、摘要变化拒绝和空代码状态。
- 公共主网实测：链 ID `0xe52`；固定基线区块哈希符合主线配置；WJ 当前代码摘要为 `0xd47bc13f940046cf192da0775023564547e32cdece98640d54a410969ecf1e89`。默认套件在高度 `8613936` 成功完成 totalSupply 只读调用。没有发送交易。
- 生产构建经浏览器验证：工具集与合约目录页面成功渲染，0 pageerror。构建有现有钱包/React 依赖的 module-level directive 提示，以及 ox 可选 worker_threads 浏览器外置提示；未屏蔽警告。此阶段未验收钱包签名或新链功能。
- WJ runtime fixture 只含公开合约字节码，集成测试独立计算其摘要并与主线观察基线核对。

## 依赖安全与剩余项

没有新增直接依赖，现有 dependencies/devDependencies 的版本范围保持不变。为处理审计发现，增量刷新 package-lock.json，并从官方 npm 源重装。包含 Vue、Vite、viem、ethers 等现有依赖的兼容范围更新，不使用 audit fix --force。锁文件保留跨平台可选原生依赖；44 个 binding/oxide/lightningcss 平台记录，所有 registry artifacts 都有 integrity 字段。

更新前 npm audit：49 项（37 high、12 moderate）。兼容范围刷新后剩 5 项开发依赖 moderate。随后仅在 @vue/test-utils → js-beautify 链中，显式覆盖 glob 为 14.0.4、editorconfig 的 minimatch 为 11.0.5，处理以下根因：

- [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)：glob 取消后可能继续遍历。
- [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)：minimatch 的复杂 glob 输入可放大资源消耗。

这两个覆盖跨上游声明的主版本边界，因此增加真实 HTML 格式化、EditorConfig 解析及文件 glob 匹配兼容性测试，并重跑完整测试、类型检查和构建。未覆盖生产依赖、关闭检查或回退测试工具。后续升级 @vue/test-utils/js-beautify/editorconfig 时应复查并在上游范围包含修复版后移除此覆盖。

最终 `npm audit` 与 `npm audit --omit=dev` 均为 0（包括 critical/high/moderate/low），命令成功。审计只是当前 npm 公告数据库的检查，不能证明不存在未知漏洞。上述检查及隐私复核完成后，本阶段 PR #3 自审通过；按“第一阶段只处理 PR #3”的范围，没有移植 PR #4–#9。

## 隐私与提交边界

对新增/变更内容检查邮箱、手机号、私钥/助记词、凭据、用户署名和个人标识。无新增用户身份信息、账户凭据或钱包数据；公开合约地址属于基础网络配置。原历史中已有署名必须随历史保留，不复制到新增提交元数据或提交说明。新增本地提交使用匿名工具身份；未推送到 GitHub。
