export default {
	async fetch(request, env, ctx) {

		// ========================
		// 工具函数
		// ========================

		async function md5(text) {
			const msgUint8 = new TextEncoder().encode(text);
			const hashBuffer = await crypto.subtle.digest('MD5', msgUint8);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
		}

		function fixUrl(url) {
			return url.replace(/\/+/g, '/').replace(':/', '://');
		}

		function json(data, status = 200) {
			return new Response(JSON.stringify(data, null, 2), {
				status,
				headers: {
					"content-type": "application/json;charset=utf-8"
				}
			});
		}

		// ========================
		// 初始化
		// ========================

		const url = new URL(fixUrl(request.url));
		const pathParts = url.pathname.split('/').filter(Boolean);

		const ADMIN_PASSWORD = env.SUB_PASSWORD;
		const ADMIN_PATH = env.ADMIN_PATH || "sub-admin";

		if (!ADMIN_PASSWORD) {
			return new Response("未配置 SUB_PASSWORD", { status: 500 });
		}

		if (!env.SUB_USERS) {
			return new Response("未绑定 KV: SUB_USERS", { status: 500 });
		}

		const userAgent = request.headers.get("User-Agent") || "unknown";
		const ip =
			request.headers.get("CF-Connecting-IP") ||
			request.headers.get("x-forwarded-for") ||
			"unknown";

		// 更安全的设备绑定
		const deviceId = await md5(userAgent + "|" + ip);

		// ========================
		// 管理后台
		// ========================

		const isAdminRoute =
			pathParts[0] === ADMIN_PATH ||
			["add", "info", "del", "reset-device"].includes(pathParts[0]);

		if (isAdminRoute) {

			const key = url.searchParams.get("key");

			if (key !== ADMIN_PASSWORD) {
				return new Response("密码错误", { status: 403 });
			}

			// 后台页面
			if (pathParts[0] === ADMIN_PATH) {

				const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Token 管理</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
body{
	font-family:sans-serif;
	max-width:800px;
	margin:auto;
	padding:20px;
	line-height:1.6;
}
input,button{
	width:100%;
	padding:12px;
	margin:8px 0;
	box-sizing:border-box;
}
button{
	cursor:pointer;
	border:none;
	border-radius:6px;
	background:#1677ff;
	color:white;
	font-size:15px;
}
.row{
	display:flex;
	gap:10px;
}
.warn{
	background:#faad14;
	color:black;
}
.danger{
	background:#ff4d4f;
}
pre{
	background:#f5f5f5;
	padding:15px;
	border-radius:8px;
	white-space:pre-wrap;
	word-break:break-all;
}
</style>
</head>

<body>

<h2>订阅 Token 管理后台</h2>

<button onclick="add()">生成 Token（30天）</button>

<input id="token" placeholder="输入 Token">

<div class="row">
	<button onclick="info()">查询</button>
	<button class="warn" onclick="reset()">解绑设备</button>
	<button class="danger" onclick="del()">删除</button>
</div>

<pre id="out">结果会显示在这里</pre>

<script>

const key = new URLSearchParams(location.search).get("key");

async function add(){
	const r = await fetch('/add?key=' + key);
	out.innerText = await r.text();
}

async function info(){
	const t = token.value.trim();
	if(!t) return alert("请输入Token");

	const r = await fetch('/info?key=' + key + '&token=' + t);
	out.innerText = await r.text();
}

async function reset(){
	const t = token.value.trim();
	if(!t) return alert("请输入Token");

	const r = await fetch('/reset-device?key=' + key + '&token=' + t);
	out.innerText = await r.text();
}

async function del(){
	const t = token.value.trim();

	if(!t) return alert("请输入Token");

	if(!confirm("确定删除？")) return;

	const r = await fetch('/del?key=' + key + '&token=' + t);
	out.innerText = await r.text();
}

</script>

</body>
</html>
`;

				return new Response(html, {
					headers: {
						"content-type": "text/html;charset=utf-8"
					}
				});
			}

			// 新增用户
			if (pathParts[0] === "add") {

				const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

				const expire =
					Math.floor(Date.now() / 1000) +
					30 * 24 * 60 * 60;

				await env.SUB_USERS.put(token, JSON.stringify({
					expire,
					count: 0,
					bindDevice: null,
					lastAccess: 0,
					createTime: Date.now()
				}));

				return new Response(
`创建成功

Token:
${token}

订阅地址:
${url.origin}/${token}/sub`
				);
			}

			// 查询
			if (pathParts[0] === "info") {

				const token = url.searchParams.get("token");

				const data = await env.SUB_USERS.get(token, {
					type: "json"
				});

				return json(data || { error: "不存在" });
			}

			// 删除
			if (pathParts[0] === "del") {

				const token = url.searchParams.get("token");

				await env.SUB_USERS.delete(token);

				return new Response("删除成功");
			}

			// 解绑设备
			if (pathParts[0] === "reset-device") {

				const token = url.searchParams.get("token");

				const data = await env.SUB_USERS.get(token, {
					type: "json"
				});

				if (!data) {
					return new Response("Token 不存在");
				}

				data.bindDevice = null;

				await env.SUB_USERS.put(
					token,
					JSON.stringify(data)
				);

				return new Response("设备解绑成功");
			}
		}

		// ========================
		// 用户订阅验证
		// ========================

		if (
			pathParts.length >= 2 &&
			pathParts[1] === "sub"
		) {

			const userToken = pathParts[0];

			const userData = await env.SUB_USERS.get(userToken, {
				type: "json"
			});

			if (!userData) {
				return new Response("Token 不存在", {
					status: 403
				});
			}

			// 检查过期
			if (Math.floor(Date.now() / 1000) > userData.expire) {
				return new Response("Token 已过期", {
					status: 403
				});
			}

			// 限流（5秒）
			if (
				userData.lastAccess &&
				Date.now() - userData.lastAccess < 5000
			) {
				return new Response("请求过快", {
					status: 429
				});
			}

			// 首次绑定设备
			if (!userData.bindDevice) {

				userData.bindDevice = deviceId;

			} else {

				// 设备不匹配
				if (userData.bindDevice !== deviceId) {

					return new Response(
						"该 Token 已绑定其他设备",
						{ status: 403 }
					);
				}
			}

			userData.count = (userData.count || 0) + 1;
			userData.lastAccess = Date.now();

			ctx.waitUntil(
				env.SUB_USERS.put(
					userToken,
					JSON.stringify(userData)
				)
			);

			// ========================
			// 转发到真实订阅
			// ========================

			const REAL_SUB_URL = env.REAL_SUB_URL;

			if (!REAL_SUB_URL) {
				return new Response(
					"未配置 REAL_SUB_URL",
					{ status: 500 }
				);
			}

			return fetch(REAL_SUB_URL, {
				headers: request.headers
			});
		}

		return new Response("Worker 正常运行");
	}
}
