// Cloudflare Worker: 静态资源代理 + CSS/JS 缓存策略
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 进行中月份进度快照：每周/每交易日由脚本重写，短缓存 60 秒（避免边缘缓存导致进度不更新）
    if (/\/js\/progress\.json$/i.test(path)) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=60');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    // CSS/JS 文件：设置 5 分钟浏览器缓存
    if (/\.(css|js)$/i.test(path)) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=300');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    // 其他请求：直接走 Assets
    return env.ASSETS.fetch(request);
  }
};
