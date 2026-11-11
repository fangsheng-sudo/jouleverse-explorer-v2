# 网络身份校验

链编号本身不足以唯一标识一条网络。需要更强网络绑定的接入方，应同时核对「预期链编号」与「创世区块哈希」——预期创世哈希须来自**独立于被检测 RPC 端点**的受信链规范。

`src/integration/network-identity.ts` 中的 helper 只读且 fail-closed：

- `unconfigured`：未提供有效的受信创世哈希；
- `wrong-chain`：观测到的链编号不符；
- `genesis-mismatch`：创世区块缺失或其哈希不符；
- `unavailable`：RPC 读取失败；
- `verified`：两者均匹配。

该 helper 不会凭空臆造或内置创世哈希；期望值须由维护者独立确认并在生产接入前记录。创世哈希匹配能增强网络识别，但不能证明该 RPC 节点在后续状态查询中诚实；关键应用应使用独立节点或交叉核验观测结果。
