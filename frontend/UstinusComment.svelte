<script>
	import { onMount } from "svelte";

	let turnstileRendered = false;

	let {
		pageSlug = "",
		apiUrl = "",
		turnstileSitekey = "",
		adminUsernames = [],
	} = $props();

	const API = apiUrl.replace(/\/+$/, "");

	let comments = $state([]);
	let user = $state(null);
	let token = $state("");
	let content = $state("");
	let loading = $state(true);
	let submitting = $state(false);
	let showLogin = $state(false);
	let loginEmail = $state("");
	let loginPassword = $state("");
	let loginConfirm = $state("");
	let loginError = $state("");
	let registerMode = $state(false);
	let registerName = $state("");
	let showEmoji = $state(false);
	let showPreview = $state(false);
	let uploading = $state(false);
	let verifyCode = $state("");
	let showPassword = $state(false);
	let showConfirmPassword = $state(false);
	let emailVerified = $state(false);
	let sendingCode = $state(false);
	let verifying = $state(false);
	let codeSent = $state(false);
	let loggingIn = $state(false);
	let registering = $state(false);

	const isAdmin = () => user && adminUsernames.includes(user.username);

	const emojis = [
		"😀","😂","🤣","😊","😍","🤩","😎","🤔","😅","😭","🥳","😇","🙃","🤗","😴","🤐","😤","😡",
		"💀","👻","👽","🤖","🎉","❤️","🔥","⭐","💯","✅","❌","🤝","👏","🙌","💪","🧠","👀",
		"🌈","☀️","🌙","⚡","💧","🍕","🎮","📚","💻","🚀","🎯","🏆","👍",
	];

	$effect(() => {
		if (showLogin && !turnstileRendered) {
			setTimeout(() => {
				const el = document.getElementById("ts-container");
				if (!el) return;
				if (window.turnstile) {
					el.innerHTML = "";
					const div = document.createElement("div");
					div.className = "cf-turnstile";
					div.setAttribute("data-sitekey", turnstileSitekey);
					el.appendChild(div);
					const isDark = document.documentElement.classList.contains("dark");
					window.turnstile.render(div, {
						size: "normal",
						theme: isDark ? "dark" : "light",
					});
					turnstileRendered = true;
				}
			}, 300);
		}
		if (!showLogin) turnstileRendered = false;
	});

	$effect(() => {
		if (showPreview && content) {
			setTimeout(async () => {
				const mathEls = document.querySelectorAll("[data-latex]:not([data-rendered])");
				if (mathEls.length === 0) return;
				if (!window.katex) {
					if (!document.querySelector("#katex-css")) {
						const link = document.createElement("link");
						link.id = "katex-css";
						link.rel = "stylesheet";
						link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
						document.head.appendChild(link);
					}
					await new Promise((res) => {
						const s = document.createElement("script");
						s.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
						s.onload = res;
						document.head.appendChild(s);
					});
				}
				mathEls.forEach((el) => {
					try {
						const latex = el.getAttribute("data-latex");
						if (!latex) return;
						window.katex.render(latex, el, {
							displayMode: el.classList.contains("katex-block"),
							throwOnError: false,
						});
						el.setAttribute("data-rendered", "1");
					} catch (e) {}
				});
			}, 150);
		}
	});

	onMount(async () => {
		const savedToken = localStorage.getItem("ustinus_token") || "";
		const savedUser = localStorage.getItem("ustinus_user");
		if (savedToken && savedUser) {
			token = savedToken;
			user = JSON.parse(savedUser);
		}
		await loadComments();
	});

	async function loadComments() {
		loading = true;
		try {
			const res = await fetch(`${API}/api/comments?slug=${encodeURIComponent(pageSlug)}`);
			const data = await res.json();
			comments = data.comments || [];
		} catch (e) {
			console.error(e);
		}
		loading = false;
	}

	async function doLogin() {
		loginError = "";
		const tsToken = window.turnstile?.getResponse?.();
		if (tsToken && !tsToken) {} // ensure turnstile is checked
		if (!tsToken) return (loginError = "请完成人机验证");
		loggingIn = true;
		try {
			const res = await fetch(`${API}/api/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: loginEmail, password: loginPassword, "cf-turnstile-response": tsToken }),
			});
			const data = await res.json();
			if (data.error) { loginError = data.error; window.turnstile?.reset(); return; }
			user = data.user;
			token = data.token;
			localStorage.setItem("ustinus_token", token);
			localStorage.setItem("ustinus_user", JSON.stringify(user));
			showLogin = false;
			loginEmail = "";
			loginPassword = "";
		} catch (e) {
			loginError = "网络错误，请重试";
			window.turnstile?.reset();
		} finally {
			loggingIn = false;
		}
	}

	async function sendCode() {
		sendingCode = true;
		loginError = "";
		try {
			const res = await fetch(`${API}/api/auth/send-code`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: loginEmail }),
			});
			const data = await res.json();
			if (data.error) { loginError = data.error; } else { codeSent = true; loginError = ""; }
		} catch (e) {
			loginError = "发送失败，请重试";
		}
		sendingCode = false;
	}

	async function verifyEmailCode() {
		verifying = true;
		loginError = "";
		try {
			const res = await fetch(`${API}/api/auth/verify-code`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: loginEmail, code: verifyCode }),
			});
			const data = await res.json();
			if (data.error) { loginError = data.error; } else { emailVerified = true; loginError = ""; }
		} catch (e) {
			loginError = "验证失败，请重试";
		}
		verifying = false;
	}

	async function doRegister() {
		loginError = "";
		if (!registerName.trim()) return (loginError = "请输入用户名");
		if (registerName.trim().length < 2) return (loginError = "用户名至少 2 个字符");
		if (!loginEmail.includes("@")) return (loginError = "请输入有效邮箱");
		if (!emailVerified) return (loginError = "请先验证邮箱");
		if (loginPassword.length < 6) return (loginError = "密码至少 6 位");
		if (loginPassword !== loginConfirm) return (loginError = "两次密码不一致");
		const tsToken = window.turnstile?.getResponse?.();
		if (!tsToken) return (loginError = "请完成人机验证");
		registering = true;
		try {
			const res = await fetch(`${API}/api/auth/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: registerName.trim(),
					email: loginEmail,
					password: loginPassword,
					"cf-turnstile-response": tsToken,
				}),
			});
			const data = await res.json();
			if (data.error) { loginError = data.error; window.turnstile?.reset(); return; }
			user = data.user;
			token = data.token;
			localStorage.setItem("ustinus_token", token);
			localStorage.setItem("ustinus_user", JSON.stringify(user));
			showLogin = false;
			registerMode = false;
			loginEmail = "";
			loginPassword = "";
			loginConfirm = "";
			registerName = "";
			verifyCode = "";
			emailVerified = false;
			codeSent = false;
		} catch (e) {
			loginError = "网络错误，请重试";
			window.turnstile?.reset();
		} finally {
			registering = false;
		}
	}

	async function doDeleteAccount() {
		if (!confirm("确认注销账号？此操作不可撤销。")) return;
		await fetch(`${API}/api/auth/account`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		doLogout();
	}

	function doLogout() {
		user = null;
		token = "";
		localStorage.removeItem("ustinus_token");
		localStorage.removeItem("ustinus_user");
	}

	function insertEmoji(emoji) { content += emoji; }

	async function handleImageUpload(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		uploading = true;
		try {
			const form = new FormData();
			form.append("file", file);
			const res = await fetch(`${API}/api/upload`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: form,
			});
			const data = await res.json();
			if (data.url) content += `\n![图片](${data.url})\n`;
		} catch (e) {
			console.error(e);
		}
		uploading = false;
		e.target.value = "";
	}

	async function handleAvatarUpload(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		uploading = true;
		try {
			const form = new FormData();
			form.append("file", file);
			const res = await fetch(`${API}/api/auth/avatar`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: form,
			});
			const data = await res.json();
			if (data.url) {
				user = { ...user, avatar_url: data.url };
				localStorage.setItem("ustinus_user", JSON.stringify(user));
				await loadComments();
			}
		} catch (e) {
			console.error(e);
		}
		uploading = false;
		e.target.value = "";
	}

	async function doSubmit() {
		if (!content.trim() || submitting) return;
		submitting = true;
		await fetch(`${API}/api/comments`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ page_slug: pageSlug, content: content.trim() }),
		});
		content = "";
		submitting = false;
		await loadComments();
	}

	async function doDelete(id) {
		if (!confirm("确认删除？")) return;
		await fetch(`${API}/api/comments/${id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		await loadComments();
	}

	async function doPin(id, pinned) {
		await fetch(`${API}/api/comments/${id}/pin`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ pinned }),
		});
		await loadComments();
	}

	function timeAgo(dateStr) {
		const diff = Date.now() - new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z").getTime();
		const m = Math.floor(diff / 60000);
		if (m < 1) return "刚刚";
		if (m < 60) return `${m} 分钟前`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} 小时前`;
		return new Date(dateStr).toLocaleDateString("zh-CN");
	}

	function escapeAttr(s) {
		return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function renderTables(html) {
		const lines = html.split("\n");
		const result = [];
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			if (line.includes("|") && !line.includes("<") && i + 1 < lines.length) {
				const nextLine = lines[i + 1];
				if (nextLine.match(/^\|?[\s\-:|]+\|?$/)) {
					const headerRow = line;
					const alignRow = nextLine;
					const bodyRows = [];
					let j = i + 2;
					while (j < lines.length && lines[j].includes("|") && !lines[j].includes("<")) {
						bodyRows.push(lines[j]);
						j++;
					}
					const headers = headerRow.split("|").map((c) => c.trim()).filter((c) => c);
					const alignPositions = alignRow.split("|").map((c) => {
						const t = c.trim();
						if (t.startsWith(":") && t.endsWith(":")) return "center";
						if (t.endsWith(":")) return "right";
						return "left";
					});
					let table = '<table class="w-full my-3 text-sm border-collapse"><thead><tr>';
					headers.forEach((h, idx) => {
						const al = alignPositions[idx + (alignRow.startsWith("|") ? 1 : 0)] || "left";
						table += `<th class="px-3 py-2 font-semibold" style="text-align:${al};border-bottom:2px solid var(--line-divider)">${h}</th>`;
					});
					table += '</tr></thead><tbody>';
					for (const row of bodyRows) {
						const cells = row.split("|").map((c) => c.trim()).filter((c) => c || row.startsWith("|"));
						table += '<tr>';
						cells.forEach((cell, idx) => {
							if (idx >= headers.length) return;
							const al = alignPositions[idx + (row.startsWith("|") ? 1 : 0)] || "left";
							table += `<td class="px-3 py-2" style="text-align:${al};border-bottom:1px solid var(--line-divider)">${cell}</td>`;
						});
						table += '</tr>';
					}
					table += '</tbody></table>';
					result.push(table);
					i = j;
					continue;
				}
			}
			result.push(line);
			i++;
		}
		return result.join("\n");
	}

	function renderContent(text) {
		if (!text) return "";
		let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

		html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => `<div class="katex-block my-3" data-latex="${escapeAttr(m.trim())}"></div>`);
		html = html.replace(/\$(.+?)\$/g, (_, m) => `<span class="katex-inline" data-latex="${escapeAttr(m.trim())}"></span>`);

		html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
			return `<pre class="my-3 p-3 rounded-lg overflow-x-auto text-sm" style="background:var(--btn-regular-bg)"><code>${code.trim()}</code></pre>`;
		});

		html = html.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded text-sm" style="background:var(--btn-regular-bg);color:var(--primary)">$1</code>');
		html = html.replace(/!\[([^\]]*)\]\((\S+)\)/g, '<img src="$2" alt="$1" class="max-w-full rounded-lg my-2" loading="lazy" />');
		html = html.replace(/\[([^\]]+)\]\((\S+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="underline" style="color:var(--primary)">$1</a>');

		html = html.replace(/^[\-\*] \[(x|X| )\] (.+)$/gm, (_, checked, text) =>
			checked.trim() ? '<li class="task-done">&#9745; <del>' + text + '</del></li>' : '<li class="task-pending">&#9744; ' + text + '</li>');

		html = renderTables(html);

		html = html.replace(/^###### (.+)$/gm, '<h6 class="text-sm font-semibold mt-3 mb-1">$1</h6>');
		html = html.replace(/^##### (.+)$/gm, '<h5 class="text-sm font-semibold mt-3 mb-1">$1</h5>');
		html = html.replace(/^#### (.+)$/gm, '<h4 class="text-base font-semibold mt-3 mb-1">$1</h4>');
		html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>');
		html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>');
		html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>');

		html = html.replace(/^(---|\*\*\*)\s*$/gm, '<hr class="my-3" style="border-color:var(--line-divider)" />');

		const calloutTypes = ['note','tip','important','warning','caution','info','success','check','done','question','help','faq','attention','danger','error','bug','example','quote','abstract','summary','tldr','todo','failure','missing','fail','cite'];
		const calloutColors = { note:'#0969da', tip:'#1a7f37', important:'#8250df', warning:'#9a6700', caution:'#cf222e', info:'#0969da', success:'#1a7f37', check:'#1a7f37', done:'#8250df', question:'#1a7f37', help:'#0969da', faq:'#1a7f37', attention:'#cf222e', danger:'#cf222e', error:'#cf222e', bug:'#cf222e', example:'#8250df', quote:'#656d76', abstract:'#0969da', summary:'#0969da', tldr:'#0969da', todo:'#0969da', failure:'#cf222e', missing:'#cf222e', fail:'#cf222e', cite:'#656d76' };
		const calloutIcons = { note:'&#128221;', tip:'&#128161;', important:'&#9888;', warning:'&#9888;', caution:'&#128308;', info:'&#8505;', success:'&#9989;', check:'&#9989;', done:'&#9989;', question:'&#10067;', help:'&#10067;', faq:'&#10067;', attention:'&#9888;', danger:'&#128308;', error:'&#10060;', bug:'&#128030;', example:'&#128220;', quote:'&#128172;', abstract:'&#128220;', summary:'&#128220;', tldr:'&#128220;', todo:'&#128221;', failure:'&#10060;', missing:'&#10060;', fail:'&#10060;', cite:'&#128172;' };
		const calloutPattern = calloutTypes.join('|');
		html = html.replace(new RegExp(`^&gt; \\[!(${calloutPattern})\\](.*)$`, 'gm'), (_, type, title) => {
			const color = calloutColors[type] || '#0969da';
			const icon = calloutIcons[type] || '';
			const label = title.trim() || type.charAt(0).toUpperCase() + type.slice(1);
			return `<div class="border-l-4 rounded-r-lg pl-3 pr-3 py-2 my-2 text-sm" style="border-color:${color};background:${color}11"><div class="font-semibold" style="color:${color}">${icon} ${label}</div>`;
		});

		html = html.replace(/^(?:&gt;|>) (.+)$/gm, '<blockquote class="border-l-4 pl-3 my-2" style="border-color:var(--line-divider);color:var(--content-meta)">$1</blockquote>');

		html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
		html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
		html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
		html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
		html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
		html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

		html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
		html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, (group) => {
			if (group.includes('class="task-')) return `<ul class="pl-5 my-2" style="list-style:none">${group}</ul>`;
			return `<ul class="list-disc pl-5 my-2">${group}</ul>`;
		});
		html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
		html = html.replace(/\n/g, "<br>");
		return html;
	}
</script>

<div class="ustinus-comments">
  <div class="mb-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-bold" style="color: var(--btn-content)">评论 ({comments.length})</h3>
      {#if user}
        <div class="flex items-center gap-2">
          <span class="text-sm" style="color: var(--btn-content)">{user.username}</span>
          <button onclick={doLogout} class="text-xs cursor-pointer" style="color: var(--content-meta)">退出</button>
        </div>
      {/if}
    </div>

    {#if !user && !showLogin}
      <div class="rounded-xl border p-5 flex items-center justify-between" style="border-color: var(--line-divider); background: var(--btn-regular-bg)">
        <div>
          <p class="text-sm font-medium" style="color: var(--btn-content)">参与讨论</p>
          <p class="text-xs mt-0.5" style="color: var(--content-meta)">登录后可以发表评论、上传图片</p>
        </div>
        <button onclick={() => { showLogin = true; loginError = ""; registerMode = false; }} class="px-5 py-2.5 rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90 shrink-0" style="background: var(--primary)">登录 / 注册</button>
      </div>
    {/if}

    {#if showLogin}
      <div class="rounded-xl border overflow-hidden" style="border-color: var(--line-divider); background: var(--card-bg)">
        <div class="flex border-b" style="border-color: var(--line-divider)">
          <button onclick={() => { registerMode = false; loginError = ""; turnstileRendered = false; }} class="flex-1 py-3 text-sm font-medium transition-colors" style="color: {!registerMode ? 'var(--btn-content)' : 'var(--content-meta)'}; border-bottom: 2px solid {!registerMode ? 'var(--primary)' : 'transparent'}">登录</button>
          <button onclick={() => { registerMode = true; loginError = ""; turnstileRendered = false; emailVerified = false; codeSent = false; verifyCode = ""; }} class="flex-1 py-3 text-sm font-medium transition-colors" style="color: {registerMode ? 'var(--btn-content)' : 'var(--content-meta)'}; border-bottom: 2px solid {registerMode ? 'var(--primary)' : 'transparent'}">注册</button>
        </div>
        <div class="p-5">
          {#if registerMode}
            <div class="mb-3">
              <label class="block text-xs font-medium mb-1.5" style="color: var(--btn-content)">用户名</label>
              <input bind:value={registerName} type="text" placeholder="至少 2 个字符" class="w-full px-3 py-2.5 rounded-lg border text-sm" style="border-color:var(--line-divider);background:var(--btn-regular-bg);color:var(--btn-content)" />
            </div>
          {/if}
          <div class="mb-3">
            <label class="block text-xs font-medium mb-1.5" style="color: var(--btn-content)">邮箱</label>
            <div class="flex gap-2">
              <input bind:value={loginEmail} type="email" placeholder="your@email.com" disabled={emailVerified} class="flex-1 px-3 py-2.5 rounded-lg border text-sm" style="border-color:var(--line-divider);background:var(--btn-regular-bg);color:var(--btn-content)" />
              {#if registerMode && !emailVerified}
                <button onclick={sendCode} disabled={sendingCode || !loginEmail.includes("@")} class="px-3 py-2.5 rounded-lg text-white text-xs font-medium shrink-0 transition-opacity disabled:opacity-50" style="background: var(--primary)">{sendingCode ? "发送中..." : codeSent ? "重新发送" : "发送验证码"}</button>
              {/if}
            </div>
            {#if emailVerified}
              <p class="text-green-500 text-xs mt-1">✓ 邮箱已验证</p>
            {/if}
            {#if registerMode && codeSent && !emailVerified}
              <div class="mt-2 p-3 rounded-lg border" style="border-color: var(--line-divider); background: var(--btn-regular-bg)">
                <label class="block text-xs font-medium mb-1.5" style="color: var(--btn-content)">验证码</label>
                <div class="flex gap-2">
                  <input bind:value={verifyCode} type="text" placeholder="输入6位验证码" maxlength="6" class="flex-1 px-3 py-2 rounded-lg border text-sm text-center" style="border-color:var(--line-divider);background:var(--card-bg);color:var(--btn-content);letter-spacing:4px;font-family:monospace" />
                  <button onclick={verifyEmailCode} disabled={verifying || verifyCode.length < 6} class="px-4 py-2 rounded-lg text-white text-xs font-medium shrink-0 transition-opacity disabled:opacity-50" style="background: var(--primary)">{verifying ? "验证中..." : "验证"}</button>
                </div>
                <p class="text-xs mt-1.5" style="color: var(--content-meta)">验证码已发送至 {loginEmail}</p>
              </div>
            {/if}
          </div>
          <div class="mb-3">
            <label class="block text-xs font-medium mb-1.5" style="color: var(--btn-content)">密码</label>
            <div class="relative">
              <input bind:value={loginPassword} type={showPassword ? "text" : "password"} placeholder="输入密码" class="w-full px-3 py-2.5 rounded-lg border text-sm pr-10" style="border-color:var(--line-divider);background:var(--btn-regular-bg);color:var(--btn-content)" />
              <button type="button" onclick={() => showPassword = !showPassword} class="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer select-none" style="color: var(--content-meta)">{@html showPassword
                ? '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243a9.97 9.97 0 01-3.028 1.563M6.343 6.343L4 4m16 16l-2.343-2.343"/></svg>'
                : '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>'}
              </button>
            </div>
          </div>
          {#if registerMode}
            <div class="mb-4">
              <label class="block text-xs font-medium mb-1.5" style="color: var(--btn-content)">确认密码</label>
              <div class="relative">
                <input bind:value={loginConfirm} type={showConfirmPassword ? "text" : "password"} placeholder="再次输入密码" class="w-full px-3 py-2.5 rounded-lg border text-sm pr-10" style="border-color:var(--line-divider);background:var(--btn-regular-bg);color:var(--btn-content)" />
                <button type="button" onclick={() => showConfirmPassword = !showConfirmPassword} class="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer select-none" style="color: var(--content-meta)">{@html showConfirmPassword
                  ? '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243a9.97 9.97 0 01-3.028 1.563M6.343 6.343L4 4m16 16l-2.343-2.343"/></svg>'
                  : '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>'}
                </button>
              </div>
            </div>
          {/if}
          <div class="mb-4" id="ts-container"></div>
          {#if loginError}
            <p class="text-red-500 text-xs mb-3">{loginError}</p>
          {/if}
          <button onclick={registerMode ? doRegister : doLogin} disabled={loggingIn || registering} class="w-full py-2.5 rounded-lg text-white text-sm font-medium transition-opacity disabled:opacity-70" style="background: var(--primary)">
            {#if loggingIn}
              <span class="inline-flex items-center gap-2"><span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>登录中...</span>
            {:else if registering}
              <span class="inline-flex items-center gap-2"><span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>注册中...</span>
            {:else}
              {registerMode ? "创建账号" : "登录"}
            {/if}
          </button>
          <button onclick={() => { showLogin = false; loginError = ""; }} class="w-full mt-2 py-2 text-xs cursor-pointer rounded-lg transition-colors" style="color: var(--content-meta)">取消</button>
        </div>
      </div>
    {/if}
  </div>

  {#if user}
    <div class="mb-6 flex gap-3">
      <label class="cursor-pointer group shrink-0" title="点击更换头像">
        <div class="relative w-9 h-9 rounded-full overflow-hidden border-2 transition-all group-hover:opacity-80" style="border-color: var(--primary)">
          {#if user.avatar_url}
            <img src={user.avatar_url} alt="" class="w-full h-full object-cover" />
          {:else}
            <div class="w-full h-full flex items-center justify-center text-white text-sm font-bold" style="background: var(--primary)">{user.username[0]?.toUpperCase() || "U"}</div>
          {/if}
          <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3"/></svg>
          </div>
        </div>
        <input type="file" accept="image/*" class="hidden" onchange={(e) => handleAvatarUpload(e)} disabled={uploading} />
      </label>
      <div class="flex-1">
        <textarea bind:value={content} rows="3" placeholder="写下你的想法... Markdown 图片语法和表情都支持" class="w-full px-4 py-3 rounded-xl border resize-none text-sm" style="border-color:var(--line-divider);background:var(--card-bg);color:var(--btn-content)"></textarea>

        {#if showPreview && content.trim()}
          <div class="mt-2 p-4 rounded-xl border text-sm leading-relaxed" style="border-color:var(--line-divider);background:var(--btn-regular-bg);color:var(--btn-content)">
            <div class="text-xs mb-2" style="color: var(--content-meta)">预览</div>
            {@html renderContent(content)}
          </div>
        {/if}

        <div class="flex items-center justify-between mt-2">
          <div class="flex items-center gap-1">
            <div class="relative">
              <button onclick={() => showEmoji = !showEmoji} class="w-8 h-8 rounded-lg flex items-center justify-center text-lg cursor-pointer hover:opacity-80" style="background: var(--btn-regular-bg)" title="表情">😊</button>
              {#if showEmoji}
                <div class="absolute bottom-full left-0 mb-2 p-2 rounded-xl border shadow-lg grid grid-cols-8 gap-1 z-50" style="background:var(--card-bg);border-color:var(--line-divider);max-height:200px;overflow-y:auto;width:260px">
                  {#each emojis as emoji}
                    <button onclick={() => insertEmoji(emoji)} class="w-7 h-7 flex items-center justify-center text-base rounded hover:opacity-80 cursor-pointer leading-none" style="background:var(--btn-regular-bg)">{emoji}</button>
                  {/each}
                </div>
              {/if}
            </div>
            <label class="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer hover:opacity-80 {uploading ? 'opacity-50 pointer-events-none' : ''}" style="background: var(--btn-regular-bg)" title="上传图片">
              <svg class="w-4 h-4" style="color: var(--btn-content)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              <input type="file" accept="image/*" class="hidden" onchange={(e) => handleImageUpload(e)} disabled={uploading} />
            </label>
            <button onclick={() => showPreview = !showPreview} class="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer hover:opacity-80 {showPreview ? 'ring-2' : ''}" style="background: var(--btn-regular-bg);color:var(--btn-content);--tw-ring-color:var(--primary)" title="预览">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
            </button>
          </div>
          <button onclick={doSubmit} disabled={submitting || !content.trim()} class="px-5 py-2 rounded-lg text-white text-sm font-medium transition-opacity disabled:opacity-50 hover:opacity-90" style="background: var(--primary)">{submitting ? "提交中..." : "发表"}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-12 gap-2 text-sm" style="color: var(--content-meta)">
      <span class="w-5 h-5 border-2 border-(--primary) border-t-transparent rounded-full animate-spin"></span>
      加载评论中...
    </div>
  {:else if comments.length === 0}
    <div class="text-center py-12 text-sm" style="color: var(--content-meta)">
      <svg class="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
      <p>暂无评论，来抢沙发吧</p>
    </div>
  {:else}
    <div class="space-y-5">
      {#each comments as comment (comment.id)}
        <div class="flex gap-3" class:border-l-4={comment.pinned} style={comment.pinned ? "border-color:var(--primary);padding-left:12px" : ""}>
          <div class="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-bold overflow-hidden" style="background: var(--primary)">
            {#if comment.avatar_url}
              <img src={comment.avatar_url} alt="" class="w-full h-full object-cover" />
            {:else}
              {comment.username[0]?.toUpperCase() || "?"}
            {/if}
          </div>
          <div class="flex-1 min-w-0">
            {#if comment.pinned}
              <div class="flex items-center gap-1 mb-1">
                <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" style="color:var(--primary)"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                <span class="text-xs font-medium" style="color:var(--primary)">已置顶</span>
              </div>
            {/if}
            <div class="flex items-center gap-2 mb-2">
              <span class="text-sm font-semibold" style="color: var(--btn-content)">{comment.username}</span>
              <span class="text-xs" style="color: var(--content-meta)">{timeAgo(comment.created_at)}</span>
              {#if isAdmin()}
                <button onclick={() => doPin(comment.id, comment.pinned ? 0 : 1)} class="ml-auto text-xs cursor-pointer" style="color: var(--content-meta)" title={comment.pinned ? "取消置顶" : "置顶"}>
                  {comment.pinned ? "取消置顶" : "置顶"}
                </button>
              {/if}
              {#if user && (user.id === comment.user_id || isAdmin())}
                <button onclick={() => doDelete(comment.id)} class="text-xs cursor-pointer" style="color: var(--content-meta)" title="删除" class:ml-auto={!isAdmin()}>删除</button>
              {/if}
            </div>
            <div class="text-sm leading-relaxed" style="color: var(--btn-content)">
              {@html renderContent(comment.content)}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cf-turnstile { transform: scale(0.85); transform-origin: left top; margin-bottom: -8px; }
</style>
