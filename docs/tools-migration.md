# 工具集迁移方案（Tools Migration）

**文档日期**：2026-08-01  
**维护人**：大白（💎）  
**状态**：📋 已立项，逐工具迁移中（默克尔证明生成器 ✅ 2026-08-05）

---

## 一、背景

V1 工具集入口（`jscan.jnsdao.com/tools/index.html`）为卡片式布局，但存在以下问题：

1. **框架/风格与主站不统一**：V1 工具页使用 Bootstrap 3 + Font Awesome + web3.js 1.7，与主站（V2：Vue 3 + Naive UI + design-system）完全两套体系
2. **外部 CDN 依赖**：依赖 `mirrors.sustech.edu.cn` 等外部 CDN，存在加载超时风险（同类问题见 P0-2 J-Checkin CDN 超时）
3. **工具入口分散**：工具散落在 `/tools/*` 子路径，用户无法从 V2 一站访问

**目标**：按 V2 主站框架和风格重写工具集入口页，并逐步将 V1 工具迁移进来。

---

## 二、V1 工具清单与迁移策略

### 2.1 tools 目录工具（本次迁移主体）

| 分类 | 工具 | V1 路径 | 现状 | 迁移策略 |
|------|------|---------|------|---------|
| 合约工具 | 核心合约交互工具集（部署/调用/事件查询） | `/tools/core/index.html` | ✅ 在用 | **重写迁移**（viem 实现） |
| 合约工具 | 其他合约交互工具集（自定义 ABI） | `/tools/contractx/index.html` | ✅ 在用 | **重写迁移**，可与 core 合并为统一"合约调用工具" |
| 空投工具 | 默克尔证明生成器（Core 空投） | `/tools/airdrop/merkle-proof-generator.html` | ✅ 在用 | **✅ 已迁移**（2026-08-05，V2 `/tools/merkle`） |
| 分析与管理 | 数据分析面板 | — | 本分支实现，待审核发布 | `/tools/analytics`，近期有界样本 |
| 分析与管理 | 多签钱包管理 | — | 本分支实现，待审核发布 | `/tools/multisig`，经典多签已有钱包管理 |

### 2.2 其他 V1 功能页（评估是否纳入工具集入口）

| 功能 | V1 页面 | V2 状态 | 说明 |
|------|---------|---------|------|
| Core 签到统计 | `coreCheckInInfo.html` | ✅ 已完成（`/core/checkin`，P2-1） | 入口卡片直达内页 |
| JNS 域名查询 | `jnsInfo.html` | ✅ 已完成（`/jns`） | 入口卡片直达内页 |
| JNSVote 投票 | `jnsVoteInfo.html` | ⏳ 未做（P3-1） | 规划卡片（即将推出） |
| 链上红包 | `redpacketInfo.html` | ❌ 废弃（P4 结论） | 不迁移 |
| CryptoJunks | `junksInfo.html` | ❌ 废弃（P4 结论） | 不迁移 |
| 合约验证功能 | — | ❌ 废弃（P4 结论） | 不迁移 |

---

## 三、实施方案

### 第一步：V2 工具集入口页（✅ 已完成，2026-08-01）

- 新增路由 `/tools` → `ToolsHome.vue`，`/tools/contract/:key` → `ContractToolView.vue`
- 使用 design-system 组件 + Naive UI 主题，与主站风格统一
- **分区设计（核心 vs 生态视觉区分）**：
  - ⭐ **核心合约工具**（品牌色左边框 + Core 徽章）：JVCore、创世金库（多签）、Timelock、链上红包
  - 🌿 **生态合约工具**（Ecosystem 徽章）：JNS、JNSVote、WJ、星球、JTI、CryptoJunks、飞翔的J、JNSDAO加V
  - 🛠️ **通用工具**：自定义 ABI 交互（V1 外链待迁移）、默克尔证明生成器（V1 外链待迁移）
  - ⛓️ **链上功能**：JNS 查询、Core 签到统计（V2 内页直达）
  - ⏳ **即将推出**：JNSVote 专属 UI、数据分析、多签管理（占位）
- **每合约独立成工具、一步直达**：`/tools/contract/:key`，通用 `ContractTool.vue` 组件（传 ABI + 地址自动生成函数列表/参数表单/事件查询），新增合约只需改 `src/contracts/toolbox.ts` 注册表
- **合约注册表**：`src/contracts/toolbox.ts`（12 个合约：地址来自 V1 deployments.js，ABI 从 V1 misc 提取，已全部验证合约存在 + readContract 可用）
- header 导航「工具集」入口 + 首页快速链接

### 第二步：逐工具迁移（按优先级）

1. **合约交互工具**（core + contractx → 统一"合约调用工具"）
   - viem 重写，去掉 web3.js 和外部 CDN 依赖
   - 支持自定义 ABI + 常用合约快捷入口
   - 预估：4-6h
2. **默克尔证明生成器**（✅ 已完成，2026-08-05）
   - 纯前端逻辑迁移，成本低
   - V2 实现：`src/views/MerkleProofGenerator.vue` + `/tools/merkle` 路由
   - 算法：OZ StandardMerkleTree v1.0.8 兼容（viem 重写 `src/utils/merkleTree.ts`，已验证与官方库 root/proof 完全一致）
   - 链上查询改用 viem readContract（Core ID ownerOf / JNS name2addr），并发 6 限制保护公共节点
   - 预估：1-2h
3. **JNSVote 投票**（随 P3-1 排期）

### 第三步：V1 收尾

- 工具全部迁移完成后，V1 `/tools` 入口下线或 301 → V2

---

## 四、工作量预估（合计）

| 工作项 | 预估 | 状态 |
|--------|------|------|
| V2 工具集入口页（/tools 路由 + 卡片页） | 2-3h | ✅ 已完成（2026-08-01） |
| 合约调用工具迁移（viem 重写） | 4-6h | ✅ 已完成（PR#9，2026-08-03） |
| 默克尔证明生成器迁移 | 1-2h | ✅ 已完成（2026-08-05） |
| 部署与联调 | 0.5-1h | ✅ 随各工具完成 |
| **合计** | **7.5-12h** | 合约工具 + 默克尔完成 |

---

## 五、备注

- V1 工具页依赖的外部 CDN（南科大镜像）与 P0-2 的 bootcdn 问题同类，迁移后彻底消除该隐患
- 新入口页遵循 design-system 接入原则：新功能必须使用 `src/design-system/` 组件
