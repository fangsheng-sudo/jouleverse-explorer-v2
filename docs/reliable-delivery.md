# 第 6 项：可靠交付的事件接收端 V1

接入方在收到上游重投的事件后，先写入持久收件箱，再向发送端确认。以「已配置的来源＋稳定事件编号」去重。上游负责排队和重投；此模块只负责接收判定，不提供发送队列或链上交易重试。

| 判定 | 含义 | 接入方动作 |
|---|---|---|
| 确认 | 首次写入已提交，或同编号同正文已经保存 | 按上游协议确认收到 |
| 重试 | 存储不可用或无法判断提交是否完成 | 不确认，使用原编号重投 |
| 人工复核 | 输入无效，或同编号收到不同正文 | 保留原记录，按运营规则隔离与告警 |

入口为 `receiveDelivery(inbox, event)`。先验证上游身份，再由接入方配置来源；编号需跨重投稳定，正文按原文保留，不重新序列化，最多 256 KiB（千二进制字节）。存储适配器须用数据库唯一键和原子写入防并发冲突，只在提交后返回成功。不能用内存集合代替持久化，也不能在适配器中夹带付款、发货等外部副作用。

测试使用临时 SQLite（本地数据库）文件，覆盖写入成功但确认丢失、数据库关闭重开、存储恢复、重复和冲突。样例数据库适配器仅用于测试；测试运行时需支持内置 SQLite 的 Node.js（脚本运行环境）。浏览器交付不引入数据库、网络服务或钱包依赖。

确认仅表示收件箱已保存，不表示业务已处理。上线前仍须联调实际队列的重投、确认与断点恢复，配置鉴权和持久化，并另做业务处理幂等、监控与链重组处理。本版未接入 FireFly（萤火虫框架），未发交易，未部署服务。

## 浏览器持久化适配器与恢复

`openIndexedDbInbox(name)` 提供原生 IndexedDB 的严格持久化事务适配器，不新增后端或 npm 依赖。record 在同一 readwrite 事务中比较/插入，只在事务完成后确认；跨连接由 IndexedDB 串行化事务。listPending(source, limit) 分页读取待处理项，markProcessed(source, eventId) 在业务幂等处理后标记；重复投递不会把已处理项恢复成待处理。close 后再次接收返回 retry。

```ts
import { openIndexedDbInbox } from './src/integration/indexeddb-inbox'
import { createDeliveryReceiver } from './src/integration/delivery-inbox'
const inbox = await openIndexedDbInbox('trusted-subscription')
const receive = createDeliveryReceiver(inbox, 'configured-source', { timeoutMs: 5000 })
// 先认证来源，再调用 receive(event)。业务消费按 evidence/event 唯一键独立幂等。
```

receiveDelivery 对每个存储实例保留最多 8 个未结束操作槽位，默认 5 秒截止时间。超时、连接关闭、存储异常均不确认；即使晚到的提交已完成，重试也必须用原编号。正文拒绝非法 UTF-16 代理字符，避免 UTF-8 替换造成身份歧义。

运行 npm test 可验证 SQLite 持久化契约；用 npm run dev 后在浏览器打开 tests/fixtures/delivery-inbox-browser.html 可验证真实 IndexedDB 的跨连接去重、关闭重开、待处理恢复和处理标记。该页面仅为本地测试夹具，不进入生产入口。浏览器清理/配额/隐私模式仍可能丢失存储，IndexedDB 不提供服务端灾备或外部副作用的 exactly-once 保证；重要业务须使用适当的持久数据库和幂等事务边界。
