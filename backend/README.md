# 个人主页点赞后端

本目录是供 Cloudflare 控制台手动部署的后端文件，不属于 GitHub Pages 的静态发布内容。准备这些文件不会改动云端资源。

## 对应的现有资源

- Worker：`chentao-homepage-api`
- API：`https://chentao-homepage-api.c708978499.workers.dev/api/likes`
- D1：`chentao-homepage-likes`
- Worker 的 D1 绑定名：`DB`

## 手动部署顺序

1. 打开上述 D1 数据库的控制台，按顺序执行 `schema.sql`。可分段执行；每个 `CREATE TRIGGER ... BEGIN ... END;` 必须作为完整语句执行。脚本不包含示例点赞，重新运行不会清零已有数据。
2. 执行 `check.sql` 核对表和触发器。全新数据库的 `total` 和 `stored_likes` 都应为 `0`，`totals_match` 应为 `1`。
3. 在现有 Worker 的绑定设置中确认 D1 绑定名为 `DB`，且指向上述数据库。
4. 打开 Worker 代码编辑器，用 `worker.js` 的完整内容替换默认示例代码并部署。文件已经包含 ES module 的默认导出，不需要第三方依赖或构建。
5. 浏览器打开 API 地址，应看到 `{"site":"chentao-homepage","count":0,"liked":false}`；已有真实点赞时，`count` 是实际总数。若返回 `503`，先检查数据库表、触发器和 `DB` 绑定，再检查部署状态。

前端无需 Cloudflare API Token。不要把账号凭据放入静态网站、此目录或 GitHub 仓库。

## API 约定

| 请求 | 返回 |
| --- | --- |
| `GET /api/likes`，不带访客标识 | `{site,count,liked:false}` |
| `GET /api/likes`，请求头 `X-Visitor-Id` 为 UUIDv4 | `{site,count,liked}` |
| `POST /api/likes`，JSON 为 `{visitorId: UUIDv4}` | `{site,count,liked:true,added}`；新增返回 `201`，已存在返回 `200` |
| `OPTIONS /api/likes` | 合法预检返回 `204` |

站点标识固定为 `chentao-homepage`，中文和英文前端共享总数。API 路径不接受查询参数或尾部斜线；POST 正文上限为 256 字节，必须使用 `application/json`，只接受 `visitorId` 字段。

允许的浏览器来源仅包括：

- `https://ctiwsm.github.io`
- `http://127.0.0.1:8765`
- `http://localhost:8765`

POST 必须带有其中一个精确匹配的 `Origin`。GET 允许没有 `Origin`，便于公开验收。来源不包含 URL 路径，不能填写完整主页 URL。

同一 UUID 的大小写会统一后再计算 SHA-256；数据库只保存散列值。唯一键处理重试和并发重复请求，触发器原子更新总数，页面读取总数时不会扫描全部点赞记录。后端代码不记录原始 IP、邮箱或原始 UUID。

匿名浏览器 UUID 用于减少重复点击，不代表“每人一次”；清除浏览器存储、更换浏览器或主动生成新标识仍能再次点赞。CORS 不是鉴权或完整防刷方案。此版本没有用户登录、撤赞接口或验证码。

## 本地测试

使用提供 `node:sqlite` 的 Node.js 24 或更新版本，在本目录运行 `npm test`，或直接运行 `node --test worker.test.mjs`。测试只使用内存中的真实 SQLite 数据库，不访问 Cloudflare，不给云端增加测试点赞。

`tests/sqlite-d1.mjs` 导出 `SQLiteD1`，供本地 HTTP 验收工具复用。默认使用内存数据库；如需跨请求或服务重启保存测试状态，可显式传入 `{ filename: "测试数据库绝对路径" }`，测试文件应放在站点的 `_cache/` 中。该适配只供本地测试，不应粘贴到 Cloudflare Worker。

测试覆盖 SQL 重复执行保留数据、同标识并发去重、不同标识累计、大小写归一化、事务失败回滚、正文限制、输入校验及 CORS。它验证 Worker 逻辑和 SQL，不替代实际 D1 绑定与公开端点验收。
