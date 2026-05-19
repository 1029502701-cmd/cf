export async function onRequest(context) {

	const { request, env, waitUntil } = context;

	const url = new URL(request.url);

	const pathParts = url.pathname.split('/').filter(v => v);

	const SUB_PASSWORD = env.SUB_PASSWORD || "147258";

	// 后台
	if (pathParts[0] === "admin") {

		const key = url.searchParams.get("key");

		if (key !== SUB_PASSWORD) {
			return new Response("密码错误", { status: 403 });
		}

		const html = `
		<html>
		<head>
		<meta charset="utf-8">
		<title>订阅后台</title>
		<style>
		body{
			font-family:sans-serif;
			max-width:700px;
			margin:auto;
			padding:20px;
		}
		button{
			padding:10px;
			width:100%;
			margin-top:10px;
		}
		pre{
			background:#f4f4f4;
			padding:15px;
			white-space:pre-wrap;
		}
		</style>
		</head>
		<body>

		<h2>订阅管理后台</h2>

		<button onclick="add()">生成Token</button>

		<pre id="out"></pre>

		<script>

		const key = "${SUB_PASSWORD}";

		async function add(){

			const r = await fetch('/add?key=' + key);

			document.getElementById('out').innerText =
				await r.text();
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

	// 创建 token
	if (pathParts[0] === "add") {

		const key = url.searchParams.get("key");

		if (key !== SUB_PASSWORD) {
			return new Response("密码错误");
		}

		const token =
			crypto.randomUUID().split('-')[0];

		const expire =
			Math.floor(Date.now()/1000)
			+ 30*24*60*60;

		await env.SUB_USERS.put(
			token,
			JSON.stringify({
				expire,
				count:0,
				bindUA:null
			})
		);

		return new Response(
`创建成功

Token:
${token}

订阅地址:
${url.origin}/${token}/sub`
		);
	}

	// 订阅
	if (
		pathParts.length >= 2 &&
		pathParts[1] === "sub"
	) {

		const token = pathParts[0];

		const data =
			await env.SUB_USERS.get(
				token,
				{ type:"json" }
			);

		if (!data) {
			return new Response(
				"Token不存在",
				{ status:403 }
			);
		}

		if (
			Math.floor(Date.now()/1000)
			> data.expire
		){
			return new Response(
				"Token已过期",
				{ status:403 }
			);
		}

		const ua =
			request.headers.get("user-agent")
			|| "unknown";

		if (!data.bindUA) {

			data.bindUA = ua;

		} else if (data.bindUA !== ua){

			return new Response(
				"设备不一致",
				{ status:403 }
			);
		}

		data.count++;

		waitUntil(
			env.SUB_USERS.put(
				token,
				JSON.stringify(data)
			)
		);

		const REAL_SUB_URL =
			env.REAL_SUB_URL;

		return fetch(REAL_SUB_URL,{
			headers:{
				"user-agent":ua
			}
		});
	}

	return new Response("404");

}
