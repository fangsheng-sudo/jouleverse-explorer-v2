# Jouleverse生态基础设施摸底与本次选型

日期：2026-11-03；范围：公开GitHub资料、explorer-v2主线及当时开放的合并请求。以下“缺口”均指已检查范围内未发现完整交付，不是对所有私有项目或全球开源生态的断言。

## 已有能力：采用或接入，不重复建设

| 能力 | 已查来源 | 决定 |
|---|---|---|
| 链节点、配置及Clef签名组件 | Jouleverse/jouleverse、jouleverse-node；节点README记录Clef接入与维护 | 沿用；不改共识、不重做节点 |
| 节点运行审计与日报 | Jouleverse/audit、network-status | 沿用；不能把浏览器检查点目录当运行监控 |
| 身份、JNS与Nostr映射 | nostr-gen及explorer已有Core/JTI/JNS工具 | 接入；NIP-05映射不等于业务授权/预算管理 |
| WJ、红包、JNS托管示例 | WJOULE、redpacket、escrow-jns仓库 | 沿用；不自建新代币/托管合约 |
| 数据分析与经典多签工具 | explorer-v2开放PR #65 | 不重复开发 |
| 合约目录与检查点签名人目录 | explorer-v2开放PR #66 | 不重复开发；待审不等于已上线 |
| 治理防御加固 | explorer-v2开放PR #64 | 不混入、不覆盖 |
| 原始交易/回执读取 | viem及现有TransactionDetail.vue | 直接采用底层读取；本轮只补业务可复用核验与导出层 |

## 候选缺口与优先次序

| 候选 | 已有基础/缺口 | 建议 |
|---|---|---|
| 业务交易观察与机器可读记录 | 人工详情页已有，未发现通用归属一致性核验及版本化导出模块 | **本次完成**；只读、低成本、独立验收，便于玄联和其他应用共用 |
| 正式接入说明与兼容矩阵 | chain.ts有编号/RPC/Multicall；最终性、费用政策、公开测试网服务约定仍需权威确认 | 不擅写“官方规范”；先按实测出具观察结果，由链方确认政策 |
| 月度节点可用率统计 | audit README的TODO及issue #5已有需求，需要持续采集/存储/节点侧权限 | 值得跟进；不在纯前端浏览器里伪造在线率，不重复另造审计器 |
| 交易任务、幂等与事件通知 | FireFly等开源框架已有通用队列/事件接入能力；Jouleverse是否完整兼容仍需适配测试 | 先测现成设施，确实缺什么再写薄插件；不重做通用平台 |
| 智能体授权、支出预算与业务意图匹配 | Clef/钱包/JTI提供部分能力，但不等于企业授权链及合约级限额 | 下一阶段按具体业务闭环验证；不借只读工具暗中开放自动花钱 |
| 真实支付/履约语义解释器 | 原始回执不等于订单支付成功；需匹配合约、事件、币种、金额、订单号及防重复入账 | 可作为下一项窄插件，但需先确定实际业务契约和验收案例 |

这些后续项没有被本轮“顺便开发完成”。需要持续服务、权限或链方决策的项目，不能为了交付数量写成浏览器占位功能。

## 本次功能：链上交易核验与记录导出工具

> 核对链上交易记录的一致性，导出可供人工、业务系统和智能体复用的查询结果。

### 基础作用

- 为人工、业务系统和智能体提供同一份有来源、时间、网络编号、明确状态的链上观察记录。
- 统一处理错网、待打包、未找到、执行失败、数据矛盾及疑似重组，减少接入者各写一套容易出错的判断。
- 页面对普通用户可用，核心模块不依赖Vue/钱包，可被其他运行环境复用；不绑定玄联私有业务或收费协议。
- 把“链上记录观察”与“订单授权、支付语义和现实履约判断”分开，保留后续插件扩展空间。
- 不增加合约部署、不花gas、不扫描链、不新增公共服务运维成本。

## 实测发现：不要把旧文档中的费用假设当永久规则

本次真实交易留档（tests/fixtures/receipt-mainnet.json）：交易type为0x2，回执存在effectiveGasPrice，所在区块存在baseFeePerGas。这说明至少该样本走的是1559类型交易，不能把“本链一律只有旧式gasPrice”作为接入前提。

本模块有实际价格则按effectiveGasPrice计算；仅旧式/访问列表交易缺该字段时允许回退gasPrice；1559交易缺实际价格明确未知，不拿上限费用冒充实际费用。

以上只是可复算的样本事实，并不据此推断全链经济政策、J的转账限制原因、费用回收机制或法律属性。这些仍需链方确认。

## 调研来源（公开只读）

- https://github.com/Jouleverse （公开仓库清单，API共返回22个）
- https://github.com/Jouleverse/jouleverse-node （读取默认分支README）
- https://github.com/Jouleverse/audit （README、文件树、开放事项；README明确列月度可用率TODO）
- https://github.com/Jouleverse/nostr-gen （README、文件树、开放事项）
- https://github.com/Jouleverse/JIPS （README、文件树、开放事项；JNS多链/拍卖等仍见讨论，不能当已交付）
- https://github.com/Jouleverse/workspace （文件树、开放工作项）
- https://github.com/Jouleverse/how （README说明已迁移到wiki，未拿旧how当新项目来源）
- https://github.com/hmisty/jouleverse-explorer-v2/pulls （查询时 #64/#65/#66 开放）
- https://github.com/hmisty/jouleverse-explorer-v2/blob/explorer-v2/src/views/TransactionDetail.vue
- https://github.com/hmisty/jouleverse-explorer-v2/blob/explorer-v2/docs/feature-roadmap.md

GitHub网页抓取服务未能打开部分页面；仓库与开放事项使用GitHub公开API、源码git读取及raw文件交叉查看。未声称做过所有仓库的逐行安全审计或维护者访谈。
