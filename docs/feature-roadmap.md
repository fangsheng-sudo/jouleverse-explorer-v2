# Jouleverse Explorer v2 — 功能路线图

**文档日期**：2026-07-31  
**维护人**：zhangxin / claude / 大白  
**最近更新**：2026-08-11（大白：同步代码实际状态——性能项/代码质量项全部完成，Pages 正式部署已配置）  
**用途**：跟踪 v1 → v2 功能迁移进度 + 新功能规划，作为后续开发的唯一入口文档  

> v2 规划文档（`explorer-v2-mvp-plan.md` / `jouleverse-explorer-refactor-plan.md`，撰写于 2026-03-18）的"V1 功能清单"基于当时的 v1 快照，**遗漏了 v1 在 2026 年 1–3 月新增的功能**（Core ID、JVA/B32 地址）。本文档在此基础上补全，以 v1 当前线上版本（jscan.jnsdao.com）为权威基线。

---

## 一、当前 v2 实现状态总览

| # | 功能模块 | 状态 | 实现位置 | 备注 |
|---|---------|------|---------|------|
| 1 | 区块列表（首页） | ✅ 已完成 | `Home.vue` | |
| 2 | 区块详情页 | ✅ 已完成 | `BlockDetail.vue` | |
| 3 | 交易详情页 | ✅ 已完成 | `TransactionDetail.vue` | |
| 4 | 地址详情页（基础） | ✅ 已完成 | `AddressDetail.vue` | |
| 5 | 搜索框（区块/交易/地址） | ✅ 已完成 | `Home.vue` 内联 | |
| 6 | 网络状态指示 | ✅ 已完成 | `Home.vue` 内联 status-pill | 原独立组件 `src/components/NetworkStatus.vue` 已于 f567f0c（2026-06-28）删除，逻辑并入 Home.vue（L13–16 渲染 / L151 `networkStatus` / L246-255 判定）|
| 7 | Timelock 能量信息 | ✅ 已完成 | `Home.vue` | |
| 8 | 运行时间统计 | ✅ 已完成 | `Home.vue` | |
| 9 | MetaMask 钱包连接 | ✅ 已完成 | `App.vue` + `stores/wallet.ts` | |
| 10 | WJ 操作（转账/提款） | ✅ 已完成 | `WJOperations.vue` | |
| 11 | JNS 域名查询 | ✅ 已完成 | `JNSQuery.vue` | 大白实现（2026-06-19） |
| 12 | Core ID NFT 展示 | ✅ 已完成 | `CoreIdSection.vue` | PR#1（2026-06-18 合入） |
| 13 | 链上签到面板 | ✅ 已完成 | `CoreIdCheckIn.vue` | PR#1，真实链上测试通过 |
| 14 | JVA/B32/HEX 多格式地址 | ✅ 已完成 | `utils/jvaddress.ts` | 大白实现（2026-06-19）；搜索框已集成 |
| 15 | GitHub Pages 自动部署 | ✅ 已完成 | `.github/workflows/deploy-pages.yml` | hash路由 + 相对路径 |
| 16 | Naive UI 设计系统基础 | ✅ 已完成 | `src/design-system/` | 本次实现（2026-06-23） |
| 17 | 暗色/浅色/系统主题 | ✅ 已完成 | `stores/theme.ts` + `App.vue` | 本次实现 |
| 18 | 地址交易历史 | ✅ 已完成 | `AddressDetail.vue` | getLogs + 按年翻页（2026-07-25，commit 1b7273c） |
| 19 | JNS 完整记录展示 | ✅ 已完成 | `JNSQuery.vue`（`/jns/:name` 路由复用） | 域名详情页 + 持有者其他域名 + /jns/:name 路由（2026-07-27，commit c6953b6 实改 `src/views/JNSQuery.vue`；无独立 JNSDetail.vue） |
| 20 | JNS 域名操作 | ✅ 已完成 | `JNSQuery.vue`（钱包操作面板） | 绑定/解绑/发送J + 钱包连接 + B32支持（2026-07-28，commit 406a0fa 实改 `src/views/JNSQuery.vue` L126-215；无独立 JNSOperations.vue） |
| 21 | 区块列表页 | ✅ 已完成 | `Blocks.vue` | `/blocks` 路由，区块号搜索 + 刷新（2026-03-20，commit bc33ed0；首页 `Home.vue` 之外另有独立列表页） |
| 22 | 全网签到统计页 | ✅ 已完成 | `CoreCheckinStats.vue` | `/core/checkin` 路由，Naive UI 设计系统首批页面（2026-06-27，commit f6a09ff，PR#2） |
| 23 | 工具集入口页 | ✅ 已完成 | `ToolsHome.vue` | `/tools` 路由，卡片式分类入口，未迁移工具外链 v1（2026-08-01，commit 0325566，PR#8；「即将推出」分区仅剩数据分析面板/多签钱包管理） |
| 24 | 合约交互通用工具 | ✅ 已完成 | `ContractToolView.vue` + `contracts/toolbox.ts` | `/tools/contract/:key` 路由，toolbox 注册表驱动 **12** 个合约（core 4 / eco 8），PR#9（66aa9af）2026-08-03 + 交易监听/WS 推送 PR#10（2026-08-04） |
| 25 | 默克尔证明生成器 | ✅ 已完成 | `MerkleProofGenerator.vue` | `/tools/merkle` 路由，OZ v1.0.8 兼容算法（viem 重写），root/proof 已对官方库验证（2026-08-05，commit 66b1417） |
| 26 | JNSVote 治理投票（列表） | ✅ 已完成 | `JNSVote.vue` | `/jnsvote` 路由，提案列表 + SBT 徽章 + 资格校验（JTI + JNS 持仓）；2026-08-14 commit 7b1b813（PR#15）起迭代，2026-10-22 全模块收尾（详见 §二 P3-1） |
| 27 | JNSVote 提案详情页 | ✅ 已完成 | `JNSVoteProposalDetail.vue` | `/jnsvote/:id` 路由；组件 2026-10-17 commit 145fdbb 落地，路由接线 commit a5d3d76 于 2026-10-20 合入（已核 `git merge-base --is-ancestor a5d3d76 upstream/explorer-v2` 为真） |
| 28 | JNS 域名总览页 | ✅ 已完成 | `JnsDomains.vue` | `/domains` 路由，域名总览 + i18n + smoke 用例（2026-10-16，commit 86d1553；2026-10-19 commit 0b4ad5c 收敛为中文单语种） |
| 29 | JNSVote 治理端（创建提案） | ✅ 已完成 | `JNSVoteGovernancePanel.vue` + `composables/useJNSVoteGovernance.ts` | 多签签名人专属（`v-if="isSigner"`），Gnosis 2/3 多签 submit → confirm → execute 三段流程；三条安全边界（列表过滤 / RPC 前置短路 / 防造死提案）详见 §二 P3-1；PR #62，merge ac5d8ce（2026-11-03） |
| 30 | 生态合约注册目录 | ✅ 已完成 | `ContractRegistry.vue` + `contracts/toolbox.ts` | `/contracts`；复用本地 toolboxContracts 部署清单（12 个：核心 4 / 生态 8），搜索、分类、地址复制/跳转、合约工具入口；默认零 RPC，支持按需只读核验单个合约；目录源自 PR #66 |
| 31 | 验证者 / 签名人目录 | ✅ 已完成 | `Validators.vue` + `utils/clique-signers.ts` | `/validators`；最新高度 + 最近 epoch（30000 块）检查点 extraData，未命中缓存时两次逻辑读取；60 秒缓存及并发合并；仅检查点快照，不重放后续投票、不验证 seal、不提供出块分布/在线状态，PR #66 |

> **本表覆盖度自检（2026-11-03 更新，PR #66 审计补全）**：`src/views/` 下共 **18** 个视图，本表 #1–#31 已全部覆盖（0 漏项）。
> 注：#29 是组件层（`components/` + `composables/`）而非独立视图，后续模块接续表格末尾编号；并行 PR 合入时须按实际主线顺延，不保留重复编号。
> 复算方法：
> ```bash
> T=$(sed -n '/^| # |/,/^> \*\*本表覆盖度/p' docs/feature-roadmap.md)
> missing=0
> for f in src/views/*.vue; do
>   b=$(basename "$f" .vue)
>   if ! printf '%s\n' "$T" | grep -Fq "\`$b.vue\`"; then
>     echo "MISSING $b"; missing=1
>   fi
> done
> test "$missing" -eq 0
> ```
> 新增视图必须同步加行——历史上本表在 2026-07-28 后停更近 3 个月（缺 8 个视图），
> 而 §二 P3-1 / §五 优先级表同期一直在记 JNSVote「✅ 全部完成」，两份清单互相矛盾却无人发现。

---

## 二、待开发功能清单

### P0 — 缺陷修复（影响核心体验，优先处理）

#### P0-2：J-Checkin 签到 App 在欧易 DeFi 浏览器失效
- **现象**：`jvcore-checkin.505606.xyz` 在手机欧易 DeFi 浏览器上无法正常签到，页面无响应。
- **根因分析（2026-06-28）**：
  1. **CDN 超时**：`cdn.bootcdn.net/web3.min.js` 加载耗时 9.8s，欧易沙箱环境大概率超时，导致 `Web3` 未定义，整页静默崩溃。
  2. **网络切换兼容性**：`wallet_switchEthereumChain` 失败后靠 `error.code === 4902` 触发 `wallet_addEthereumChain`，欧易钱包返回的错误码与 MetaMask 不同，导致切链逻辑永远走不进去。
- **对比 v1**：v1 使用本地 Web3.js 文件 + 不做主动切链，因此正常工作。
- **修复方案**：① 将 Web3.js 改为本地托管文件；② `wallet_addEthereumChain` 错误处理改为宽松判断（不只依赖 4902）。
- **状态**：⏸ 待处理（记录于 2026-06-28）
- **源码位置**：待确认（不在当前 explorer-v2 仓库内）

#### ✅ P0-1：地址交易历史 getLogs 重构（已完成，2026-07-25）
- **方案**：改用 `getLogs` 按年查询 Transfer 事件
  - 新建 `src/utils/timestamp-to-block.ts`：区块1锚点 + 平均出块时间推算各年份区块范围
  - 重写 `AddressDetail.vue` 交易历史：← 年份 → 翻页导航，覆盖全历史区块
  - 并行查询转入/转出 Transfer 事件
  - RPC 调用从 700+ 降至 4
  - `viem getLogs topics bug` 绕行（改用 raw JSON-RPC 请求，commit 92771ae）
- **文件**：`src/views/AddressDetail.vue`、`src/utils/timestamp-to-block.ts`
- **commit**：1b7273c（2026-07-25），后续修复 caf341f / c1623b1 / 92771ae

---

### P1 — 功能补全（原规划 P1，已列入计划未实现）

#### ~~P1-1：JNS Mint 功能~~ — 暂不实现（合约限制）
- **结论**：JNS `claim(name)` 函数为 owner-only，普通用户无法自助注册域名。v1 中 mint 按钮仅对合约 owner 显示，属于运营方后台工具，非用户侧功能。
- **待办**：若 JNS 合约升级支持公开注册，再重新评估。

#### ✅ P1-2：JNS 完整记录展示（已完成，2026-07-27）
- **说明**：域名详情页展示 JNS 的所有记录（Ethereum address、Twitter、GitHub、description 等 NFT metadata 字段）。
- **文件**：`src/views/JNSQuery.vue`（`/jns/:name` 路由复用同一组件）、`/jns/:name` 路由
- **commit**：c6953b6（2026-07-27）

---

### P2 — 全网签到统计页（规划文档遗漏功能，第二阶段）

#### ⏳ P2-2：V2 工具集入口页 + V1 工具迁移（2026-08-01 立项）
- **背景**：V1 工具集入口（`/tools/index.html`）卡片式布局，但框架/风格与主站不统一（Bootstrap 3 + web3.js + 外部 CDN），需按 V2 主站框架（Vue 3 + design-system）重写
- **方案**：先建 V2 `/tools` 入口页（卡片式分类，未迁移工具外链 V1），再逐步迁移：①合约交互工具（core+contractx 合并，viem 重写）②默克尔证明生成器 ③JNSVote（随 P3-1）
- **详细方案**：见 `docs/tools-migration.md`
- **进展**：
  - ✅ 入口页（PR#8，2026-08-01）
  - ✅ 合约交互工具迁移 — toolbox 注册表 + 通用 ContractTool 组件（PR#9，2026-08-03；PR#10 交易监听/WS 推送 2026-08-04）
  - ✅ 默克尔证明生成器迁移（2026-08-05）— `MerkleProofGenerator.vue` + `/tools/merkle`，OZ v1.0.8 兼容算法（viem 重写，已验证 root/proof 与官方库一致）
  - ⏳ 剩余：JNSVote 投票（随 P3-1）
- **状态**：🟡 进行中（剩余 JNSVote）

#### ✅ P2-1：全网 Core ID 签到统计页 `/#/core/checkin`（已完成，2026-06-24）
- **来源**：v1 `views/coreCheckInInfo.html` + `coreCheckInInfoController.js`（2026年新增，规划文档未覆盖）
- **功能**：
  - 按月（UTC+8）遍历全部 POPBadge token，分组统计每个 Core ID 签到次数/首末次时间
  - 月份导航（上月/下月切换）
  - 完整性校验（对比 Core ID 总数与签到数）
  - 分批懒加载（POPBadge token 数量随时间增长）
- **复杂度**：高（需大量链上读取 + 分批 + 月份分组逻辑）
- **已实现文件**：
  - `src/views/CoreCheckinStats.vue` ✅
  - `src/router/index.ts` 已添加 `/core/checkin` 路由 ✅
  - `src/composables/useCheckinStats.ts`（独立 composable，未扩展 useCoreId）✅
  - `src/contracts/popbadge.ts` 补充 ABI（totalSupply / tokenByIndex / getPOPInfo）✅
- **v1 源文件参考**：`v1-explorer/app/scripts/controllers/coreCheckInInfoController.js`（v1 功能完整，无待办）

---

### P3 — JNSVote 治理投票（原规划 P2，复杂度高）

#### P3-1：JNSVote 治理投票全模块
- **子功能**：
  - JNSVote SBT 徽章 + 资格校验（原「POAP 徽章验证」为命名错误：真实对应物是 JNSVote SBT 徽章，资格校验依赖 JTI + JNS 持仓，非 Core ID 的 POPBadge）✅ 已完成
  - 投票资格检查（JTI + JNS 持仓）✅ 已完成
  - 投票列表页 ✅ 已完成
  - 投票详情页（站内）✅ 已完成（路由 + 卡片跳转已接线，2026-10-20 commit a5d3d76）
  - 投票写操作（钱包签名）✅ 已完成
  - 投票进度展示（实时更新）✅ 已完成
  - 治理端创建提案入口（多签签名人专属）✅ 已完成（PR #62，merge ac5d8ce，2026-11-03）
- **复杂度**：极高，建议单独规划一轮迭代
- **合约**：需要获取 JNSVote 合约 ABI 和地址（v1 中的 `JNSVote.sol`）
- **参考**：v1 `views/jnsVote*.html` 系列
- **进展**（核对日期 2026-10-22）：
  - ✅ 提案列表只读展示（#15，commit 7b1b813）
  - ✅ 投票写操作 voteFor/voteAgainst（#16，commit 852ae1b）
  - ✅ 投票徽章画廊 + 区块实时更新（#19，commit b86a579）
  - ✅ 资格校验 checkEligibility（JTI + JNS 持仓，`useJNSVote.ts` L270-295）
  - ✅ 提案详情页（站内）：已完整接线（commit a5d3d76，2026-10-20 合入 explorer-v2）——`router/index.ts` 有 `/jnsvote/:id` 路由、`JNSVote.vue` 提案卡片 `@click` 跳转、`JNSVoteProposalDetail.vue` 组件三个入口齐备（核实方式：`git merge-base --is-ancestor a5d3d76 upstream/explorer-v2` 为真，且构建产物 `dist/assets/index-*.js` 内含 `jnsvoteProposalDetail` 路由名）
- **状态**：✅ P3-1 全部子功能已完成，展示层收尾亦已闭环——`/tools` 工具集页的 JNSVote 卡片已从「即将推出」分区移出、改为可点击卡片（PR #48，commit bfb29a8，2026-10-22 合入）；核实方式：`src/views/ToolsHome.vue:157-169` 为 `router-link to="/jnsvote"` 且标注「已迁移」，而「即将推出」分区（L173 起）仅剩「数据分析面板」「多签钱包管理」两项

  **治理端（2026-11-03 补齐，PR #62）**：`createProposal` 是 `onlyOwner`，owner = 2/3 多签 `0x4eF599b6E39D950D6Ddbd830fF5f95e06770C1B3`（签名人 Koant J-0 / 剪云为裳 J-37 / 明海云 J-7）。此前前端只有「投票端」，签名人无创建入口。现新增 `JNSVoteGovernancePanel.vue` + `useJNSVoteGovernance.ts` + `contracts/jnsvoteGovernance.ts`，`v-if="isSigner"` 门控。

  三条安全边界（均有实测依据，后续改动不得回退）：
  1. **列表过滤**：只保留 `destination === JNSVote` 且 `selector === createProposal(0x6b5e1766)` 且 `value === 0` 且可成功解码的待执行交易。否则会把多签里积压的 WJ 提现等交易误展示成「创建提案」并可被误执行。实测（2026-11-03）：多签 pending 30 笔（26 笔目标 `0xf8AbF36B` + 4 笔 WJ 提现每笔 1 J），过滤后命中 0 笔。
  2. **RPC 零负担**：`isOwner` 前置短路——非签名人 1 次 call 即返回，不触发后续扫描；签名人亦只对过滤后少数交易读确认状态。
  3. **防造死提案**：`timeBegin > currentBlock` 在表单端 + 执行端双层硬校验。合约侧 `vote()` 要求 `timeBegin < block.number < timeEnd`；`disableProposal` / `reenableProposal` 检查链上原 `timeBegin`，开始后不可执行。注意 `modifyProposal` 检查的是入参的新 `timeBegin`，不能据此声称合约禁止修改已开始提案（见 `docs/reference/jnsvote/jns_vote.sol`）。若产品要求“开始后不可修改”，三操作后续实现须在提交端和执行端独立复核链上原开始高度；本 PR #66 不涉及治理写操作。

  已知非阻塞瑕疵（后续可改）：① `executeTx(txId)` 在 composable 层不校验 txId 归属（当前唯一调用点已过滤，安全；属防御深度缺口）；② `getConfirmations` 读取失败时静默降级为空数组，已确认过的签名人仍看到「确认」按钮，点击会 revert；③ `isTxExpired` 用 `<=`，`timeBegin == currentBlock` 时其实下一块即可投票，被偏保守禁掉。

---

### P4 — 废弃功能评估（维持原规划结论）

| 功能 | 原规划建议 | 维持建议 | 原因 |
|------|-----------|---------|------|
| CryptoJunks NFT | 考虑废弃 | 维持废弃 | 与浏览器核心定位不符，使用频率低 |
| Redpacket 红包 | 考虑废弃 | 维持废弃 | 同上 |
| 合约验证功能 | 考虑废弃 | 维持废弃 | 复杂度高，维护成本高，可独立工具化 |

---

## 三、性能问题清单（全局扫描，需同步解决）

> 2026-06-25 全局 review 结果。所有 🔴 问题需在功能开发前先解决，🟡 随对应功能开发时一并处理。

### 🔴 严重性能问题

#### ✅ PERF-1：地址交易历史串行 RPC 爆炸（已修复，2026-07-25）
- **修复**：改用 `eth_getLogs` 按年查询，RPC 调用从 700+ 降至 4。
- **关联**：✅ P0-1

#### ✅ PERF-2：JNS 持有列表无分批保护（已修复，2026-07-29）
- **问题**：JNS 为 NFT，某些地址可能持有几十至数百个域名。若全量 `tokenOfOwnerByIndex` 一次打出，可能触发 RPC 限速（`rpc.jnsdao.com` 是小型公共节点）。
- **当前 ABI 状态**：`jns.ts` 缺少 `balanceOf` 和 `tokenOfOwnerByIndex` 方法，需补充。
- **解决方案**（已实现）：
  1. 先调 `balanceOf(addr)` 拿总数，立即渲染"持有 X 个 JNS 域名" ✅
  2. 自动加载前 10 个（`tokenOfOwnerByIndex` 0-9），用 `_allTokensName(tokenId)` 获取域名字符串 ✅
  3. 超过 10 个时显示"加载更多"按钮，每次追加 10 个 ✅
  4. 超过 50 个提示"前往 JNS 页查看全部" ✅
- **实现**：`AddressDetail.vue` JNS 持有面板（`JNS_BATCH_SIZE=10` / `JNS_MAX_DISPLAY=50`）

### 🟡 中等性能问题（全部已解决 ✅）

#### ✅ PERF-3：首页创世区块重复 fetch（已修复，2026-08-11 确认）
- **问题**：`fetchLatestBlocks` 每次调用都 `await publicClient.getBlock({ blockNumber: 0n })` 获取创世区块计算运行时间。创世区块内容永远不变，但每次刷新都多一次 RPC。
- **解决方案**：创世区块时间戳已硬编码为常量 `GENESIS_TIMESTAMP = 1664451960`（`Home.vue:222`），省去该 RPC 调用。

#### ✅ PERF-4：首页区块串行加载（已修复，2026-08-11 确认）
- **问题**：`for (let i = 0; i < 10; i++) { await publicClient.getBlock(...) }` 串行获取 10 个区块。
- **解决方案**：已改为 `await Promise.all(blockNumbers.map(n => publicClient.getBlock({ blockNumber: n })))`（`Home.vue:230`），并行加载。
- **关联**：原列于代码质量表，已提升为性能问题并解决

#### ✅ PERF-5：POP 历史加载无上限保护（已修复，2026-07-29）
- **问题**：`loadMyPopHistory` 对地址持有的所有 POP Badge 一次性全量加载（`balanceOf` → 全量 `tokenOfOwnerByIndex` → 全量 `tokenURI`）。每月签到产生 1 个，3 年社区用户约 36 个，目前可接受；但若将来出现异常账号（自动化签到或合约 bug），无任何保护。
- **解决方案**（已实现）：加上限 `MAX_POP_DISPLAY=50` + 分批加载 `POP_BATCH_SIZE=10`，显示总持有数，超出时提示"仅显示最近 N 条，共 X 条"。
- **实现**：`useCoreId.ts`（commit 3a52c0f / 0a2b772，2026-07-29）

### 🟢 低优先级问题

#### ✅ PERF-6：`jns.ts` 模块级 `console.log`（已修复，2026-08-11 确认）
- **问题**：模块加载时直接 `console.log('=== jns.ts Module Load ===')` + `JNS_ADDRESS`，每次 import 都执行，生产环境会持续输出调试日志。
- **解决方案**：已删除，`contracts/*.ts` 无残留 console.log。

---

## 四、代码质量待处理项

### 结构性问题（全部已解决 ✅，2026-08-11 确认）

| 优先级 | 问题 | 文件 | 说明 |
|--------|------|------|------|
| ✅ 已修复 | 地址交易历史根本缺陷（见 PERF-1 + P0-1） | `AddressDetail.vue` | getLogs 重构完成（2026-07-25） |
| ✅ 已修复 | `formatAddress/formatHash/formatAge` 各文件重复 | 各 View | 已抽 `src/utils/format.ts` 统一，各 View 均从 utils 导入，无本地重复 |
| ✅ 已修复 | `useBlockchain.ts` 死代码 | `src/composables/useBlockchain.ts` | 无引用，文件已删除 |
| ✅ 已修复 | `Home.vue` 区块串行加载（见 PERF-4） | `Home.vue` | 已改 `Promise.all` 并行加载 |
| ✅ 已修复 | `HelloWorld.vue` 脚手架残留 | `src/components/HelloWorld.vue` | 无引用，已删除 |

### 测试与类型检查基础设施（2026-10-24 ~ 10-26 建成）

> 这一段此前**完全缺失**：2026-08-11 的收尾只覆盖了运行时性能与死代码，测试/类型检查侧的三个盲区直到 10 月才逐个补齐。
> 记录于此避免后续误以为「质量项已全部收尾」。

| 项 | 内容 | 状态 | 落点 |
|---|---|---|---|
| 测试环境 mock | `tests/setup.ts` 装 `window.matchMedia` mock，`vitest.config.ts` 挂 `setupFiles` | ✅ 已合入 | PR #51（c570d0f）|
| `tests/` 纳入 typecheck | 新增 `tsconfig.test-vitest.json`（spec + setup + vitest.config）/ `tsconfig.test-node.json`（`jvaddress.test.ts`，node:test + 原生 strip-types），根 `tsconfig.json` references 追加两者 | ✅ 已合入 | PR #53（c2c6149）|
| mock 归因注释修正 | 查明真根因是 **jsdom 30.1.3 全包 0 处 `matchMedia` 实现**（非 node 版本差异、非 npm/pnpm 布局差异）；此前 CI 未暴露是因**无 spec 覆盖该路径**（覆盖盲区），非环境差异 | ✅ 已合入 | PR #54（8984455）|
| theme store 冒烟用例 | `tests/theme-store.spec.ts` 9 条（初始化 2 / 三态 4 / 写操作 2 / `$dispose` 清理 1），前两条初始化用例**不自装 mock**，完全依赖 `setup.ts` | ✅ 已合入 | PR #56（dd192ab → merge 20a19cc）|
| 多签治理端待执行交易编号 | `tests/gov-pending-ids.spec.ts` 7 条（id=0 保留 / 混合编号顺序 / 补齐位截断 / 非零编号不变 / 目标+selector 双重过滤 / pending=0 清空 / value>0 过滤），只 mock 合约读取，编解码走真实实现 | ✅ 已合入 | PR #62（08a5734…4b9b3cb → merge ac5d8ce）|

**当前基线**（`explorer-v2` 分支 `ac5d8ce`，2026-11-03 实测）：`npm run build` EXIT 0 / `vitest run` **29 passed**（4 files）/ `node --test tests/jvaddress.test.ts` **3 passed**。

> 基线演进：13（PR #51~#54 前）→ **22**（PR #56 theme store 9 条）→ **29**（PR #62 gov-pending-ids 7 条）。
> 上表五项现全部为「已合入」。**2026-10-30 这批（#57/#58/#56/#59）与 2026-11-03 这批（#60/#61/#62）均已全部 merge**，截至 2026-11-03 open PR/Issue 归零。
>
> ⚠️ 计数口径提醒：`npm test` = vitest 29 + node:test 3 = **32 条**。写 PR 描述或文档时别只抄 vitest 数字又说「npm test N passed」——PR #62 描述里写「vitest 22 passed」就是这个错（当时实际已是 29）。

**两条必须记住的规则**：

1. **`vue-tsc -b` 只走 `references`**，新增目录（如 `tests/`）不主动挂 project 就**永远假绿**。验证覆盖是否成立只能用**负向注入**（往目标文件写一行类型错误，看 `build` 是否变 EXIT 2），不能看「build 成功」就当覆盖了。
2. **写测试必须做反证**：断言通过 ≠ 覆盖成立。绿可能来自 ①真的覆盖了 ②自己重复造了被测依赖（在 `beforeEach` 里自装 mock，spec 压根没依赖 `setup.ts`）③压根没执行到断言。唯一判定法是——**把你声称守护的那个依赖拿掉，看测试是否变红**。PR #56 第一版就是典型的假覆盖：9 条全绿，但摘掉 `setup.ts` 的 mock 后仍然 9 条全绿。

**注意**：PR 分支**不触发 CI**（`deploy-pages.yml` 仅 `on.push: [feature/core-id-checkin, explorer-v2]`），PR 上 `check_runs: 0` / `commit status: pending` 是正常态，分支验证只能靠本地门禁。

### 设计系统接入

新功能必须使用 `src/design-system/` 中的组件，旧页面**不主动迁移**，触达时随业务修改替换：

```
src/design-system/
  tokens.css          ← CSS变量，全局引入（已完成）
  theme.ts            ← Naive UI 主题覆盖（已完成）
  index.ts            ← 统一导出
  components/
    JvLoading.vue      ← J字涨水 loading（已完成）
    JvPageState.vue    ← 空状态/异常状态（已完成）
    JvHashText.vue     ← 地址/哈希展示+复制+跳转（已完成）
    JvActionButton.vue ← 带loading防重复提交按钮（已完成）
    JvStatusTag.vue    ← 交易/网络/Core ID状态标签（已完成）
    JvAmount.vue       ← 链上金额展示（已完成）
```

---

## 五、开发优先级建议

```
立即（性能/体验阻塞）─────────────────────────────
  （所有 P0/PERF 已解决 ✅）

近期（功能开发，含性能保护）──────────────────────
  ~~JNS-1~~  地址页 JNS 主域名反向显示（addr2name）✅ 已完成（PR#3）
  ~~JNS-2~~  地址页 JNS 持有列表（含 PERF-2 分批加载保护）✅ 已完成（2026-07-29）
  ~~PERF-5~~ POP 历史上限保护 ✅ 已完成（2026-07-29）
  ~~P1-1~~ JNS Mint 功能 — 暂不实现（合约限制）
  ~~P1-2~~ JNS 完整记录展示 ✅ 已完成（2026-07-27）

已完成 ─────────────────────────────────────────
  ✅ P2-1  全网签到统计页（2026-06-24）
  ✅ P0-1  地址交易历史 getLogs 重构（2026-07-25）
  ✅ PERF-1  地址交易历史串行 RPC 爆炸（2026-07-25）
  ✅ PERF-2  JNS 持有列表分批加载保护（2026-07-29）
  ✅ PERF-3  首页创世区块硬编码（2026-06-28 前）
  ✅ PERF-4  Home.vue 区块并行加载（2026-06-28 前）
  ✅ PERF-5  POP 历史上限保护（2026-07-29）
  ✅ PERF-6  jns.ts console.log 删除（2026-06-28 前）
  ✅ P1-2  JNS 完整记录展示（2026-07-27）
  ✅ JNS-2  地址页 JNS 持有列表 + 分批加载（2026-07-29）
  ✅ JNS 域名操作 — 绑定/解绑/发送J（2026-07-28）

中期 ───────────────────────────────────────────
  P3-1    JNSVote 治理投票 — ✅ 全部完成（列表/详情/写操作/资格校验/进度实时，2026-10-22 核实；/tools 入口卡片可点化随 PR #48 于 2026-10-22 合入，无残留）

2026-08-11 已清理（代码质量/性能收尾）────────
  ✅ format.ts 统一（utils/format.ts）
  ✅ useBlockchain.ts 死代码删除
  ✅ HelloWorld.vue 脚手架删除
  ✅ PERF-3 创世区块硬编码（GENESIS_TIMESTAMP）
  ✅ PERF-4 Home.vue 区块并行加载
  ✅ PERF-6 jns.ts console.log 清理
  ✅ GitHub Pages 正式部署配置（hmisty 仓库）

待定 ───────────────────────────────────────────
  P4 废弃功能（维持现状，不主动实现）
```

---

## 六、v1 遗漏功能补充记录

以下功能在 v1 2026 年新增，但 v2 规划文档（2026-03-18 撰写）未覆盖，已在 v2 中补实现或记录：

| 功能 | v1 新增时间 | v2 状态 |
|------|-----------|---------|
| Core ID NFT 展示 + 一键签到 | 2025.1–2026.1 | ✅ PR#1 已合入（2026-06-18） |
| JVA/B32/HEX 多格式地址 | 2026.1.19–22 | ✅ 大白实现（2026-06-19） |
| 全网签到统计页 | 2026年 | ✅ P2-1 已完成（2026-06-24） |

> 根因：规划文档基线可能是 2026-03-18 之前的 v1 快照，2026 年 1–3 月新增功能未被覆盖。建议将本表同步给大白，补充到 `explorer-v2-mvp-plan.md` 的 V1 功能清单。

---

## 七、外部部署说明

| 部署目标 | 地址 | 状态 |
|---------|------|------|
| GitHub Pages（fork） | `https://xiaopiao009.github.io/jouleverse-explorer-v2/` | ✅ 运行中 |
| GitHub Pages（上游正式） | `https://hmisty.github.io/jouleverse-explorer-v2/` | ✅ 已配置（2026-08-11，source: explorer-v2 分支，已 built） |

### 钱包交互环境域名要求

涉及钱包连接、签名、转账等写操作的场景，对部署域名有硬性要求：

| 场景 | 域名要求 | 说明 |
|------|---------|------|
| 生产环境 | **自持域名** + 自有 HTTPS 证书 | 禁止使用免费共享隧道域名 |
| 真机测试 | localhost + 局域网代理（钱包 App 与开发机同网段） | 或通过正规域名完成 |
| 纯页面预览 | 共享免费隧道可用 | 仅限无钱包交互的展示 |

**为什么不能用共享免费隧道域名**：cloudflared 免费快速隧道（`*.trycloudflare.com`）、localtunnel、ngrok 免费域名等共享子域，会被 MetaMask 等钱包的安全策略标记为「高风险 / 恶意域名」，导致钱包连接、签名、转账等写操作失效。

来源：PR #28（wallet injected connector）真机测试期间实测，`*.trycloudflare.com` 被 MetaMask 拦截（见 issue #34）。

### RPC 端点配置（2026-10-29 起，PR #59）

链上读写全部走 **无端口正式端点**，旧 `:8503` / `:8505` 已废弃：

| 用途 | 端点 |
|------|------|
| HTTP RPC | `https://rpc.jnsdao.com` |
| WebSocket | `wss://rpc.jnsdao.com/ws` |

- 落点：`src/config/client.ts`、`src/config/chain.ts`、`src/stores/wallet.ts` 及 `CoreIdCheckIn.vue` / `WJOperations.vue` / `JNSVote.vue` / `JNSVoteProposalDetail.vue` 用户提示文案，共 10 处硬编码
- 验收（2026-10-30）：构建产物 `dist/assets/*.js` 内 `rpc.jnsdao.com` 命中 9 处、`:8503`/`:8505` 残留 **0**；
  `scripts/smoke-jnsvote.mjs` 真实链 10/10 通过（含 WS 收到 2 个区块，间隔 15.2s，块号单调递增）
- ⚠️ 新代码**不得**再引入带端口端点；jscan v1（`/var/www/explorer/app/.rpc.txt`）仍为 `:8503`，属遗留待处理

---

*最后更新：2026-11-03（大白 💎）—— 同步 11-03 合并后状态：#60/#61/#62 全部合入（merge aac3548 / 6b7cb27 / ac5d8ce），测试基线 22 → 29 passed（+7，PR #62 多签治理端用例），补记计数口径提醒（`npm test` = vitest + node:test）*


### PR #66 审计补全（2026-11-03）

新增两个只读目录已登记到 §一；本分支共 18 个视图、模块编号 1–31。覆盖度脚本改为按表头/自检标记提取，避免固定行号漏掉新增行；`tests/feature-roadmap.spec.ts` 自动检查视图覆盖、重复/跳号和自检数字。编号仅对应本分支，#65/#67 等并行 PR 合入时须保留条目并按主线末尾顺延，同步实际视图数。检查点名单仅代表该高度的节点响应快照，不代表实时授权集合、节点在线、seal 已验证或逐块出块者。
