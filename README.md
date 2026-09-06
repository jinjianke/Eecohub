# EecoHub

一个面向静态网站的轻量发布工具：用户输入卡密，上传 HTML 或 ZIP，应用调用热铁盒服务部署并返回固定网址。

## 已实现功能

- SQLite 卡密数据库：`.runtime/eecohub.sqlite`
- 每次批量生成 1–100 张卡密
- 卡密状态：未使用、使用中、已过期、已停用
- 首次部署成功后自动激活
- 激活后有效期 365 天，覆盖部署不会重置到期时间
- 管理后台支持停用、恢复、立即过期、延期 365 天
- HTML / ZIP 上传、安全检查、热铁盒部署和在线验证
- 新卡密首次部署时，若本地没有可用站点，会调用热铁盒 API 自动创建随机站点
- 自动创建后写入 SQLite 并绑定卡密；部署失败仍保留站点供下次重试
- 同一卡密覆盖更新，网址保持不变

## 启动

```powershell
cd D:\Project\EecoHub
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' run dev
```

- 用户上传页面：`http://localhost:3000`
- 卡密管理后台：`http://localhost:3000/admin`

管理员密码保存在本机：

```text
D:\Project\EecoHub\.runtime\admin-password.txt
```

该文件已由 `.gitignore` 排除。请勿公开或提交。

## 配置

开发环境默认读取根目录 `key.txt` 中的热铁盒 API Key。该文件已加入 `.gitignore`，现有 Key 不会被删除。

`.env.local` 配置示例：

```env
RTH_API_KEY=你的热铁盒Key
RTH_SITE=eecohub02
RTH_PUBLIC_URL=https://eecohub02.rth1.xyz
EECOHUB_CARD_CODE=旧测试卡密（仅用于首次迁移）
EECOHUB_ADMIN_PASSWORD=随机强密码
```

## 卡密规则

- 格式：`EH-XXXX-XXXX-XXXX`
- 数据库只保存 SHA-256 哈希和最后四位，不保存完整明文
- 新卡密只在生成结果中完整显示一次，必须立即复制保存
- 未使用卡密验证成功后仍保持未使用
- 第一次成功部署时记录 `activated_at`，并设置 `expires_at = activated_at + 365 天`
- 以后覆盖部署只增加部署次数，不重新计算有效期
- 过期或停用卡密不能验证或部署

## 站点分配规则

- 卡密已有站点：直接复用，网址不变
- SQLite 中有未分配站点：优先使用本地站点池
- 本地没有可用站点：通过热铁盒 API 创建 `eeco-xxxxxxxx` 随机站点并绑定卡密
- 热铁盒创建成功但文件部署失败：卡密仍为“未使用”，已创建站点会保留，用户下次上传时继续复用
- 管理后台显示的是 SQLite 本地站点统计，不代表热铁盒账号的全部远程站点

## 上传约束

- 上传文件最大 20MB
- 解压后最大 50MB
- 最多 1000 个文件
- 单文件最大 10MB
- 网站根目录必须包含 `index.html`
- 禁止后端程序、可执行文件、脚本程序和嵌套压缩包

## 安全说明

`.runtime/`、`.env.local` 和 `key.txt` 均已加入 `.gitignore`。部署时仅上传处理后的静态网站目录，不上传项目源代码、卡密数据库、管理员密码或热铁盒 Key。
