/** Redact editor drafts too: variable protocols and incomplete authorities are not yet valid URLs. */
export function redactUrlUserInfo(value: string): { value: string; redacted: boolean } {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = ''; url.password = '';
      return { value: url.toString(), redacted: true };
    }
    return { value, redacted: false };
  } catch { /* Fall back to the authority boundary without interpreting path or query at signs. */ }
  const authority = /^(\s*(?:https?:[/\\]*|(?:[^\s/\\?#]+:)?[/\\]{2}))([^/\\?#]*)/i.exec(value);
  const separator = authority?.[2].lastIndexOf('@') ?? -1;
  if (!authority || separator < 0) { return { value, redacted: false }; }
  return { value: authority[1] + authority[2].slice(separator + 1) + value.slice(authority[0].length), redacted: true };
}

export function redactUrlQueryValues(
  value: string,
  isSensitive: (name: string) => boolean,
  replacement: string
): { value: string; redacted: boolean } {
  const queryIndex = value.indexOf('?');
  const hashIndex = value.indexOf('#');
  if (queryIndex < 0 || (hashIndex >= 0 && hashIndex < queryIndex)) { return { value, redacted: false }; }
  const end = hashIndex < 0 ? value.length : hashIndex;
  const params = new URLSearchParams(value.slice(queryIndex + 1, end));
  let redacted = false;
  for (const key of Array.from(params.keys())) {
    if (isSensitive(key) && params.getAll(key).some(item => item !== '' && item !== replacement)) {
      params.set(key, replacement); redacted = true;
    }
  }
  return { value: redacted ? `${value.slice(0, queryIndex + 1)}${params.toString()}${value.slice(end)}` : value, redacted };
}
