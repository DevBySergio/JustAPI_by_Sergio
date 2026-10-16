import { randomUUID } from 'node:crypto';
import { ENV_FILE_LIMITS, type EnvDiagnostic } from '../../models/Environment';
import type { Variable } from '../../models/Variable';

/** Literal dotenv assignments only. No process variables, shell evaluation or file references. */
export function parseEnv(content: string): { variables: Variable[]; diagnostics: EnvDiagnostic[] } {
  if (Buffer.byteLength(content, 'utf8') > ENV_FILE_LIMITS.bytes || content.includes('\0')) {
    throw new Error('The environment file exceeds the limit or contains binary data.');
  }
  const lines = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const variables: Variable[] = []; const diagnostics: EnvDiagnostic[] = []; const names = new Set<string>();
  const report = (line: number, code: EnvDiagnostic['code']) => { if (diagnostics.length < 200) { diagnostics.push({ line, code }); } };
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1; const source = lines[index].trim();
    if (!source || source.startsWith('#')) { continue; }
    const assignment = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(source);
    if (!assignment) { report(line, 'INVALID_ASSIGNMENT'); continue; }
    const key = assignment[1]; let value = assignment[2];
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) { report(line, 'INVALID_NAME'); continue; }
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      let combined = value.slice(1); let end = -1; let cursor = 0;
      for (;;) {
        for (; cursor < combined.length; cursor++) {
          if (combined[cursor] === quote) { end = cursor; break; }
          if (quote === '"' && combined[cursor] === '\\') { cursor++; }
        }
        if (end >= 0 || index + 1 >= lines.length) { break; }
        combined += '\n' + lines[++index];
      }
      if (end < 0) { report(line, 'UNTERMINATED_QUOTE'); continue; }
      const tail = combined.slice(end + 1).trim();
      if (tail && !tail.startsWith('#')) { report(line, 'TRAILING_CONTENT'); continue; }
      value = combined.slice(0, end);
      if (quote === '"') { value = value.replace(/\\([nr"\\])/g, (_match, escape: string) => ({ n: '\n', r: '\r', '"': '"', '\\': '\\' })[escape]!); }
    } else { value = value.split('#', 1)[0].trim(); }
    if (names.has(key)) { report(line, 'DUPLICATE_NAME'); continue; }
    names.add(key);
    if (value.length > ENV_FILE_LIMITS.valueCharacters) { report(line, 'VALUE_TOO_LARGE'); continue; }
    if (variables.length >= ENV_FILE_LIMITS.variables) { report(line, 'TOO_MANY_VARIABLES'); break; }
    variables.push({ id: randomUUID(), key, value, enabled: true, scope: 'collection' });
  }
  return { variables, diagnostics };
}
