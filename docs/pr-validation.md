# 合并请求自动验收门禁

状态：#69 已提交，原提交 e6a160b 的首次远端自动验收通过；本次边界修复尚未推送及远端验收，仍待维护者审计、合入及必需状态检查配置。

## 触发与验收范围

- `.github/workflows/pr-validation.yml`：目标为 `explorer-v2` 的合并请求、合并队列检查、手动触发。
- 不设置路径排除：文档修改同样验证，避免必需检查因路径过滤一直等待。
- 默认 checkout 使用平台生成的合并结果，不手动改成作者分支；因此能捕捉与主线组合后的编号或构建冲突。无法生成合并结果时需要先解决冲突，缺少检查不等于通过。
- 按顺序运行 `npm ci`、`node scripts/check-feature-roadmap.ts`、`npm test`、`npm run build`。任一步失败都会阻断任务，不使用吞退出码的管道、不使用 `continue-on-error`。
- Node 主版本与现有部署保持 22；不变更 package.json / package-lock.json，不新增 npm 依赖。
- 15 分钟超时；同一请求有新提交时取消旧验证，避免排队浪费。工作流名称及任务名称稳定，供必需检查选择。

## 安全边界

- 使用 `pull_request`，不是 `pull_request_target`；只读 `contents` 权限。
- 使用平台托管的临时 Linux runner，不使用可接触内部环境的自托管 runner。
- checkout 不保留凭据；官方 checkout/setup-node 固定到已核实发布标签对应的提交。
- 不引用业务密钥、不签名、不访问钱包、不请求链上节点；不使用环境授权、不申请 Pages 或 OIDC 权限。
- 不发布评论、提交、部署或任何产物；不建立可被特权部署消费的共享缓存/产物通道。
- 不修改原 `deploy-pages.yml`；验证和部署是两个独立工作流。依赖安装仍需互联网，并执行依赖生命周期脚本，这不等于完全隔离互联网或防止恶意依赖；保护边界是临时运行器、无业务密钥和最小权限。
- 工作流和检查器同样属于被审代码，贡献者可以修改它们；通过检查不是安全认证，维护者仍须审核 CI/依赖变更。建议维护者按现有治理设置这类文件的审阅责任。

## 路线图检查器

`node scripts/check-feature-roadmap.ts` 默认检查当前目录，也可传入仓库根目录（主要用于测试）。

要求：

1. §一包含唯一的状态总览章节、表头和自检标记。
2. Markdown 表格表头、分隔行相邻且没有空行截断，分隔行支持合法对齐标记并要求五列，模块编号从 1 连续且唯一。
3. `src/views/` 直接目录中的每个 `.vue` 文件在该表中以反引号包裹的精确文件名或 src/views/ 下的直接文件路径登记（其他目录同名不算）。别处提到不算覆盖。
4. 自检句的视图数、末尾编号与实际代码和表格一致。
5. 缺文件、空视图目录、未知格式或漏项时非零退出，不输出假成功。

该工具检查登记完整性，不验证“已上线”等状态描述真实性，也不核对源码业务正确性。若未来迁移为嵌套视图目录，需同时扩展枚举与测试，当前不宣称覆盖嵌套目录。

与 #66 的守卫测试目的相同：保留现有测试即可，新检查器额外提供真实命令退出码与完整 Markdown 表格结构检查；不应删除已有守卫来让错误编号变绿。

## 平台启用步骤（维护者）

1. 审核并合入本工作流；也检查 Actions 组织/仓库策略允许固定的官方 action。
2. 在真实合并请求上确认 `PR validation / Validate changes` 实际出现并运行成功；平台界面可能仅显示任务名 `Validate changes`，应按首次运行记录选择。
3. GitHub 仓库设置 → Rules / Rulesets 或 Branches，针对 `explorer-v2` 添加“必须通过状态检查”，选择上述实际检查。此项是管理员操作，本代码不自动设置。
4. 根据项目要求选择分支需最新或使用合并队列；队列事件已配置，但本项目是否启用队列由维护者决定。
5. 首次贡献者或外部分支可能需要人工批准运行；显示“等待批准/未运行/冲突”均不能记作测试通过。
6. 在无部署、无密钥的验证请求中故意制造类型或测试错误，确认平台拒绝通过；恢复后再核对绿色记录。

未推送前不能声称上述平台验收已完成，也不能保证仓库管理员或付费计划允许所有规则选项。

## 并行请求整合

当前基线为 `41aed3f`，#64—#68 尚未合入。此项不新增页面、路由或工具卡片，不抢占路线图模块编号。

路线图会与并行文档修改相邻：合并时保留本检查器、已有登记及其他请求的语义脚本改进，保留所有模块并统一编号；不要整份覆盖。新检查器会在组合树中检查实际视图数，不能预填其他分支的视图数。

## 官方参考

- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- https://github.com/actions/checkout/tree/v4.3.1
- https://github.com/actions/setup-node/tree/v4.4.0
