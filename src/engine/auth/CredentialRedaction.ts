import type { JustRequest } from '../../models/Request';

const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'cookie2', 'x-api-key', 'api-key']);
export function isCredentialHeader(name: string): boolean { return SENSITIVE_HEADERS.has(name.toLowerCase()); }
export function isCredentialPlaceholder(value: string): boolean {
  return /^(?:(?:Bearer|Basic)\s+)?<(?:REDACTED|BEARER_TOKEN|BASIC_CREDENTIALS|API_KEY|AUTH_CONFLICT)>$/i.test(value);
}

/** Shared by collection export, previews, and every generated snippet. */
export function redactRecognizedCredentials(request: JustRequest): JustRequest {
  const copy = JSON.parse(JSON.stringify(request)) as JustRequest;
  for (const header of copy.headers) {
    if (isCredentialHeader(header.key) && !isCredentialPlaceholder(header.value)) {
      header.value = '<REDACTED>';
    }
  }
  try {
    const url = new URL(copy.url);
    if (copy.auth.type === 'apiKey' && copy.auth.in === 'query' && url.searchParams.has(copy.auth.name)) {
      url.searchParams.set(copy.auth.name, '<API_KEY>');
      copy.url = url.toString();
    }
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
      copy.url = url.toString();
      if (copy.auth.type === 'none' && !copy.headers.some(header => header.enabled && header.key.toLowerCase() === 'authorization')) {
        copy.headers.push({ id: 'url-auth-placeholder', key: 'Authorization', value: 'Basic <BASIC_CREDENTIALS>', enabled: true });
      }
    }
  } catch { /* Variable templates and incomplete editor URLs are preserved. */ }
  return copy;
}
