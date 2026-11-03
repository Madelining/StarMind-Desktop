import { text } from './core.js';
export const $ = id => document.getElementById(id);
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'className') node.className = value;
    else if (key === 'onClick') node.addEventListener('click', value);
    else if (key === 'disabled') node.disabled = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
export function toast(message, error = false) {
  const node = el('div', { className: `toast${error ? ' error' : ''}` }, message);
  $('toastRegion').replaceChildren(node);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.remove(), error ? 10000 : 5000);
}
export function show(dialog) { if (!dialog.open) dialog.showModal(); }
export function messageBox(title, message, action = '确认', danger = false) {
  return new Promise(resolve => {
    const dialog = $('confirmDialog');
    if (dialog.open) { resolve(false); return; }
    $('confirmTitle').textContent = title;
    $('confirmDescription').textContent = message;
    $('confirmAccept').textContent = action;
    $('confirmAccept').className = `button ${danger ? 'danger' : 'primary'}`;
    let accepted = false;
    const done = () => { $('confirmAccept').removeEventListener('click', yes); $('confirmCancel').removeEventListener('click', no); resolve(accepted); };
    const yes = () => { accepted = true; dialog.close(); };
    const no = () => dialog.close();
    $('confirmAccept').addEventListener('click', yes);
    $('confirmCancel').addEventListener('click', no);
    dialog.addEventListener('close', done, { once: true });
    show(dialog);
  });
}
export function icon(name) {
  const value = text(name, 'P');
  let hash = 0;
  for (const letter of value) hash = (hash * 31 + letter.codePointAt(0)) | 0;
  return el('span', { className: 'plugin-icon', 'data-color': String(Math.abs(hash) % 5), 'aria-hidden': 'true' }, /[\u3400-\u9fff]/.test(value[0]) ? value[0] : value.replace(/^@[^/]+\//, '').replace(/^dsh[-_]/, '').slice(0, 1).toUpperCase() || 'P');
}
// Deliberately small Markdown renderer. Raw HTML is always a text node;
// images and remote links are never fetched just by opening a plugin page.
export function markdown(value) {
  const root = el('div', { className: 'readme' });
  const source = text(value).slice(0, 200000);
  if (!source.trim()) return el('p', { className: 'muted' }, '发布者还没有提供使用说明。');
  let code = null, list = null;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { list = null; if (code) code = null; else { code = el('code'); root.append(el('pre', {}, code)); } continue; }
    if (code) { code.append(document.createTextNode(`${line}\n`)); continue; }
    const heading = /^(#{1,5})\s+(.+)/.exec(line);
    if (heading) { list = null; root.append(el(`h${Math.min(heading[1].length + 1, 4)}`, {}, heading[2])); continue; }
    const bullet = /^\s*(?:[-*+] |\d+\. )(.+)/.exec(line);
    if (bullet) { if (!list) { list = el('ul'); root.append(list); } list.append(el('li', {}, bullet[1])); continue; }
    list = null;
    if (line.trim()) root.append(el('p', {}, line));
  }
  return root;
}
export function initUi() {
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  const applyTheme = value => { document.documentElement.dataset.theme = value; $('themeButton').setAttribute('aria-label', value === 'dark' ? '切换为浅色主题' : '切换为深色主题'); };
  let theme;
  try { theme = localStorage.getItem('starmind.market.theme'); } catch { /* Optional preference storage. */ }
  applyTheme(theme === 'dark' || theme === 'light' ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  $('themeButton').addEventListener('click', () => { const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(value); try { localStorage.setItem('starmind.market.theme', value); } catch { /* In-memory display still works. */ } });
  if (window.parent !== window) document.body.classList.add('embedded');
}
