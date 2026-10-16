// 来源：simple-icons 16.35.0，CC0-1.0；输入为该包的 data/simple-icons.json。
// https://github.com/simple-icons/simple-icons/tree/16.35.0
import fs from 'node:fs';
const brands = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.writeFileSync(new URL('../bin/cli/logo-colors.json', import.meta.url),
  JSON.stringify(Object.fromEntries(brands.map(({ slug, hex }) => [slug, `#${hex}`]))) + '\n');
