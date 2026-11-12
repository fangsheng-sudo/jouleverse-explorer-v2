# 与玄联通用可信溯源底座的边界及联调

企业底座保管产品、批次、报告文件、签发主体字段、权限及原始业务记录。本包负责将经过授权的证据封装为部署域绑定的摘要，核验链上事件包含性，并提供独立索引。两套对象不互相替代。

可选本地联调（两个源码目录需相邻）：

```sh
npm --prefix ../xuanlink-traceability-v0.1 ci
npm --prefix ../xuanlink-traceability-v0.1 run build
npm run demo:xuanlink
```

示例使用真实的本地 TraceStore API 和完全模拟的链回执，证明数据接口可组合，不证明生产链适配已完成。没有复制底座实现；独立分发本包时，缺少相邻底座则该可选示例不能运行，默认 npm test/demo 不依赖它。

## 映射

- 底座 evidence.digest 的无前缀 SHA-256 转为 envelope.documentDigest 的0x前缀32字节值，保留相同算法。
- 产品/批次原始编号不作为公开 recordId；recordId 独立生成并持久保存。
- subjectCommitment 使用带随机数及域标签的编码摘要。底座的批次关系仍由受控系统维护。
- 时间来自规范业务字段，不伪装为链共识时间。
- local verify 的 matches、revoked、expired、superseded 必须分别检查；issuerVerified=false 不能升级为独立认证或L3证据。
- 首次准备的完整私有envelope应持久保存，重试沿用同一salt与recordId，避免重复创建业务证据。

尚未实现合约写入、钱包签名和生产授权。链日志没有主体真实性断言，后续更正/撤销也不能只依赖一次回执核验判断当前有效性。
