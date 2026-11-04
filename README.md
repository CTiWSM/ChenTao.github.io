# 陈涛 · 个人学术主页

[访问主页](https://ctiwsm.github.io/ChenTao.github.io/)

中英文静态学术主页，包含个人简介、教育背景、论文与授权专利。

主网址默认显示 English；[中文页面](https://ctiwsm.github.io/ChenTao.github.io/zh.html)使用独立地址，不保存语言偏好。

## 文件

- `docs/index.html`：英文页面。
- `docs/zh.html`：中文页面。
- `docs/styles.css`：电脑与手机排版。
- `docs/likes.js`：整站点赞交互。
- `docs/metric-effects.js`：IF≥15 边框动效的可见性与动态偏好控制。
- `docs/citation-counts.js`：从Cloudflare读取Google Scholar被引缓存。
- `docs/assets/citations-initial.json`：公开初始引用快照，用于本地预览及静态回退。
- `docs/assets/`：个人照片与网站图标。
- `docs/.nojekyll`：直接发布静态文件。
- `docs/google8081bf037f705923.html`：Google Search Console 网站所有权验证文件；验证后继续保留。
- `backend/`：Cloudflare Worker 源码、D1 初始化 SQL 与测试。

## 更新与发布

修改 `docs/` 下的文件并提交至 `master`。GitHub Pages 发布源为 **Deploy from a branch → master → /docs**。

论文署名中，`#` 表示同等贡献，`*` 表示通讯作者，Tao Chen 加粗。更新内容时按正式论文和授权材料核对。

中文发表来源标签显示 IF、中科院大类分区和 CCF，英文显示 IF 与 JCR。指标采用经核对的本地参考数据快照，缺失项省略，不表示论文发表年度指标。配色参考 Impact Overlay，IF≥15 标签增加缓慢的红金色边框流光。

动效由访客浏览器运行，不请求后端或写入数据库；标签离开视口、页面进入后台时暂停，尊重“减少动态效果”设置。无 JavaScript 或所需浏览器功能时保留静态指标，打印和强制高对比度模式不显示流光。

正文与语言切换无需构建步骤或 JavaScript 框架。点赞使用少量 JavaScript，通过 Cloudflare Worker 写入 D1；中英文共享累计数量。

每篇论文末尾显示Google Scholar被引数和来源链接。独立Worker每日UTC00:00（北京时间08:00）通过SerpApi更新D1缓存；访客只读取缓存，不触发上游查询，也不需要每天提交Git。同步失败时保留已知快照及成功日期；空白计数和未列入Scholar档案的条目显示“—”，不伪造0。

引用Worker、缓存表、配置与测试位于 `backend/citations/`；SerpApi凭据使用Cloudflare Secret配置，部署令牌和任何真实凭据不属于发布内容。

同一浏览器的标识用于减少重复点赞；清除存储、更换浏览器或主动生成新标识仍可能再次点赞，因此不是严格的独立访客统计。不要在仓库中提交凭据或数据库内容。
