# 陈涛 · 个人学术主页

[访问主页](https://ctiwsm.github.io/ChenTao.github.io/)

中英文静态学术主页，包含个人简介、教育背景、代表性论文与授权专利。

主网址默认显示 English；[中文页面](https://ctiwsm.github.io/ChenTao.github.io/zh.html)使用独立地址，不保存语言偏好。

## 文件

- `docs/index.html`：英文页面。
- `docs/zh.html`：中文页面。
- `docs/styles.css`：电脑与手机排版。
- `docs/likes.js`：整站点赞交互。
- `docs/assets/`：个人照片与网站图标。
- `docs/.nojekyll`：直接发布静态文件。
- `backend/`：Cloudflare Worker 源码、D1 初始化 SQL 与测试。

## 更新与发布

修改 `docs/` 下的文件并提交至 `master`。GitHub Pages 发布源为 **Deploy from a branch → master → /docs**。

论文署名中，`#` 表示同等贡献，`*` 表示通讯作者，Tao Chen 加粗。更新内容时按正式论文和授权材料核对。

中文发表来源标签显示 IF、中科院大类分区和 CCF，英文显示 IF 与 JCR。指标采用经核对的本地参考数据快照，缺失项省略，不表示论文发表年度指标。标签静态显示，配色参考 Impact Overlay。

正文与语言切换无需构建步骤或 JavaScript 框架。点赞使用少量 JavaScript，通过 Cloudflare Worker 写入 D1；中英文共享累计数量。

同一浏览器的标识用于减少重复点赞；清除存储、更换浏览器或主动生成新标识仍可能再次点赞，因此不是严格的独立访客统计。不要在仓库中提交凭据或数据库内容。
