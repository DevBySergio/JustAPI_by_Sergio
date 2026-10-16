import type { JustRequest } from '../../models/Request';
import { redactUrlQueryValues, redactUrlUserInfo } from './UrlRedaction';

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
  const userInfo = redactUrlUserInfo(copy.url);
  copy.url = userInfo.value;
  const auth = copy.auth;
  if (auth.type === 'apiKey' && auth.in === 'query') {
    copy.url = redactUrlQueryValues(copy.url, name => name === auth.name, '<API_KEY>').value;
  }
  if (userInfo.redacted && auth.type === 'none' && !copy.headers.some(header => header.enabled && header.key.toLowerCase() === 'authorization')) {
    copy.headers.push({ id: 'url-auth-placeholder', key: 'Authorization', value: 'Basic <BASIC_CREDENTIALS>', enabled: true });
  }
  return copy;
}
