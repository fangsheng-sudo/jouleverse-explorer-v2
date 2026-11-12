# 商业事件与证据协议、合约接口草案

状态：本地试点，协议版本 commercial-evidence/v1，尚未提交链方采纳。不是已部署合约 ABI 的声明。

## 私有证据与公开事件

私有 envelope 固定字段：schema、network、deploymentId、applicationId、recordId、operation、previousRecordId、subjectCommitment、documentDigest、occurredAt、salt。校验器拒绝额外字段；业务正文与文件由应用侧受控保管。product/batch/organization 等原始业务ID不直接进入公开事件。

摘要使用 SHA-256：按以上固定字段顺序组成 JSON 数组（UTF-8，无空白），十六进制转小写，UTC 时间固定到毫秒，operation 为 create/correct/revoke。该编码是本协议自定义的固定元组编码，不宣称通用 JCS。network 和 deploymentId 将证据绑定到部署域，阻止无意跨链复用。salt 必须是每份证据独立产生的32字节安全随机值；代码只能验证格式和非零，不能验证熵，生产由 CSPRNG 生成。示例固定 salt 仅供虚构测试。

应用ID、记录ID和 subjectCommitment 需要防枚举设计，使用随机标识或带私有随机数的域分离摘要。仅对可猜业务编号计算无盐哈希不能保护隐私。原始文件的 documentDigest 只进入私有 envelope；公开的是整个 envelope 的 payloadDigest。

候选事件：

```solidity
event EvidenceAnchored(
    bytes32 indexed applicationId,
    bytes32 indexed recordId,
    bytes32 payloadDigest,
    bytes32 previousRecordId,
    uint8 operation
);
```

operation：0=create（previousRecordId=0），1=correct，2=revoke（后两者必须引用不同的非零记录）。每条操作都有新的 recordId，撤销并不删除历史。公开事件仍泄露应用活动量、操作类别和版本关系，应在正式部署前评估是否需要批量 Merkle 根等更少披露方案。

## 合约设计约束，尚未实现及部署

- applicationId 必须由明确的注册/授权机制管理；不能允许任意账户冒充其他应用。
- 同应用 recordId 唯一，非零ID、非零摘要，前驱必须存在且属于同一应用。
- 更正和撤销只允许作用于当前有效前驱，禁止分叉；撤销为终态，重新签发使用新记录。
- 禁止通过交易 value 收取原生J；如以后需要WJ费用，应单独设计并审核，当前无收费逻辑。
- 本期核验假设不可升级合约。代理、delegatecall或可变实现不能仅靠代理代码哈希证明语义，必须另行支持并审查。
- 部署后登记链、地址、起始区块、运行时代码哈希、源码/编译器/构建参数和权限治理。未经核验的地址不能加入生产清单。

目前未在 Explorer 已登记合约或参考资料中找到对应商业锚定接口。此结论限于已检查仓库，不能推断全链不存在其他存证应用。新合约是否必要，需要链方确认现有方案后决定，未对主网部署。

## 核验语义

核验器验证：网络编号与固定检查点、历史和观察链头代码哈希、成功回执、日志发出地址、ABI、应用/记录/摘要/前驱/操作、回执区块与规范区块、确认深度，以及结束前固定链头/事件区块未变化。

返回 scope=inclusion-only：仅说明该事件在单一RPC所报告的规范链上达到指定深度，不证明共识最终性、文件内容真实、签发人认证、未被后续更正/撤销、海关认可或商业履约。当前状态判断必须读取完整相关历史并结合企业权限与证据核验。单一RPC可以撒谎，代码哈希不能替代源码及治理审计。
