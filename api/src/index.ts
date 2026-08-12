import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  TURNSTILE_SECRET: string;
  RESEND_API_KEY: string;
  R2_PUBLIC_URL: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

function r2Url(env: Env, key: string) {
  const base = (env.R2_PUBLIC_URL || "").replace(/\/+$/, "");
  return `${base}/${key}`;
}

// ---- Email Verification ----
app.post("/api/auth/send-code", async (c) => {
  const { email } = await c.req.json();
  if (!email || !email.includes("@")) return c.json({ error: "请输入有效邮箱" }, 400);

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return c.json({ error: "该邮箱已注册" }, 409);

  const recent = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM verification_codes WHERE email = ? AND created_at > datetime('now', '-10 minutes')"
  ).bind(email).first();
  if ((recent as any).cnt >= 3) return c.json({ error: "发送太频繁，请 10 分钟后再试" }, 429);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await c.env.DB.prepare(
    "INSERT INTO verification_codes (email, code, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))"
  ).bind(email, code).run();

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Ustinus Blog <noreply@resend.dev>",
      to: [email],
      subject: "邮箱验证码 - Ustinus Blog",
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto"><h2>Ustinus Blog</h2><p>你的验证码是：</p><h1 style="letter-spacing:8px;color:#cc1a1a;font-size:32px">${code}</h1><p>10 分钟内有效。</p></div>`,
    }),
  });

  return c.json({ ok: true, message: "验证码已发送" });
});

app.post("/api/auth/verify-code", async (c) => {
  const { email, code } = await c.req.json();
  if (!email || !code) return c.json({ error: "缺少参数" }, 400);

  const record = await c.env.DB.prepare(
    "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
  ).bind(email, code).first();
  if (!record) return c.json({ error: "验证码错误或已过期" }, 400);

  await c.env.DB.prepare("UPDATE verification_codes SET used = 1 WHERE id = ?").bind((record as any).id).run();
  return c.json({ ok: true, verified: true });
});

// ---- Auth ----
app.post("/api/auth/register", async (c) => {
  const { username, email, password, "cf-turnstile-response": turnstileToken } = await c.req.json();
  if (!username || !email || !password) return c.json({ error: "缺少参数" }, 400);
  if (!turnstileToken) return c.json({ error: "请完成人机验证" }, 400);
  const ip = c.req.header("CF-Connecting-IP") || "";
  if (!(await verifyTurnstile(turnstileToken, c.env.TURNSTILE_SECRET, ip))) {
    return c.json({ error: "验证失败，请重试" }, 403);
  }

  const hash = await hashPassword(password);
  try {
    await c.env.DB.prepare(
      "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)"
    ).bind(username, email, hash).run();
    const user = await c.env.DB.prepare(
      "SELECT id, username, email, avatar_url FROM users WHERE email = ?"
    ).bind(email).first();
    const token = await generateToken(user);
    return c.json({ token, user });
  } catch (e: any) {
    if (e.message?.includes("UNIQUE")) return c.json({ error: "用户名或邮箱已存在" }, 409);
    return c.json({ error: "注册失败" }, 500);
  }
});

async function verifyTurnstile(token: string, secret: string, ip: string) {
  const form = new URLSearchParams();
  form.append("secret", secret);
  form.append("response", token);
  form.append("remoteip", ip);
  const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const vResult: any = await verify.json();
  return vResult.success === true;
}

app.post("/api/auth/login", async (c) => {
  const { email, password, "cf-turnstile-response": tsToken } = await c.req.json();
  if (!email || !password) return c.json({ error: "缺少参数" }, 400);
  if (tsToken) {
    const ip = c.req.header("CF-Connecting-IP") || "";
    if (!(await verifyTurnstile(tsToken, c.env.TURNSTILE_SECRET, ip))) {
      return c.json({ error: "验证失败，请重试" }, 403);
    }
  }
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user || !(await verifyPassword(password, user.password_hash as string)))
    return c.json({ error: "邮箱或密码错误" }, 401);
  const token = await generateToken(user);
  return c.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url },
  });
});

// ---- Delete Account ----
app.delete("/api/auth/account", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "未登录" }, 401);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "登录已过期" }, 401);

  const userId = payload.userId;
  const user = await c.env.DB.prepare("SELECT avatar_url FROM users WHERE id = ?").bind(userId).first();
  if (!user) return c.json({ error: "用户不存在" }, 404);

  const avatarUrl = (user as any).avatar_url as string;
  if (avatarUrl) {
    const key = avatarUrl.split("/").pop();
    if (key) await c.env.BUCKET.delete(`avatars/${key}`);
  }

  await c.env.DB.prepare("DELETE FROM comments WHERE user_id = ?").bind(userId).run();
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return c.json({ ok: true });
});

// ---- Avatar ----
app.post("/api/auth/avatar", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "未登录" }, 401);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "登录已过期" }, 401);

  const form = await c.req.formData();
  const file = form.get("file") as File;
  if (!file) return c.json({ error: "缺少文件" }, 400);

  const key = `avatars/${payload.userId}_${Date.now()}.${file.name.split(".").pop()}`;
  await c.env.BUCKET.put(key, file.stream());
  const url = r2Url(c.env, key);
  await c.env.DB.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").bind(url, payload.userId).run();
  return c.json({ url });
});

// ---- Comments ----
app.get("/api/comments", async (c) => {
  const slug = c.req.query("slug");
  if (!slug) return c.json({ comments: [] });
  const { results } = await c.env.DB.prepare(
    "SELECT c.id, c.content, c.parent_id, strftime('%Y-%m-%dT%H:%M:%SZ', c.created_at) as created_at, c.pinned, u.username, u.avatar_url, u.id as user_id FROM comments c JOIN users u ON c.user_id = u.id WHERE c.page_slug = ? ORDER BY c.pinned DESC, c.created_at ASC"
  ).bind(slug).all();
  return c.json({ comments: results });
});

app.post("/api/comments", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "未登录" }, 401);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "登录已过期" }, 401);
  const { page_slug, content, parent_id } = await c.req.json();
  if (!page_slug || !content) return c.json({ error: "缺少参数" }, 400);
  await c.env.DB.prepare(
    "INSERT INTO comments (user_id, page_slug, content, parent_id) VALUES (?, ?, ?, ?)"
  ).bind(payload.userId, page_slug, content, parent_id || null).run();
  return c.json({ ok: true });
});

app.delete("/api/comments/:id", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "未登录" }, 401);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "登录已过期" }, 401);
  const id = c.req.param("id");
  const comment = await c.env.DB.prepare("SELECT user_id FROM comments WHERE id = ?").bind(id).first();
  if (!comment) return c.json({ error: "评论不存在" }, 404);
  if (comment.user_id !== payload.userId && payload.username !== "Ustinus")
    return c.json({ error: "无权删除" }, 403);
  await c.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

app.patch("/api/comments/:id/pin", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "未登录" }, 401);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "登录已过期" }, 401);
  if (payload.username !== "Ustinus") return c.json({ error: "无权操作" }, 403);
  const id = c.req.param("id");
  const { pinned } = await c.req.json();
  await c.env.DB.prepare("UPDATE comments SET pinned = ? WHERE id = ?").bind(pinned ? 1 : 0, id).run();
  return c.json({ ok: true });
});

// ---- Image upload ----
app.post("/api/upload", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "未登录" }, 401);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "登录已过期" }, 401);

  const form = await c.req.formData();
  const file = form.get("file") as File;
  if (!file) return c.json({ error: "缺少文件" }, 400);

  const ext = file.name.split(".").pop() || "jpg";
  const key = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await c.env.BUCKET.put(key, file.stream());
  const url = r2Url(c.env, key);
  return c.json({ url });
});

// ---- Utils ----
async function generateToken(user: any) {
  return btoa(JSON.stringify({ userId: user.id, username: user.username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }));
}
async function verifyToken(token: string) {
  try {
    const p = JSON.parse(atob(token));
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
async function hashPassword(pw: string) {
  const data = new TextEncoder().encode(pw);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifyPassword(pw: string, hash: string) {
  return (await hashPassword(pw)) === hash;
}

export default app;
