import { JustRequest, HttpMethod, BodyType, createDefaultRequest } from '../../models/Request';
import { KeyValuePair } from '../../models/KeyValuePair';

export class CurlParser {
  parse(curlString: string): JustRequest {
    const req = createDefaultRequest();
    req.name = 'Imported cURL';
    req.method = 'GET';

    const trimmed = curlString.trim();
    if (!trimmed.toLowerCase().startsWith('curl')) {
      throw new Error('Not a valid cURL command');
    }

    const tokens = this.tokenize(trimmed);
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];
      switch (token) {
        case '-X':
        case '--request':
          i++;
          if (i < tokens.length) {
            req.method = tokens[i].toUpperCase() as HttpMethod;
          }
          break;
        case '-H':
        case '--header':
          i++;
          if (i < tokens.length) {
            const headerStr = this.stripQuotes(tokens[i]);
            const colonIdx = headerStr.indexOf(':');
            if (colonIdx > 0) {
              const key = headerStr.slice(0, colonIdx).trim();
              const value = headerStr.slice(colonIdx + 1).trim();
              req.headers.push({ id: crypto.randomUUID(), key, value, enabled: true });
            }
          }
          break;
        case '-d':
        case '--data':
        case '--data-raw':
        case '--data-binary':
          i++;
          if (i < tokens.length) {
            req.body.content = this.stripQuotes(tokens[i]);
            req.body.type = 'text';
            if (req.method === 'GET') req.method = 'POST';
          }
          break;
        case '--data-urlencode':
          i++;
          if (i < tokens.length) {
            if (req.body.content) req.body.content += '&';
            else req.body.content = '';
            req.body.content += this.stripQuotes(tokens[i]);
            req.body.type = 'x-www-form-urlencoded';
            if (req.method === 'GET') req.method = 'POST';
          }
          break;
        case '-F':
        case '--form':
          i++;
          if (i < tokens.length) {
            const formStr = this.stripQuotes(tokens[i]);
            const eqIdx = formStr.indexOf('=');
            if (eqIdx > 0) {
              const key = formStr.slice(0, eqIdx).trim();
              const value = formStr.slice(eqIdx + 1).trim();
              if (!req.body.formData) req.body.formData = [];
              req.body.formData.push({ id: crypto.randomUUID(), key, value, enabled: true });
              req.body.type = 'form-data';
            }
            if (req.method === 'GET') req.method = 'POST';
          }
          break;
        case '--connect-timeout':
          i++;
          if (i < tokens.length) {
            req.settings.timeout = parseInt(tokens[i], 10) * 1000 || req.settings.timeout;
          }
          break;
        case '-k':
        case '--insecure':
          req.settings.verifySSL = false;
          break;
        case '-L':
        case '--location':
          req.settings.followRedirects = true;
          break;
        default:
          if (!token.startsWith('-') && !req.url) {
            req.url = this.stripQuotes(token);
          }
          break;
      }
      i++;
    }

    if (!req.url) {
      throw new Error('No URL found in cURL command');
    }

    // Detect JSON body
    if (req.body.content) {
      const trimmedBody = req.body.content.trim();
      if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
        try {
          JSON.parse(trimmedBody);
          req.body.type = 'json';
        } catch { /* not json */ }
      }
    }

    req.updated = Date.now();
    return req;
  }

  private tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (c === "'" && !inDouble) {
        inSingle = !inSingle;
        current += c;
      } else if (c === '"' && !inSingle) {
        inDouble = !inDouble;
        current += c;
      } else if (c === ' ' && !inSingle && !inDouble) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += c;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  private stripQuotes(s: string): string {
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      return s.slice(1, -1);
    }
    return s;
  }
}
