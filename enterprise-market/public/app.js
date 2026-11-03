import { apiUrl, createApi, text, bytes, date, downloadUrl, operationMessage } from './core.js';
import { $, el, icon, markdown, show, toast, initUi } from './ui.js';
import { DesktopBridge } from './bridge.js';
import { createPublisher } from './publish.js';
import { createInstalled } from './installed.js';

initUi();
const state = { view: 'discover', plugins: [], categories: [], total: 0, category: '', favoritesOnly: false, favorites: new Set(), installed: [], busy: false };
try { const saved = JSON.parse(localStorage.getItem('starmind.market.favorites') ?? '[]'); if (Array.isArray(saved)) state.favorites = new Set(saved.filter(v => typeof v === 'string')); } catch { /* Favorites are optional local state. */ }
let publisher, queryController, searchTimer;
const api = createApi(() => publisher?.token ?? '');
const bridge = new DesktopBridge(() => {
  $('bridgeBadge').textContent = '已连接 StarMind'; $('bridgeBadge').classList.add('connected'); $('embeddedNotice').hidden = false;
  installed.refresh().then(() => { if (state.view === 'discover') renderCatalog(); else if (state.view === 'installed') loadView(); }).catch(error => toast(`无法读取 StarMind 安装状态：${error.message}`, true));
});
function loading(value) { $('loadingState').hidden = !value; if (value) { $('pluginGrid').replaceChildren(); $('emptyState').hidden = true; } }
function empty(title, description, action, handler) {
  $('emptyTitle').textContent = title; $('emptyText').textContent = description; $('emptyState').hidden = false;
  $('emptyAction').hidden = !action; $('emptyAction').textContent = action ?? ''; $('emptyAction').onclick = handler ?? null;
}
function updateFavorites() {
  $('favoriteCount').textContent = String(state.favorites.size);
  try { localStorage.setItem('starmind.market.favorites', JSON.stringify([...state.favorites])); } catch { /* The current view remains usable. */ }
}
function favoriteButton(name) {
  const active = state.favorites.has(name);
  return el('button', { className: 'icon-button favorite-button', type: 'button', 'aria-label': `${active ? '取消收藏' : '收藏'} ${name}`, 'aria-pressed': String(active), onClick: event => {
    if (state.favorites.has(name)) state.favorites.delete(name); else state.favorites.add(name);
    updateFavorites(); const button = event.currentTarget, selected = state.favorites.has(name); button.textContent = selected ? '★' : '☆'; button.setAttribute('aria-pressed', String(selected)); button.setAttribute('aria-label', `${selected ? '取消收藏' : '收藏'} ${name}`);
    if (state.favoritesOnly) renderCatalog();
  } }, active ? '★' : '☆');
}
function renderCategories() {
  $('categoryFilters').replaceChildren(...['', ...state.categories].map(category => el('button', { type: 'button', className: `category-chip${state.category === category ? ' active' : ''}`, 'aria-pressed': String(state.category === category), onClick: () => { state.category = category; renderCategories(); loadCatalog(); } }, category || '全部')));
  $('categorySuggestions').replaceChildren(...state.categories.map(category => el('option', { value: category })));
}
function renderCatalog() {
  if (state.view !== 'discover') return;
  const values = state.plugins.filter(plugin => !state.favoritesOnly || state.favorites.has(plugin.name));
  $('pluginGrid').replaceChildren(...values.map(plugin => {
    const name = plugin.name, title = text(plugin.title, name), current = state.installed.find(bundle => bundle.name === name);
    const tags = [el('span', { className: 'tag' }, plugin.category || '其他')];
    if (current) tags.push(el('span', { className: 'tag success' }, current.enabled ? '已启用' : '已安装'));
    return el('article', { className: 'plugin-card' },
      el('div', { className: 'card-top' }, icon(title), el('div', { className: 'card-title' }, el('button', { className: 'title-button', type: 'button', onClick: () => openDetail(name) }, title), el('span', { className: 'package-name' }, name)), favoriteButton(name)),
      el('p', { className: 'card-description' }, text(plugin.description, '发布者暂未提供简介。')),
      el('div', { className: 'card-meta' }, tags, el('span', {}, date(plugin.publishedAt))),
      el('div', { className: 'card-bottom' }, el('span', { className: 'version' }, `v${plugin.latestVersion ?? plugin.versions?.[0]?.version ?? '—'}`), el('div', { className: 'card-actions' }, el('button', { className: 'button secondary', type: 'button', onClick: () => openDetail(name) }, current ? '查看插件' : '查看与安装'))));
  }));
  $('resultCount').textContent = `${state.favoritesOnly ? values.length : state.total} 个插件`;
  $('emptyState').hidden = values.length > 0;
  if (!values.length) empty(state.favoritesOnly ? '还没有匹配的收藏' : state.category || $('searchInput').value ? '没有找到匹配的插件' : '团队的下一个工具，从这里开始', state.favoritesOnly ? '在插件卡片上点击星标，即可保存到本机收藏。' : '试试其他关键词或分类，也可以发布团队自己的插件。', '清除筛选', () => { $('searchInput').value = ''; state.category = ''; state.favoritesOnly = false; $('favoriteFilter').setAttribute('aria-pressed', 'false'); renderCategories(); loadCatalog(); });
  $('viewStatus').textContent = `已显示 ${values.length} 个插件。`;
}
async function loadCatalog() {
  queryController?.abort(); const controller = new AbortController(); queryController = controller;
  const params = new URLSearchParams({ q: $('searchInput').value.trim(), category: state.category, sort: $('sortSelect').value });
  if (state.view === 'discover') loading(true);
  try {
    const data = await api(`api/catalog?${params}`, { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.plugins = Array.isArray(data.plugins) ? data.plugins : []; state.total = Number(data.total ?? state.plugins.length);
    state.categories = [...new Set([...(data.categories ?? state.categories), ...state.plugins.map(p => p.category).filter(Boolean)])].sort();
    if (data.market?.name) $('sourceName').textContent = text(data.market.name, '公司插件市场');
    $('connectionError').hidden = true; $('sourceDot').className = 'status-dot'; $('connectionText').textContent = `已连接 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    renderCategories(); renderCatalog();
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('connectionError').hidden = false; $('connectionErrorText').textContent = error.message; $('sourceDot').className = 'status-dot offline'; $('connectionText').textContent = '连接不可用';
    if (state.view === 'discover') { renderCatalog(); if (!state.plugins.length) empty('市场暂时无法连接', '请检查公司网络与市场服务，再点击重新连接。', '重新连接', loadCatalog); }
  } finally { if (!controller.signal.aborted && state.view === 'discover') loading(false); }
}
async function perform(action, name, version, statusNode) {
  if (state.busy) return toast('已有插件操作正在进行，请等待实际结果。', true);
  state.busy = true;
  if (statusNode) statusNode.textContent = '等待 StarMind 确认并执行，请查看客户端提示…';
  try {
    const result = await bridge.request(action, { packageName: name, ...(version ? { version } : {}) });
    const message = operationMessage(result, action === 'update' ? '更新' : '安装');
    if (statusNode) statusNode.textContent = message.text;
    toast(message.text, message.error); await installed.refresh(); renderCatalog();
  } catch (error) { if (statusNode) statusNode.textContent = error.message; toast(error.message, true); }
  finally { state.busy = false; }
}
async function openDetail(name, ownRelease = null) {
  const dialog = $('detailDialog'); $('detailContent').replaceChildren(el('h2', { id: 'detailTitle', className: 'sr-only' }, '插件详情'), el('div', { className: 'loading-state', role: 'status' }, '正在读取插件详情…')); show(dialog);
  try {
    const data = ownRelease ? { plugin: { ...ownRelease, latestVersion: ownRelease.version, versions: [ownRelease] } } : await api(`api/plugins/${encodeURIComponent(name)}`), plugin = data.plugin ?? data;
    const versions = Array.isArray(plugin.versions) ? plugin.versions : [], title = text(plugin.title, name);
    const select = el('select', { id: 'detailVersion', 'aria-label': '选择插件版本' }, ...versions.map(release => el('option', { value: release.id }, `${release.version}${release.status === 'withdrawn' || release.withdrawn ? ' · 已撤回' : ''}`)));
    const latest = versions.find(release => release.version === plugin.latestVersion); if (latest) select.value = latest.id;
    const status = el('p', { className: 'small muted', role: 'status', 'aria-live': 'polite' });
    const actions = el('div', { className: 'detail-actions' });
    const packages = el('div', { className: 'package-table-wrapper' });
    const readme = el('div');
    const meta = el('div', { className: 'detail-metadata' });
    const installedInfo = el('p', { className: 'small muted' });
    function update() {
      const release = versions.find(item => item.id === select.value) ?? versions[0];
      actions.replaceChildren(el('div', { className: 'version-picker' }, el('label', { for: 'detailVersion' }, '发布版本'), select));
      meta.replaceChildren(el('span', { className: 'tag' }, plugin.category || '其他'));
      if (!release) { actions.append(el('span', { className: 'muted' }, '暂无可用版本')); return; }
      readme.replaceChildren(markdown(release.readme ?? plugin.readme));
      const current = state.installed.find(bundle => bundle.name === name), withdrawn = release.withdrawn || release.status === 'withdrawn';
      const download = downloadUrl(release.downloadUrl, release.id);
      if (download) actions.append(el('a', { className: 'button secondary', href: download, download: '' }, '下载离线包'));
      if (bridge.capabilities?.install) actions.append(el('button', { className: 'button primary', type: 'button', disabled: withdrawn || (current?.version === release.version), onClick: () => perform(current ? 'update' : 'install', name, release.version, status) }, current?.version === release.version ? '已安装此版本' : current ? '更新到此版本' : '安装到 StarMind'));
      else actions.append(el('button', { className: 'button primary', type: 'button', onClick: () => { status.textContent = '请从 StarMind 的企业插件市场入口打开此页面，即可由客户端确认安装。也可以下载离线包交给管理员导入。'; } }, '如何安装'));
      meta.append(el('span', { className: 'tag' }, `v${release.version}`), el('span', { className: 'tag' }, `${release.packages?.length ?? release.packageCount ?? release.dependencyCount ?? 0} 个包`), el('span', { className: 'tag' }, date(release.publishedAt)));
      if (withdrawn) meta.append(el('span', { className: 'tag warning' }, '已撤回，停止新安装'));
      installedInfo.textContent = current ? `本机已安装 v${current.version ?? '未知'} · ${current.enabled ? '已启用' : '已停用'}` : bridge.capabilities ? '当前 StarMind Profile 尚未安装此插件。' : '网页端无法读取本机安装状态；从 StarMind 打开后可查看。';
      const entries = release.packages ?? [];
      packages.replaceChildren(entries.length ? el('table', { className: 'package-table' }, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '包名'), el('th', { scope: 'col' }, '版本'), el('th', { scope: 'col' }, '大小'))), el('tbody', {}, ...entries.map(pkg => el('tr', {}, el('td', {}, pkg.name), el('td', {}, pkg.version), el('td', {}, bytes(pkg.size)))))) : el('p', { className: 'small muted' }, '此版本未返回详细包清单。'));
    }
    select.addEventListener('change', update);
    $('detailContent').replaceChildren(el('div', { className: 'detail-heading' }, icon(title), el('div', {}, el('h2', { id: 'detailTitle' }, title), el('span', { className: 'package-name' }, name))), el('p', { className: 'detail-summary' }, text(plugin.description, '发布者暂未提供简介。')), meta, actions, installedInfo, status, el('section', { className: 'detail-section' }, el('h3', {}, '使用说明'), readme), el('section', { className: 'detail-section' }, el('h3', {}, '插件与依赖'), packages));
    update();
  } catch (error) { $('detailContent').replaceChildren(el('h2', { id: 'detailTitle' }, '无法读取插件详情'), el('p', { className: 'form-error', role: 'alert' }, error.message), el('button', { className: 'button secondary', type: 'button', onClick: () => openDetail(name) }, '重试')); }
}
const installed = createInstalled({ bridge, api, openDetail, isActive: () => state.view === 'installed', onChange: values => { state.installed = values; $('installedCount').hidden = false; $('installedCount').textContent = String(values.length); }, toast });
publisher = createPublisher({ api, toast, openDetail, onUserChange: user => { $('loginButton').hidden = !!user; $('userName').hidden = !user; $('logoutButton').hidden = !user; $('userName').textContent = user?.name ?? ''; if (state.view === 'mine') loadView(); }, onPublished: () => { loadCatalog(); if (state.view === 'mine') loadView(); } });
async function loadView() {
  const discover = state.view === 'discover'; $('discoveryControls').hidden = !discover; $('emptyState').hidden = true; $('pluginGrid').replaceChildren();
  $('sectionTitle').textContent = discover ? '全部插件' : state.view === 'installed' ? '当前 Profile 已安装' : '我发布的版本'; $('resultCount').textContent = '';
  $('sectionHint').textContent = discover ? '精确版本 · 内网分发' : state.view === 'installed' ? '状态来自 StarMind 插件管理器' : '撤回保留已下载和已安装的版本';
  if (discover) return loadCatalog();
  loading(true);
  try {
    if (state.view === 'installed') {
      if (!bridge.capabilities?.list) { empty('从 StarMind 查看已安装插件', '独立浏览器不能读取或修改你的本机 Profile。请使用 StarMind 的企业插件市场入口。'); return; }
      const count = await installed.render($('pluginGrid')); $('resultCount').textContent = `${count} 个插件`; if (!count) empty('当前 Profile 还没有插件', '在发现页挑选需要的插件，由 StarMind 确认后安装。', '发现插件', () => switchView('discover'));
    } else {
      if (!publisher.user) { empty('登录后管理自己的发布', '浏览和下载无需登录；发布、导入离线包或撤回自己的版本需要发布者令牌。', '发布者登录', () => publisher.login()); return; }
      const count = await publisher.renderMine($('pluginGrid')); $('resultCount').textContent = `${count} 个版本`; if (!count) empty('你还没有发布插件', '上传原始插件包及全部依赖，或导入市场离线包。', '发布插件', () => publisher.open());
    }
  } catch (error) { empty('暂时无法读取', error.message, '重试', loadView); }
  finally { loading(false); }
}
function switchView(view) { state.view = view; document.querySelectorAll('[data-view]').forEach(button => { const active = button.dataset.view === view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }); loadView(); }
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadCatalog, 250); }); $('sortSelect').addEventListener('change', loadCatalog);
$('favoriteFilter').addEventListener('click', () => { state.favoritesOnly = !state.favoritesOnly; $('favoriteFilter').setAttribute('aria-pressed', String(state.favoritesOnly)); renderCatalog(); });
$('refreshButton').addEventListener('click', loadView); $('retryButton').addEventListener('click', loadView); $('publishButton').addEventListener('click', () => publisher.open()); $('loginButton').addEventListener('click', () => publisher.login()); $('logoutButton').addEventListener('click', () => publisher.logout());
document.addEventListener('keydown', event => { if (event.key === '/' && !document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); switchView('discover'); $('searchInput').focus(); } });
updateFavorites(); renderCategories(); loadCatalog(); bridge.start();
