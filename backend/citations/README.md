# Google Scholar 引用同步

独立 Worker `chentao-scholar-citations` 每天 UTC 00:00（北京时间08:00）读取一次 SerpApi 作者档案，写入既有 D1 数据库 `chentao-homepage-likes` 的新表 `scholar_citation_snapshots`。现有点赞 Worker 和表不作修改。

`GET /api/citations` 仅提供上次成功缓存，不调用 SerpApi；访客不能通过公开接口触发收费查询。定时请求固定使用作者ID `krmeL-4AAAAJ`、`num=100`、`no_cache=true`。凭据通过 Worker Secret `SERPAPI_API_KEY` 配置，源码不包含凭据。

7篇既有论文的 Scholar ID 已逐篇实测核对。未显示被引数时保存 null；SSRN预印本尚未列入该档案时保持 not_in_profile，两者在主页均显示“—”，不伪造0。若预印本以后以唯一完全一致标题出现在该档案，会接入该条目。网络、限额、解析、缺项或身份校验失败时不改写缓存；合法的引用次数下降照常接受。

部署步骤：

1. 在D1执行 `schema.sql`，只新增独立缓存表。
2. 创建Worker并绑定既有数据库，变量名 `DB`。
3. 上传 `worker.js`，添加 `SERPAPI_API_KEY` Secret。
4. 添加Cron表达式 `0 0 * * *`，启用workers.dev地址。
5. 写入已核验的初始快照，核对 `/api/citations`，再发布主页的引用链接和脚本。

自动部署所需权限仅为目标账户的 Workers Scripts Edit、D1 Edit；不得把API令牌、SerpApi凭据或凭据文件放入源码/提交。

测试：在包含Node.js 24及以上的环境运行 `node --test worker.test.mjs client.test.mjs`。测试使用本地SQLite和模拟上游，不调用生产数据库或真实SerpApi。
