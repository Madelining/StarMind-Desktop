import { gzipSync } from 'node:zlib';
export function makeTarball(manifest, extra = {}, typeOverride) {
  const files = { 'package/package.json': JSON.stringify(manifest), 'package/index.js': 'export function apply(ctx) {};\n', ...extra };
  if (manifest.dsh?.bundle?.patch) files['package/' + manifest.dsh.bundle.patch.replace(/^\.\//, '')] = "- insert:\n    - id: test-market-plugin\n      name: '" + manifest.name + "'\n";
  const blocks = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    const octal = (value, position, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', position, length, 'ascii');
    octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(body.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write(typeOverride ?? '0', 156); header.write('ustar\0', 257, 6); header.write('00', 263, 2);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
export const plugin = (version = '1.0.0', extra = {}) => ({
  name: '@company/example', version, type: 'module', exports: './index.js',
  engines: { dsh: '>=0.2.2-alpha.2 <0.3.0' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, ...extra,
});
