# Ustinus Comment System

一套基于 Cloudflare Workers + D1 + R2 的自建博客评论系统，支持邮箱注册、Turnstile 人机验证、评论置顶、图片上传、Markdown 预览等功能。

## 预览

| 亮色主题 | 暗色主题 |
|:---:|:---:|
| ![亮色主题](https://pub-c1824a6cf1a3422a928b777bbe1c7ef6.r2.dev/covers/comment-light.png) | ![暗色主题](https://pub-c1824a6cf1a3422a928b777bbe1c7ef6.r2.dev/covers/comment-dark.png) |

## 特性

- **邮箱注册/登录** — Resend 发送 6 位验证码，无需第三方账号
- **Turnstile 人机验证** — Cloudflare 免费 CAPTCHA，注册和登录均需验证
- **完整 Markdown 预览** — 表格、任务列表、KaTeX 数学公式、Callout 提示框
- **图片上传** — 评论中上传图片到 R2，自动插入 Markdown 语法
- **头像管理** — 点击头像即可更换，上传到 R2
- **评论置顶** — 管理员可置顶/取消置顶任意评论
- **多管理员** — 逗号分隔配置管理员用户名
- **零运维成本** — 全部跑在 Cloudflare 免费额度上

## 架构

```
Svelte 组件 ──→ Hono Worker (api.yourdomain.com)
                    ├── D1 Database   (users, comments, verification_codes)
                    ├── R2 Bucket     (avatars, uploaded images)
                    ├── Resend API    (verification emails)
                    └── Turnstile API (siteverify)
```

## 快速开始

### 前置条件

- Cloudflare 账号
- 一个托管在 Cloudflare 上的域名（用于绑 API 路由和 R2 公开访问）
- Node.js >= 22
- [Resend](https://resend.com) 账号（免费注册，无需绑卡）

### 1. 克隆项目

```bash
git clone https://github.com/YCstudent/ustinus-comment.git
cd ustinus-comment
```

### 2. 创建 Cloudflare 资源

**D1 数据库**：

```bash
npx wrangler d1 create ustinus-comment-db
```

记下输出的 `database_id` 和 `database_name`，后面配置 `wrangler.jsonc` 要用。

**R2 存储桶**：

```bash
npx wrangler r2 bucket create ustinus-comment-bucket
```

Cloudflare Dashboard → R2 → 你的桶 → Settings → Public Access → 开启 R2.dev 子域名。记下公开 URL（格式 `https://pub-xxxx.r2.dev`）。

**Turnstile Widget**：

Cloudflare Dashboard → Turnstile → Add Widget：
- Domains 填你的博客域名 + `localhost`（方便本地开发）
- Widget Mode 选 Managed

拿到 **Sitekey**（前端用）和 **Secret Key**（后端用）。

**Resend API Key**：

[resend.com/api-keys](https://resend.com/api-keys) → Create API Key。免费 100 封/天。

> Resend 试用期只能发到注册邮箱，绑定域名后可发任意邮箱。

### 3. 初始化数据库

```bash
npx wrangler d1 execute ustinus-comment-db --remote --file=./schema.sql
```

### 4. 配置 wrangler.jsonc

编辑 `api/wrangler.jsonc`：

```jsonc
{
  "name": "ustinus-comment-api",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [
    {
      "pattern": "api.你的域名.com/*",
      "zone_id": "你的 Zone ID"
    }
  ],
  "vars": {
    "R2_PUBLIC_URL": "https://pub-xxxx.r2.dev"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ustinus-comment-db",
      "database_id": "你的 database_id"
    }
  ],
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "ustinus-comment-bucket"
    }
  ]
}
```

> Zone ID 在 Cloudflare Dashboard 域名概览页右侧栏。

### 5. 设置密钥并部署

```bash
cd api
npm install

npx wrangler secret put TURNSTILE_SECRET    # Turnstile Secret Key
npx wrangler secret put RESEND_API_KEY      # Resend API Key
npx wrangler secret put ADMIN_USERNAMES     # 管理员用户名，逗号分隔（可选，默认 Ustinus）

npx wrangler deploy
```

### 6. 前端集成

将 `frontend/UstinusComment.svelte` 复制到你的 Astro / Svelte 项目的 `src/components/comment/` 下。

**加载 Turnstile 脚本**：在 Layout 的 `<head>` 中添加：

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

**在文章页使用**（以 Astro 为例，`src/pages/posts/[...slug].astro`）：

```svelte
<UstinusComment
  pageSlug={postSlug}
  apiUrl="https://api.你的域名.com"
  turnstileSitekey="你的 Turnstile Sitekey"
  adminUsernames={["你的用户名"]}
  client:load
/>
```

### Props

| Prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pageSlug` | string | 是 | 页面唯一标识，不同文章用不同 slug 区分评论 |
| `apiUrl` | string | 是 | API Worker 地址，不要末尾带 `/` |
| `turnstileSitekey` | string | 是 | Turnstile 站点密钥，前端公开 |
| `adminUsernames` | string[] | 否 | 管理员用户名数组，可置顶/删除任意评论 |

### 7. 验证

打开文章页，确认以下流程正常：
1. 注册 → 收验证码 → 验证邮箱 → 登录
2. 发表评论 → Markdown 预览 → 上传图片
3. 管理员用户可看到置顶和删除按钮

邮件没收到？检查 Resend Dashboard → Email Log。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/send-code` | 发送邮箱验证码（10 分钟有效，同邮箱 10 分钟限 3 次） |
| `POST` | `/api/auth/verify-code` | 校验验证码 |
| `POST` | `/api/auth/register` | 注册（需 Turnstile token，密码 SHA-256） |
| `POST` | `/api/auth/login` | 登录（可选 Turnstile） |
| `POST` | `/api/auth/avatar` | 上传头像到 R2 |
| `DELETE` | `/api/auth/account` | 注销账号（清头像、删评论） |
| `GET` | `/api/comments?slug=xxx` | 获取评论（置顶优先） |
| `POST` | `/api/comments` | 发表评论 |
| `DELETE` | `/api/comments/:id` | 删除评论（本人或管理员） |
| `PATCH` | `/api/comments/:id/pin` | 置顶/取消（仅管理员） |
| `POST` | `/api/upload` | 上传评论插图到 R2 |

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `TURNSTILE_SECRET` | Turnstile Secret Key | 是 |
| `RESEND_API_KEY` | Resend API Key | 是 |
| `R2_PUBLIC_URL` | R2 公开访问域名（`vars` 中的普通变量，不是 secret） | 是 |
| `ADMIN_USERNAMES` | 管理员用户名，逗号分隔 | 否（默认 `Ustinus`） |

## 安全

- 密码 SHA-256 哈希，不存明文
- Token Base64 编码 JSON，7 天过期
- 注册前必须通过邮箱验证码
- 同邮箱 10 分钟内最多 3 条验证码
- Turnstile 前后端双重校验

## 自定义

邮件内容在 `api/src/index.ts` 的 `/api/auth/send-code` 中，可修改 `from`、`subject` 和 HTML 模板。

## License

MIT
