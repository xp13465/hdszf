// Cloudflare Worker: 纯静态资源代理，支持 _headers 文件
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
