import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { CurlImportParseResult, CurlImportWarning, CurlImportWarningCode } from '../../models/CurlImport';
import { createDefaultRequest, type BodyType, type HttpMethod, type JustRequest } from '../../models/Request';
import type { KeyValuePair } from '../../models/KeyValuePair';

export type CurlParseErrorCode =
  | 'EMPTY_COMMAND'
  | 'INPUT_TOO_LARGE'
  | 'NOT_CURL_COMMAND'
  | 'MALFORMED_QUOTING'
  | 'NO_URL'
  | 'URL_TOO_LONG';

export class CurlParseError extends Error {
  constructor(readonly code: CurlParseErrorCode, readonly tokenIndex?: number) {
    super(CurlParseError.messageFor(code));
    this.name = 'CurlParseError';
  }

  private static messageFor(code: CurlParseErrorCode): string {
    switch (code) {
      case 'EMPTY_COMMAND':
        return 'The cURL command is empty.';
      case 'INPUT_TOO_LARGE':
        return 'The cURL command exceeds the supported size.';
      case 'NOT_CURL_COMMAND':
        return 'Not a valid cURL command.';
      case 'MALFORMED_QUOTING':
        return 'The cURL command contains an unclosed quote.';
      case 'NO_URL':
        return 'No URL found in cURL command.';
      case 'URL_TOO_LONG':
        return 'The cURL URL exceeds the supported size.';
    }
  }
}

interface CurlToken {
  value: string;
  raw: string;
  index: number;
  hasShellSyntax: boolean;
}

interface TokenizationResult {
  tokens: CurlToken[];
  warnings: CurlImportWarning[];
}

interface OrderedHeader {
  pair: KeyValuePair;
  order: number;
  optionToken: CurlToken;
}

interface DataValue {
  value: string;
  kind: 'data' | 'data-raw' | 'data-binary' | 'data-urlencode';
  order: number;
  optionToken: CurlToken;
}

interface FormValue {
  pair: KeyValuePair;
  order: number;
  optionToken: CurlToken;
}

interface CredentialValue {
  value: string;
  order: number;
  optionToken: CurlToken;
}

const MAXIMUM_CURL_LENGTH = 1024 * 1024;
const MAXIMUM_URL_LENGTH = 16 * 1024;
const MAXIMUM_FIELD_NAME_LENGTH = 1024;
const MAXIMUM_FIELD_VALUE_LENGTH = 64 * 1024;
const MAXIMUM_FIELDS = 200;
const MAXIMUM_WARNINGS = 200;
const MAXIMUM_TOKENS = 100_000;
const HTTP_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const VALUE_OPTIONS = new Set([
  '-X', '--request',
  '-H', '--header',
  '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode',
  '-F', '--form',
  '--url',
  '-u', '--user',
  '-b', '--cookie',
]);
const BOOLEAN_OPTIONS = new Set(['-k', '--insecure', '-L', '--location']);
const UNSUPPORTED_VALUE_OPTIONS = new Set([
  '-A', '--user-agent', '-e', '--referer', '-m', '--max-time', '--connect-timeout',
  '--max-redirs', '--retry', '--retry-delay', '--retry-max-time', '-x', '--proxy',
  '--proxy-user', '--request-target', '--resolve', '--interface', '--cacert', '--capath',
  '--cert', '--key', '--header-file', '--cookie-jar', '-c', '--output', '-o',
  '--upload-file', '-T', '--config', '-K', '--netrc-file', '--form-string', '--json',
  '--oauth2-bearer',
]);
const DANGEROUS_OPTIONS = new Set([
  '--config', '-K', '--output', '-o', '--remote-name', '-O', '--upload-file', '-T',
  '--cert', '--key', '--netrc', '--netrc-file', '--proxy-user',
  '--oauth2-bearer',
]);

function createPair(key: string, value: string): KeyValuePair {
  return { id: randomUUID(), key, value, enabled: true };
}

function optionDisplay(token: CurlToken): string {
  const equalsIndex = token.value.indexOf('=');
  const shortPrefix = token.value.slice(0, 2);
  if (!token.value.startsWith('--')
    && token.value.length > 2
    && (VALUE_OPTIONS.has(shortPrefix) || UNSUPPORTED_VALUE_OPTIONS.has(shortPrefix))) {
    return shortPrefix;
  }
  return (token.value.startsWith('--') && equalsIndex > 2
    ? token.value.slice(0, equalsIndex)
    : token.value).slice(0, 128);
}

export class CurlParser {
  /** Backwards-compatible request-only parser. Use parseWithWarnings for import UI flows. */
  parse(curlString: string): JustRequest {
    return this.parseWithWarnings(curlString).request;
  }

  parseWithWarnings(curlString: string): CurlImportParseResult {
    if (curlString.length > MAXIMUM_CURL_LENGTH) {
      throw new CurlParseError('INPUT_TOO_LARGE');
    }
    const trimmed = curlString.trim();
    if (!trimmed) {
      throw new CurlParseError('EMPTY_COMMAND');
    }

    const tokenization = this.tokenize(trimmed);
    const tokens = tokenization.tokens;
    const warnings = [...tokenization.warnings];
    const executable = tokens[0]?.value.replace(/\\/g, '/').split('/').pop()?.toLowerCase();
    if (executable !== 'curl' && executable !== 'curl.exe') {
      throw new CurlParseError('NOT_CURL_COMMAND', 0);
    }

    const request = createDefaultRequest();
    request.name = 'Imported cURL';
    const headers: OrderedHeader[] = [];
    const dataValues: DataValue[] = [];
    const formValues: FormValue[] = [];
    const positionalUrls: CurlToken[] = [];
    const explicitUrls: Array<{ value: string; token: CurlToken; order: number }> = [];
    const cookieValues: CredentialValue[] = [];
    let userValue: CredentialValue | undefined;
    let explicitMethod: { value: string; token: CurlToken } | undefined;
    let lastBodyMode: 'data' | 'form' | undefined;
    let optionsEnded = false;

    const addWarning = (
      code: CurlImportWarningCode,
      token: CurlToken,
      message: string
    ): void => {
      warnings.push({ code, token: optionDisplay(token), tokenIndex: token.index, message });
    };

    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (optionsEnded) {
        positionalUrls.push(token);
        continue;
      }
      if (token.value === '--') {
        optionsEnded = true;
        continue;
      }
      if (!token.value.startsWith('-') || token.value === '-') {
        positionalUrls.push(token);
        continue;
      }

      const parsedOption = this.parseOptionToken(token);
      if (parsedOption.cluster) {
        for (const option of parsedOption.cluster) {
          if (option === '-k') {
            request.settings.verifySSL = false;
          } else {
            request.settings.followRedirects = true;
          }
        }
        continue;
      }

      const option = parsedOption.option;
      const takeValue = (): string | undefined => {
        if (parsedOption.inlineValue !== undefined) {
          return parsedOption.inlineValue;
        }
        const next = tokens[index + 1];
        if (!next || this.looksLikeOption(next.value)) {
          addWarning('MISSING_OPTION_VALUE', token, `${option} requires a following value.`);
          return undefined;
        }
        index += 1;
        return next.value;
      };

      if (BOOLEAN_OPTIONS.has(option)) {
        if (parsedOption.inlineValue !== undefined) {
          addWarning('AMBIGUOUS_OPTION', token, `${option} does not accept a value; the attached value was ignored.`);
        }
        if (option === '-k' || option === '--insecure') {
          request.settings.verifySSL = false;
        } else {
          request.settings.followRedirects = true;
        }
        continue;
      }

      if (VALUE_OPTIONS.has(option)) {
        const value = takeValue();
        if (value === undefined) {
          continue;
        }
        switch (option) {
          case '-X':
          case '--request':
            if (explicitMethod) {
              addWarning('AMBIGUOUS_OPTION', token, 'Multiple request methods were supplied; the last supported method wins.');
            }
            explicitMethod = { value: value.toUpperCase(), token };
            break;
          case '-H':
          case '--header': {
            const colonIndex = value.indexOf(':');
            if (colonIndex <= 0) {
              addWarning('MALFORMED_VALUE', token, 'The header was ignored because it does not contain a name followed by a colon.');
              break;
            }
            const key = value.slice(0, colonIndex).trim();
            const headerValue = value.slice(colonIndex + 1).trim();
            if (!key || key.length > MAXIMUM_FIELD_NAME_LENGTH
              || headerValue.length > MAXIMUM_FIELD_VALUE_LENGTH) {
              addWarning('MALFORMED_VALUE', token, 'The header was ignored because its name or value is invalid.');
              break;
            }
            if (headers.length >= MAXIMUM_FIELDS) {
              addWarning('MALFORMED_VALUE', token, 'The header was ignored because the import field limit was reached.');
              break;
            }
            headers.push({
              pair: createPair(key, headerValue),
              order: token.index,
              optionToken: token,
            });
            break;
          }
          case '-d':
          case '--data':
          case '--data-ascii':
          case '--data-raw':
          case '--data-binary':
          case '--data-urlencode': {
            const kind = option === '-d' || option === '--data' || option === '--data-ascii'
              ? 'data'
              : option.slice(2) as DataValue['kind'];
            const localFileReference = this.isLocalDataReference(value, kind);
            dataValues.push({
              value: localFileReference ? value : this.normalizeDataValue(value, kind),
              kind,
              order: token.index,
              optionToken: token,
            });
            lastBodyMode = 'data';
            if (localFileReference) {
              addWarning(
                'LOCAL_FILE_REFERENCE',
                token,
                'The local file reference was preserved as text; JustAPI did not read the file.'
              );
            }
            break;
          }
          case '-F':
          case '--form': {
            const equalsIndex = value.indexOf('=');
            if (equalsIndex <= 0) {
              addWarning('MALFORMED_VALUE', token, 'The form field was ignored because it does not contain name=value.');
              break;
            }
            const key = value.slice(0, equalsIndex).trim();
            const fieldValue = value.slice(equalsIndex + 1).trim();
            if (!key || key.length > MAXIMUM_FIELD_NAME_LENGTH
              || fieldValue.length > MAXIMUM_FIELD_VALUE_LENGTH) {
              addWarning('MALFORMED_VALUE', token, 'The form field was ignored because its name or value is invalid.');
              break;
            }
            if (formValues.length >= MAXIMUM_FIELDS) {
              addWarning('MALFORMED_VALUE', token, 'The form field was ignored because the import field limit was reached.');
              break;
            }
            formValues.push({ pair: createPair(key, fieldValue), order: token.index, optionToken: token });
            lastBodyMode = 'form';
            if (fieldValue.startsWith('@') || fieldValue.startsWith('<')) {
              addWarning(
                'LOCAL_FILE_REFERENCE',
                token,
                'The local file reference was preserved as an unresolved form value; JustAPI did not read the file.'
              );
            }
            break;
          }
          case '--url':
            explicitUrls.push({ value, token, order: token.index });
            break;
          case '-u':
          case '--user':
            if (userValue) {
              addWarning('AMBIGUOUS_OPTION', token, 'Multiple user credentials were supplied; the last value wins.');
            }
            userValue = { value, order: token.index, optionToken: token };
            if (!value.includes(':')) {
              addWarning(
                'AMBIGUOUS_OPTION',
                token,
                'No password separator was supplied; an empty password was used instead of prompting.'
              );
            }
            break;
          case '-b':
          case '--cookie':
            cookieValues.push({ value, order: token.index, optionToken: token });
            if (value.startsWith('@')) {
              addWarning(
                'LOCAL_FILE_REFERENCE',
                token,
                'The cookie file reference was preserved as text; JustAPI did not read the file.'
              );
            }
            break;
        }
        continue;
      }

      const warningCode = DANGEROUS_OPTIONS.has(option) ? 'DANGEROUS_OPTION' : 'UNSUPPORTED_OPTION';
      addWarning(
        warningCode,
        token,
        warningCode === 'DANGEROUS_OPTION'
          ? `${option} can access files or credentials in cURL and was not applied.`
          : `${option} is not supported and was not applied.`
      );

      if (UNSUPPORTED_VALUE_OPTIONS.has(option) && parsedOption.inlineValue === undefined) {
        const next = tokens[index + 1];
        if (next && !this.looksLikeOption(next.value)) {
          index += 1;
        } else {
          addWarning('MISSING_OPTION_VALUE', token, `${option} requires a following value.`);
        }
      } else if (parsedOption.inlineValue === undefined) {
        const next = tokens[index + 1];
        if (next && !this.looksLikeOption(next.value) && !this.looksLikeUrl(next.value)) {
          addWarning(
            'AMBIGUOUS_OPTION',
            token,
            'This option has an unknown value shape; URL selection used the surrounding tokens.'
          );
          if (tokens.slice(index + 2).some(candidate => this.looksLikeUrl(candidate.value)
            || candidate.value === '--url'
            || candidate.value.startsWith('--url='))) {
            index += 1;
          }
        }
      }
    }

    this.finalizeUrl(request, explicitUrls, positionalUrls, warnings);
    this.finalizeHeaders(request, headers, userValue, cookieValues, warnings);
    this.finalizeBody(request, dataValues, formValues, lastBodyMode, warnings);
    this.finalizeMethod(request, explicitMethod, dataValues.length > 0 || formValues.length > 0, warnings);
    request.updated = Date.now();
    return { request, warnings: warnings.slice(0, MAXIMUM_WARNINGS) };
  }

  private tokenize(input: string): TokenizationResult {
    const tokens: CurlToken[] = [];
    let value = '';
    let raw = '';
    let quote: 'single' | 'double' | undefined;
    let hasShellSyntax = false;

    const flush = (): void => {
      if (!raw) {
        return;
      }
      if (tokens.length >= MAXIMUM_TOKENS) {
        throw new CurlParseError('INPUT_TOO_LARGE', tokens.length);
      }
      tokens.push({ value, raw, index: tokens.length, hasShellSyntax });
      value = '';
      raw = '';
      hasShellSyntax = false;
    };

    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      const next = input[index + 1];
      if (quote === 'single') {
        raw += character;
        if (character === "'") {
          quote = undefined;
        } else {
          value += character;
        }
        continue;
      }
      if (quote === 'double') {
        raw += character;
        if (character === '"') {
          quote = undefined;
          continue;
        }
        if (character === '\\' && (next === '\n' || (next === '\r' && input[index + 2] === '\n'))) {
          raw += next;
          index += 1;
          if (next === '\r') {
            raw += '\n';
            index += 1;
          }
          continue;
        }
        if (character === '\\' && next !== undefined && ['"', '\\', '$', '`'].includes(next)) {
          raw += next;
          value += next;
          index += 1;
          continue;
        }
        if (character === '`' || (character === '$' && next === '(')) {
          hasShellSyntax = true;
        }
        value += character;
        continue;
      }
      if (/\s/.test(character)) {
        flush();
        continue;
      }
      if (character === "'") {
        raw += character;
        quote = 'single';
        continue;
      }
      if (character === '"') {
        raw += character;
        quote = 'double';
        continue;
      }
      if (character === '\\' && (next === '\n' || (next === '\r' && input[index + 2] === '\n'))) {
        index += 1;
        if (next === '\r') {
          index += 1;
        }
        continue;
      }
      if (character === '\\' && next !== undefined) {
        raw += character + next;
        value += next;
        index += 1;
        continue;
      }
      if (';&|<>`'.includes(character) || (character === '$' && next === '(')) {
        hasShellSyntax = true;
      }
      raw += character;
      value += character;
    }
    if (quote) {
      throw new CurlParseError('MALFORMED_QUOTING', tokens.length);
    }
    flush();

    const warnings = tokens
      .filter(token => token.hasShellSyntax)
      .map<CurlImportWarning>(token => ({
        code: 'SHELL_SYNTAX_LITERAL',
        token: optionDisplay(token),
        tokenIndex: token.index,
        message: 'Shell syntax was treated as literal text; JustAPI did not execute or expand it.',
      }));
    return { tokens, warnings };
  }

  private parseOptionToken(token: CurlToken): {
    option: string;
    inlineValue?: string;
    cluster?: Array<'-k' | '-L'>;
  } {
    if (token.value.startsWith('--')) {
      const equalsIndex = token.value.indexOf('=');
      return equalsIndex > 2
        ? { option: token.value.slice(0, equalsIndex), inlineValue: token.value.slice(equalsIndex + 1) }
        : { option: token.value };
    }
    if (token.value.length > 2) {
      const possibleCluster = token.value.slice(1).split('').map(value => `-${value}`);
      if (possibleCluster.every(value => value === '-k' || value === '-L')) {
        return { option: token.value, cluster: possibleCluster as Array<'-k' | '-L'> };
      }
      const prefix = token.value.slice(0, 2);
      if (VALUE_OPTIONS.has(prefix) || UNSUPPORTED_VALUE_OPTIONS.has(prefix)) {
        return { option: prefix, inlineValue: token.value.slice(2) };
      }
    }
    return { option: token.value };
  }

  private looksLikeOption(value: string): boolean {
    return value.length > 1 && value.startsWith('-');
  }

  private looksLikeUrl(value: string): boolean {
    return /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value)
      || /^[a-z][a-z\d+.-]*:\/\//i.test(value)
      || value.startsWith('{{');
  }

  private isLocalDataReference(value: string, kind: DataValue['kind']): boolean {
    if (kind === 'data-raw') {
      return false;
    }
    return value.startsWith('@')
      || (kind === 'data-urlencode' && /^[^=]+@/.test(value));
  }

  private normalizeDataValue(value: string, kind: DataValue['kind']): string {
    if (kind !== 'data-urlencode') {
      return value;
    }
    const equalsIndex = value.indexOf('=');
    if (equalsIndex >= 0) {
      return `${value.slice(0, equalsIndex + 1)}${encodeURIComponent(value.slice(equalsIndex + 1))}`;
    }
    return encodeURIComponent(value);
  }

  private finalizeUrl(
    request: JustRequest,
    explicitUrls: Array<{ value: string; token: CurlToken; order: number }>,
    positionalUrls: CurlToken[],
    warnings: CurlImportWarning[]
  ): void {
    const candidates = [
      ...explicitUrls.map(url => ({ value: url.value, token: url.token, explicit: true, order: url.order })),
      ...positionalUrls.map(token => ({ value: token.value, token, explicit: false, order: token.index })),
    ];
    if (candidates.length === 0) {
      throw new CurlParseError('NO_URL');
    }
    const selected = explicitUrls.length > 0
      ? candidates.filter(candidate => candidate.explicit).at(-1)!
      : candidates.filter(candidate => !candidate.explicit)[0];
    request.url = selected.value;
    if (request.url.length > MAXIMUM_URL_LENGTH) {
      throw new CurlParseError('URL_TOO_LONG', selected.token.index);
    }
    if (candidates.length > 1) {
      warnings.push({
        code: 'MULTIPLE_URLS',
        token: optionDisplay(selected.token),
        tokenIndex: selected.token.index,
        message: explicitUrls.length > 0
          ? 'Multiple URL candidates were supplied; the last --url value wins.'
          : 'Multiple positional URL candidates were supplied; the first value wins.',
      });
    }
  }

  private finalizeHeaders(
    request: JustRequest,
    headers: OrderedHeader[],
    userValue: CredentialValue | undefined,
    cookieValues: CredentialValue[],
    warnings: CurlImportWarning[]
  ): void {
    const normalized = [...headers];
    if (userValue) {
      const authorizationHeaders = normalized.filter(header => header.pair.key.toLowerCase() === 'authorization');
      const lastAuthorization = authorizationHeaders.at(-1);
      if (lastAuthorization) {
        warnings.push({
          code: 'AMBIGUOUS_OPTION',
          token: optionDisplay(userValue.optionToken),
          tokenIndex: userValue.optionToken.index,
          message: 'Both --user and an Authorization header were supplied; the later token wins.',
        });
      }
      if (!lastAuthorization || userValue.order > lastAuthorization.order) {
        const separator = userValue.value.indexOf(':');
        const username = separator >= 0 ? userValue.value.slice(0, separator) : userValue.value;
        const password = separator >= 0 ? userValue.value.slice(separator + 1) : '';
        const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
        if (authorization.length > MAXIMUM_FIELD_VALUE_LENGTH) {
          warnings.push({
            code: 'MALFORMED_VALUE',
            token: optionDisplay(userValue.optionToken),
            tokenIndex: userValue.optionToken.index,
            message: 'The Basic credential was ignored because it exceeds the import field limit.',
          });
        } else {
          for (let index = normalized.length - 1; index >= 0; index -= 1) {
            if (normalized[index].pair.key.toLowerCase() === 'authorization') {
              normalized.splice(index, 1);
            }
          }
          normalized.push({
            pair: createPair('Authorization', authorization),
            order: userValue.order,
            optionToken: userValue.optionToken,
          });
        }
      }
    }

    if (cookieValues.length > 0) {
      const cookieHeaders = normalized.filter(header => header.pair.key.toLowerCase() === 'cookie');
      const lastCookieHeader = cookieHeaders.at(-1);
      const lastCookieOption = cookieValues.at(-1)!;
      if (lastCookieHeader) {
        warnings.push({
          code: 'AMBIGUOUS_OPTION',
          token: optionDisplay(lastCookieOption.optionToken),
          tokenIndex: lastCookieOption.optionToken.index,
          message: 'Both --cookie and a Cookie header were supplied; the later token wins.',
        });
      }
      if (!lastCookieHeader || lastCookieOption.order > lastCookieHeader.order) {
        const cookieHeaderValue = cookieValues.map(cookie => cookie.value).join('; ');
        if (cookieHeaderValue.length > MAXIMUM_FIELD_VALUE_LENGTH) {
          warnings.push({
            code: 'MALFORMED_VALUE',
            token: optionDisplay(lastCookieOption.optionToken),
            tokenIndex: lastCookieOption.optionToken.index,
            message: 'The Cookie value was ignored because it exceeds the import field limit.',
          });
        } else {
          for (let index = normalized.length - 1; index >= 0; index -= 1) {
            if (normalized[index].pair.key.toLowerCase() === 'cookie') {
              normalized.splice(index, 1);
            }
          }
          normalized.push({
            pair: createPair('Cookie', cookieHeaderValue),
            order: lastCookieOption.order,
            optionToken: lastCookieOption.optionToken,
          });
        }
      }
    }
    request.headers = normalized.sort((left, right) => left.order - right.order).map(header => header.pair);
  }

  private finalizeBody(
    request: JustRequest,
    dataValues: DataValue[],
    formValues: FormValue[],
    lastBodyMode: 'data' | 'form' | undefined,
    warnings: CurlImportWarning[]
  ): void {
    if (dataValues.length > 0 && formValues.length > 0) {
      const token = lastBodyMode === 'form' ? formValues.at(-1)!.optionToken : dataValues.at(-1)!.optionToken;
      warnings.push({
        code: 'CONFLICTING_BODY_OPTIONS',
        token: optionDisplay(token),
        tokenIndex: token.index,
        message: 'Data and multipart options cannot share one JustAPI body; the body family used last wins.',
      });
    }
    if (lastBodyMode === 'form') {
      request.body = { type: 'form-data', content: '', formData: formValues.map(form => form.pair) };
      return;
    }
    if (lastBodyMode === 'data') {
      const content = dataValues.map(data => data.value).join('&');
      request.body = { type: this.detectBodyType(content, request.headers, dataValues), content };
    }
  }

  private detectBodyType(content: string, headers: KeyValuePair[], dataValues: DataValue[]): BodyType {
    const contentType = headers
      .filter(header => header.enabled && header.key.toLowerCase() === 'content-type')
      .at(-1)?.value.toLowerCase();
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        // Preserve malformed JSON as text for preview rather than changing its bytes.
      }
    }
    if (contentType?.includes('application/x-www-form-urlencoded')
      || dataValues.every(data => data.kind === 'data-urlencode')) {
      return 'x-www-form-urlencoded';
    }
    if (contentType?.includes('xml')) {
      return 'xml';
    }
    return 'text';
  }

  private finalizeMethod(
    request: JustRequest,
    explicitMethod: { value: string; token: CurlToken } | undefined,
    hasBody: boolean,
    warnings: CurlImportWarning[]
  ): void {
    request.method = hasBody ? 'POST' : 'GET';
    if (!explicitMethod) {
      return;
    }
    if (HTTP_METHODS.has(explicitMethod.value as HttpMethod)) {
      request.method = explicitMethod.value as HttpMethod;
      return;
    }
    warnings.push({
      code: 'MALFORMED_VALUE',
      token: optionDisplay(explicitMethod.token),
      tokenIndex: explicitMethod.token.index,
      message: `The method is not supported by JustAPI; ${request.method} was inferred instead.`,
    });
  }
}
