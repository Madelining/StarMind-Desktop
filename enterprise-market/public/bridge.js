export class DesktopBridge {
  constructor(onChange) {
    this.pending = new Map(); this.capabilities = null; this.origin = null; this.onChange = onChange;
    window.addEventListener('message', event => this.receive(event));
  }
  start() {
    if (parent === window) return;
    this.handshakeId = crypto.randomUUID();
    let origin = '*';
    try { const ref = new URL(document.referrer); if (ref.origin !== 'null') origin = ref.origin; } catch { /* A capability-only probe contains no data. */ }
    parent.postMessage({ type: 'starmind.market.handshake', requestId: this.handshakeId }, origin);
  }
  receive(event) {
    if (event.source !== parent || parent === window || !event.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (data.type === 'starmind.market.handshake.result' && data.requestId === this.handshakeId && data.ok === true) {
      let local = false;
      try { const url = new URL(event.origin); local = (url.protocol === 'http:' || url.protocol === 'https:') && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'); } catch { /* Custom protocol is checked below. */ }
      if (!local && event.origin !== 'dsh-app://app') return;
      this.origin = event.origin; this.capabilities = data.result ?? {}; this.onChange?.(); return;
    }
    if (!this.origin || event.origin !== this.origin) return;
    const pending = this.pending.get(data.requestId);
    if (!pending || data.type !== `${pending.type}.result`) return;
    clearTimeout(pending.timer); this.pending.delete(data.requestId);
    if (data.ok) pending.resolve(data.result); else pending.reject(new Error(typeof data.error === 'string' ? data.error : 'StarMind 无法完成此操作。'));
  }
  request(action, payload = {}) {
    if (!this.origin || !this.capabilities) return Promise.reject(new Error('尚未连接 StarMind，请从客户端的企业插件市场入口打开此页面。'));
    const requestId = crypto.randomUUID(), type = `starmind.market.${action}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('StarMind 操作尚未返回。请在客户端查看实际结果，避免重复提交。')); }, action === 'list' ? 20000 : 15 * 60 * 1000);
      this.pending.set(requestId, { type, resolve, reject, timer });
      parent.postMessage({ type, requestId, payload }, this.origin);
    });
  }
}
