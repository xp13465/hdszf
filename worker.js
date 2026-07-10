// Cloudflare Worker: 静态资源代理 + CSS/JS 缓存策略
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 让 Assets 处理请求
    const response = await env.ASSETS.fetch(request);

    // CSS/JS 文件：设置 5 分钟浏览器缓存
    if (/\.(css|js)$/i.test(path)) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=300');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    return response;
  }
};
