import { apiUrl, bytes, date, downloadUrl, errorText, text } from './core.js';
import { $, el, icon, show, messageBox } from './ui.js';

export function createPublisher({ api, toast, openDetail, onUserChange, onPublished }) {
  let token = '', user = null, capabilities = {}, uploads = [], xhr = null, busy = false, openAfterLogin = false;
  const mode = () => document.querySelector('input[name="uploadMode"]:checked').value;
  const error = message => { $('publishError').textContent = message; $('publishError').hidden = !message; };
  function ready() {
    $('publishSubmit').disabled = busy || (mode() === 'tgz' ? !uploads.length || !$('mainPackageSelect').value : !$('bundleFile').files.length);
    $('uploadPackagesButton').disabled = busy || !$('packageFiles').files.length;
    $('publishSubmit').textContent = busy ? '正在处理…' : mode() === 'bundle' ? '导入离线包' : '发布插件';
    $('packageFiles').disabled = busy; $('bundleFile').disabled = busy;
    $('mainPackageSelect').disabled = busy || !uploads.some(item => item.bundle === true);
    document.querySelectorAll('input[name="uploadMode"]').forEach(input => { input.disabled = busy; });
  }
  function login() { $('loginError').hidden = true; $('tokenInput').value = ''; show($('loginDialog')); }
  function open() {
    if (!user) { openAfterLogin = true; login(); return; }
    if (!capabilities.publish && !capabilities.admin) return toast('此账号没有发布权限，请联系市场管理员。', true);
    error(''); show($('publishDialog')); ready();
  }
  function logout() { xhr?.abort(); token = ''; user = null; capabilities = {}; uploads = []; $('tokenInput').value = ''; $('mainPackageSelect').replaceChildren(el('option', { value: '' }, '先选择并上传文件')); onUserChange(null); toast('已退出，访问令牌已从本页内存清除。'); }
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const candidate = $('tokenInput').value.trim(); if (!candidate) return;
    $('loginSubmit').disabled = true; $('loginSubmit').textContent = '正在验证…'; $('loginError').hidden = true;
    const previous = token; token = candidate;
    try {
      const data = await api('api/auth/me'); user = data.user; capabilities = data.capabilities ?? {};
      if (!user) throw new Error('市场没有返回账号信息。');
      $('tokenInput').value = ''; $('loginDialog').close(); onUserChange(user); toast(`已登录为 ${user.name ?? user.id}`);
      if (openAfterLogin) { openAfterLogin = false; open(); }
    } catch (failure) { token = previous; $('loginError').textContent = failure.message; $('loginError').hidden = false; }
    finally { $('loginSubmit').disabled = false; $('loginSubmit').textContent = '登录'; }
  });
  $('loginDialog').addEventListener('close', () => { $('tokenInput').value = ''; });
  document.querySelectorAll('input[name="uploadMode"]').forEach(input => input.addEventListener('change', () => { const bundle = mode() === 'bundle'; $('tgzFields').hidden = bundle; $('bundleFields').hidden = !bundle; $('metadataFields').hidden = bundle; error(''); ready(); }));
  $('packageFiles').addEventListener('change', () => {
    uploads = []; $('mainPackageSelect').disabled = true; $('mainPackageSelect').replaceChildren(el('option', { value: '' }, '先选择并上传文件')); error('');
    $('selectedFiles').replaceChildren(...[...$('packageFiles').files].map(file => el('li', {}, el('span', {}, file.name), el('span', {}, bytes(file.size)))));
    ready();
  });
  $('bundleFile').addEventListener('change', () => { const file = $('bundleFile').files[0]; $('bundleFileName').textContent = file ? `${file.name} · ${bytes(file.size)}` : ''; error(''); ready(); });
  $('mainPackageSelect').addEventListener('change', ready);
  function upload(file, before, total) {
    return new Promise((resolve, reject) => {
      xhr = new XMLHttpRequest(); xhr.open('POST', apiUrl(`api/uploads?filename=${encodeURIComponent(file.name)}`)); xhr.setRequestHeader('authorization', `Bearer ${token}`); xhr.setRequestHeader('content-type', 'application/octet-stream'); xhr.setRequestHeader('x-starmind-market-request', '1'); xhr.timeout = 10 * 60 * 1000;
      xhr.upload.onprogress = event => { if (!event.lengthComputable) return; const progress = Math.min(100, Math.round((before + event.loaded) / total * 100)); $('uploadProgress').value = progress; $('uploadProgressPercent').textContent = `${progress}%`; };
      xhr.onload = () => {
        let body; try { body = JSON.parse(xhr.responseText); } catch { reject(new Error(`上传返回了无法读取的响应（HTTP ${xhr.status}）。`)); return; }
        if (xhr.status < 200 || xhr.status >= 300) reject(new Error(errorText(body))); else if (!body.upload?.id) reject(new Error('上传完成但市场未返回包身份，请重新上传。')); else resolve(body.upload);
      };
      xhr.onerror = () => reject(new Error('上传连接中断，请检查公司网络后重新上传。'));
      xhr.ontimeout = () => reject(new Error('上传超时，请检查包大小和网络。'));
      xhr.onabort = () => reject(new Error('上传已取消；尚未发布插件。'));
      xhr.send(file);
    });
  }
  $('uploadPackagesButton').addEventListener('click', async () => {
    const files = [...$('packageFiles').files]; if (!files.length || busy) return;
    if (files.some(file => !file.name.endsWith('.tgz'))) return error('请选择文件名以 .tgz 结尾的原始包文件，离线 JSON 包请切换到导入方式。');
    busy = true; uploads = []; ready(); error(''); $('uploadProgressBox').hidden = false; $('uploadProgress').value = 0; $('uploadProgressPercent').textContent = '0%';
    const total = files.reduce((sum, file) => sum + file.size, 0) || 1; let before = 0;
    try {
      for (let i = 0; i < files.length; i++) { $('uploadProgressLabel').textContent = `正在上传 ${i + 1}/${files.length}：${files[i].name}`; uploads.push(await upload(files[i], before, total)); before += files[i].size; }
      const candidates = uploads.filter(item => item.bundle === true);
      $('mainPackageSelect').replaceChildren(...candidates.map(item => el('option', { value: item.id }, `${item.name}@${item.version}`))); $('mainPackageSelect').disabled = !candidates.length;
      if (!candidates.length) throw new Error('这些包中没有声明 DSH bundle 的主插件，请补充主插件 .tgz。');
      $('uploadProgress').value = 100; $('uploadProgressPercent').textContent = '100%'; $('uploadProgressLabel').textContent = `已读取 ${uploads.length} 个包，请确认主插件后发布。`;
    } catch (failure) { uploads = []; error(failure.message); }
    finally { busy = false; xhr = null; ready(); }
  });
  $('publishDialog').addEventListener('close', () => { if (xhr) xhr.abort(); });
  $('publishForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; error(''); busy = true; ready();
    try {
      let data;
      if (mode() === 'bundle') {
        const file = $('bundleFile').files[0]; if (!file) throw new Error('请选择离线包。');
        // Import format is JSON/base64; enforce an explicit memory bound before parsing.
        if (file.size > 384 * 1024 * 1024) throw new Error('离线 JSON 包超过 384 MB，请改用管理员命令导入，避免浏览器内存不足。');
        let bundle; try { bundle = JSON.parse(await file.text()); } catch { throw new Error('无法读取离线包 JSON，请下载完整的 .bundle.json 文件。'); }
        if (bundle?.schema !== 'starmind.enterprise-market.bundle' || bundle.schemaVersion !== 1) throw new Error('离线包格式不受支持，需要 starmind.enterprise-market.bundle v1。');
        data = await api('api/import', { method: 'POST', body: JSON.stringify(bundle) });
      } else {
        const main = uploads.find(item => item.id === $('mainPackageSelect').value); if (!main) throw new Error('请先上传文件并选择主插件。');
        const request = { plugin: { name: main.name, version: main.version }, uploadIds: uploads.map(item => item.id) };
        for (const [field, id] of [['title', 'publishName'], ['description', 'publishDescription'], ['category', 'publishCategory'], ['readme', 'publishReadme']]) { const value = $(id).value.trim(); if (value) request[field] = value; }
        data = await api('api/releases', { method: 'POST', body: JSON.stringify(request) });
      }
      $('publishDialog').close(); toast(`已发布 ${data.release?.name ?? '插件'}${data.release?.version ? ` v${data.release.version}` : ''}。`); uploads = []; $('publishForm').reset(); $('selectedFiles').replaceChildren(); $('mainPackageSelect').replaceChildren(el('option', { value: '' }, '先选择并上传文件')); $('bundleFileName').textContent = ''; $('uploadProgressBox').hidden = true; $('tgzFields').hidden = false; $('bundleFields').hidden = true; $('metadataFields').hidden = false; onPublished();
    } catch (failure) { error(failure.message); }
    finally { busy = false; ready(); }
  });
  async function renderMine(grid) {
    const data = await api('api/releases/mine'), releases = data.releases ?? [];
    grid.replaceChildren(...releases.map(release => {
      const withdrawn = release.withdrawn || release.status === 'withdrawn', name = release.name, title = text(release.title, name), actions = el('div', { className: 'card-actions' });
      const download = downloadUrl(release.downloadUrl, release.id); if (download) actions.append(el('a', { className: 'button secondary', href: download, download: '' }, '下载'));
      if (!withdrawn) actions.append(el('button', { className: 'button ghost', type: 'button', onClick: async event => {
        const button = event.currentTarget;
        if (!await messageBox('撤回这个版本？', `${name}@${release.version}\n撤回后停止新的市场发现；已安装、已下载的包与历史锁文件仍然可用。`, '撤回版本', true)) return;
        button.disabled = true;
        try { await api(`api/releases/${encodeURIComponent(release.id)}/withdraw`, { method: 'POST', body: '{}' }); toast('已撤回此发布版本。'); await renderMine(grid); onPublished(); } catch (failure) { toast(failure.message, true); button.disabled = false; }
      } }, '撤回'));
      return el('article', { className: 'plugin-card' }, el('div', { className: 'card-top' }, icon(title), el('div', { className: 'card-title' }, el('button', { className: 'title-button', type: 'button', onClick: () => openDetail(name, release) }, title), el('span', { className: 'package-name' }, name))), el('p', { className: 'card-description' }, text(release.description, '暂无简介。')), el('div', { className: 'card-meta' }, el('span', { className: `tag ${withdrawn ? 'warning' : 'success'}` }, withdrawn ? '已撤回' : '已发布'), el('span', {}, date(release.publishedAt)), el('span', {}, `${release.packageCount ?? release.packages?.length ?? 0} 个包`)), el('div', { className: 'card-bottom' }, el('span', { className: 'version' }, `v${release.version}`), actions));
    }));
    return releases.length;
  }
  return { get token() { return token; }, get user() { return user; }, login, logout, open, renderMine };
}
