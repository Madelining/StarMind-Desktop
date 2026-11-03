import { normalizeBundles, operationMessage, text } from './core.js';
import { el, icon } from './ui.js';

export function createInstalled({ bridge, api, openDetail, isActive, onChange, toast }) {
  let bundles = [], busy = false, activeGrid = null;
  async function refresh() {
    if (!bridge.capabilities?.list) return [];
    bundles = normalizeBundles(await bridge.request('list')); onChange(bundles);
    return bundles;
  }
  async function action(type, bundle, payload, button) {
    if (busy) return toast('已有插件操作正在进行，请等待实际结果。', true);
    busy = true; button.disabled = true;
    try {
      const result = await bridge.request(type, { packageName: bundle.name, ...payload });
      const message = operationMessage(result, type === 'uninstall' ? '卸载' : type === 'update' ? '更新' : payload.enabled ? '启用' : '停用');
      toast(message.text, message.error); await refresh(); if (activeGrid?.isConnected && isActive()) await render(activeGrid, false);
    } catch (error) { toast(error.message, true); }
    finally { busy = false; button.disabled = false; }
  }
  async function render(grid, reload = true, shouldRender = isActive) {
    activeGrid = grid; if (reload) await refresh();
    let plugins = [];
    try { const data = await api('api/catalog?sort=newest'); plugins = data.plugins ?? []; }
    catch { toast('公司目录暂时不可达，仍显示 StarMind 返回的本地插件状态。'); }
    if (!shouldRender()) return bundles.length;
    grid.replaceChildren(...bundles.map(bundle => {
      const plugin = plugins.find(item => item.name === bundle.name), name = bundle.name, title = text(plugin?.title, name), actions = el('div', { className: 'card-actions' });
      if (plugin) actions.append(el('button', { className: 'button secondary', type: 'button', onClick: () => openDetail(name) }, plugin.latestVersion !== bundle.version ? '查看可用版本' : '查看详情'));
      if (bridge.capabilities?.toggle) actions.append(el('button', { className: 'button secondary', type: 'button', disabled: !!bundle.readOnlyReason, onClick: event => action('set-enabled', bundle, { enabled: !bundle.enabled }, event.currentTarget) }, bundle.enabled ? '停用' : '启用'));
      if (bridge.capabilities?.uninstall && bundle.removable !== false) actions.append(el('button', { className: 'button ghost', type: 'button', disabled: !!bundle.readOnlyReason, onClick: event => action('uninstall', bundle, {}, event.currentTarget) }, '卸载'));
      return el('article', { className: 'plugin-card' }, el('div', { className: 'card-top' }, icon(title), el('div', { className: 'card-title' }, el('h3', {}, title), el('span', { className: 'package-name' }, name))), el('p', { className: 'card-description' }, bundle.readOnlyReason || text(plugin?.description, '此插件不在当前公司目录中，实际状态来自 StarMind。')), el('div', { className: 'card-meta' }, el('span', { className: `tag ${bundle.enabled ? 'success' : ''}` }, bundle.enabled ? '已启用' : '已停用'), plugin ? el('span', { className: 'tag' }, '公司市场') : el('span', { className: 'tag warning' }, '其他来源')), el('div', { className: 'card-bottom' }, el('span', { className: 'version' }, `v${bundle.version ?? '未知'}`), actions));
    }));
    return bundles.length;
  }
  return { refresh, render };
}
