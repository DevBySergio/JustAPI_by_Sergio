import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testRoot = fileURLToPath(new URL('../src/test/', import.meta.url));
const forbidden = [
  { label: 'focused or skipped test', pattern: /\b(?:suite|describe|context|test|it)\.(?:only|skip)\b/ },
  { label: 'disabled lint rule', pattern: /eslint-disable/ },
  { label: 'suppressed TypeScript error', pattern: /@ts-(?:ignore|nocheck)/ },
];

function collectTypeScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

const files = collectTypeScriptFiles(testRoot);
const violations = [];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) {
      violations.push(`${file}: ${rule.label}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log(`Test policy passed for ${files.length} TypeScript files.`);
