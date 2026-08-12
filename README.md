# Ustinus Comment System

一套基于 Cloudflare Workers + D1 + R2 的自建博客评论系统，支持邮箱注册、Turnstile 人机验证、评论置顶、图片上传、Markdown 预览等功能。

## 预览

| 亮色主题 | 暗色主题 |
|:---:|:---:|
| ![亮色主题](https://pub-c1824a6cf1a3422a928b777bbe1c7ef6.r2.dev/covers/comment-light.png) | ![暗色主题](https://pub-c1824a6cf1a3422a928b777bbe1c7ef6.r2.dev/covers/comment-dark.png) |

## 特性

- **邮箱注册/登录** — Resend 发送 6 位验证码，无需第三方账号
- **Turnstile 人机验证** — Cloudflare 免费 CAPTCHA，注册和登录均需验证
- **完整 Markdown 预览** — 支持表格、任务列表、KaTeX 数学公式、Callout 提示框
- **图片上传** — 评论中上传图片到 R2
- **头像管理** — 点击头像即可更换
- **评论置顶** — 管理员可置顶任意评论
- **多管理员** — 逗号分隔配置管理员用户名
- **零运维成本** — 跑在 Cloudflare 免费额度上

## 架构

```
Svelte 组件 ──→ Hono Worker (api.yourdomain.com)
                    ├── D1 Database (users, comments, verification_codes)
                    ├── R2 Bucket   (avatars, comment images)
                    ├── Resend API  (verification emails)
                    └── Turnstile API (siteverify)
```

## 快速开始

### 1. 前置条件

- Cloudflare 账号
- Node.js >= 22
- 已配置的域名的 DNS（在 Cloudflare 上）

### 2. 创建 Cloudflare 资源

```bash
# 创建 D1 数据库
npx wrangler d1 create your-db-name

# 创建 R2 存储桶
npx wrangler r2 bucket create your-bucket-name

# 创建 Turnstile Widget
# 访问 https://dash.cloudflare.com/ → Turnstile → Add Widget
# 记录 sitekey 和 secret key

# 获取 Resend API Key
# 注册 https://resend.com → API Keys → Create API Key
```

### 3. 初始化数据库

```bash
npx wrangler d1 execute your-db-name --remote --file=./schema.sql
```

### 4. 配置并部署 API Worker

编辑 `api/wrangler.jsonc`，填入你的实际值：

```jsonc
{
  "routes": [{ "pattern": "api.yourdomain.com/*", "zone_id": "xxx" }],
  "vars": { "R2_PUBLIC_URL": "https://your-bucket.r2.dev" },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "your-db-name",
    "database_id": "xxx"
  }],
  "r2_buckets": [{
    "binding": "BUCKET",
    "bucket_name": "your-bucket-name"
  }]
}
```

设置密钥：

```bash
cd api
npm install

# Turnstile secret
npx wrangler secret put TURNSTILE_SECRET

# Resend API key
npx wrangler secret put RESEND_API_KEY

# 管理员用户名（逗号分隔多个），可选，默认为 Ustinus
npx wrangler secret put ADMIN_USERNAMES

# 部署
npx wrangler deploy
```

### 5. 前端集成

将 `frontend/UstinusComment.svelte` 复制到你的 Svelte / Astro 项目中，然后使用：

```svelte
<UstinusComment
  pageSlug={postSlug}
  apiUrl="https://api.yourdomain.com"
  turnstileSitekey="0x4AAAAxxx..."
  adminUsernames={["YourName"]}
  client:load
/>
```

| Prop | 默认值 | 说明 |
|------|--------|------|
| `pageSlug` | `""` | 当前页面唯一标识，用于关联评论 |
| `apiUrl` | `""` | API Worker 地址 |
| `turnstileSitekey` | `""` | Turnstile 站点密钥 |
| `adminUsernames` | `[]` | 管理员用户名列表，这些用户可置顶/删除任意评论 |

### 6. 加载 Turnstile 脚本

在页面 `<head>` 或 Layout 中引入 Turnstile JS：

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/send-code` | 发送邮箱验证码 |
| `POST` | `/api/auth/verify-code` | 校验验证码 |
| `POST` | `/api/auth/register` | 注册账号 |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/avatar` | 上传头像 |
| `DELETE` | `/api/auth/account` | 注销账号 |
| `GET` | `/api/comments?slug=xxx` | 获取评论列表 |
| `POST` | `/api/comments` | 发表评论 |
| `DELETE` | `/api/comments/:id` | 删除评论 |
| `PATCH` | `/api/comments/:id/pin` | 置顶/取消置顶（管理员） |
| `POST` | `/api/upload` | 上传图片（评论插图） |

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `TURNSTILE_SECRET` | Turnstile secret key | 是 |
| `RESEND_API_KEY` | Resend API key | 是 |
| `R2_PUBLIC_URL` | R2 公开访问域名 | 是 |
| `ADMIN_USERNAMES` | 管理员用户名，逗号分隔 | 否（默认 `Ustinus`） |

## 安全

- 密码使用 SHA-256 哈希存储
- Token 7 天过期
- 同邮箱 10 分钟内最多 3 次验证码
- 注册前必须通过邮箱验证
- Turnstile 验证注册和敏感操作

## 自定义邮件模板

邮件发送逻辑在 `api/src/index.ts` 的 `/api/auth/send-code` 中，可自行修改 `from`、`subject` 和 `html` 内容。

## License

MIT
