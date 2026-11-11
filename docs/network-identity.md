# 网络身份校验

链编号本身不足以唯一标识一条网络。需要更强网络绑定的接入方，应同时核对「预期链编号」与「创世区块哈希」——预期创世哈希须来自**独立于被检测 RPC 端点**的受信链规范。

`src/integration/network-identity.ts` 中的 helper 只读且 fail-closed：

- `unconfigured`：未提供有效的受信创世哈希；
- `wrong-chain`：观测到的链编号不符；
- `genesis-mismatch`：创世区块缺失或其哈希不符；
- `unavailable`：RPC 读取失败；
- `verified`：两者均匹配。

该 helper 不会凭空臆造或内置创世哈希；期望值须由维护者独立确认并在生产接入前记录。创世哈希匹配能增强网络识别，但不能证明该 RPC 节点在后续状态查询中诚实；关键应用应使用独立节点或交叉核验观测结果。

## 融合版中的实际接入

创建套件时可传 `{ expectedGenesisHash }`（来自独立受信规范）；随后 verifyContract/readContract 自动进行创世前置核验，失败不继续部署查询或 eth_call。没有配置时仍执行已有 checkpoint 检查，但能力字段明确不宣称创世已验证。详见 developer-integration-kit.md。

helper 入口在 await 之前复制期望策略，避免调用方改写进行中的策略。非法链 ID 观测、非法哈希和取消均不能得到 verified。可选 AbortSignal 在请求前后检查，取消后不再启动后续区块请求。

独立 helper 不提供自身计时器，也不能强制取消已发出的适配器请求；独立使用时 reader 必须设置请求超时。通过 kit.verifyNetworkIdentity 调用时，套件提供整体截止时间、错误脱敏及并发上限。套件的目录和核验报告被冻结，适配器业务输出仍由适配器负责。
