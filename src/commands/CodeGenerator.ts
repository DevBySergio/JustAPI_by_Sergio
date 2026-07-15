import type { JustRequest } from '../models/Request';
import {
  CredentialRepresentation,
  EffectiveRequest,
  EffectiveRequestBody,
  encodeFormFields,
  normalizeEffectiveRequest,
} from '../engine/http/EffectiveRequest';

export interface CodeGenerationOptions {
  credentialRepresentation?: CredentialRepresentation;
}

const CREDENTIAL_PLACEHOLDER = /^<[_A-Z]+>$/;
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'cookie2',
  'x-api-key',
  'api-key',
]);

export class CodeGenerator {
  generate(request: JustRequest, language: string, options: CodeGenerationOptions = {}): string {
    if (!['javascript', 'typescript', 'python', 'curl', 'csharp', 'java', 'go'].includes(language)) {
      return `// Unsupported language: ${language}`;
    }
    const representation = options.credentialRepresentation ?? 'placeholder';
    const safeRequest = representation === 'resolved'
      ? request
      : this.withCredentialPlaceholders(request);
    const effective = normalizeEffectiveRequest(safeRequest, {
      credentialRepresentation: representation,
    });

    switch (language) {
      case 'javascript': return this.generateJavaScript(effective, false);
      case 'typescript': return this.generateJavaScript(effective, true);
      case 'python': return this.generatePython(effective);
      case 'curl': return this.generateCurl(effective);
      case 'csharp': return this.generateCSharp(effective);
      case 'java': return this.generateJava(effective);
      case 'go': return this.generateGo(effective);
      default: return `// Unsupported language: ${language}`;
    }
  }

  private withCredentialPlaceholders(request: JustRequest): JustRequest {
    const copy: JustRequest = {
      ...request,
      headers: request.headers.map(header => ({ ...header })),
      queryParams: request.queryParams.map(parameter => ({ ...parameter })),
      body: {
        ...request.body,
        formData: request.body.formData?.map(field => ({ ...field })),
      },
    };

    for (const header of copy.headers) {
      if (header.enabled
        && SENSITIVE_HEADER_NAMES.has(header.key.toLowerCase())
        && !this.containsCredentialPlaceholder(header.value)) {
        header.value = '<REDACTED>';
      }
    }

    switch (copy.auth.type) {
      case 'none':
        break;
      case 'bearer':
        this.injectPlaceholder(copy.headers, 'Authorization', 'Bearer <BEARER_TOKEN>');
        break;
      case 'basic':
        this.injectPlaceholder(copy.headers, 'Authorization', 'Basic <BASIC_CREDENTIALS>');
        break;
      case 'apiKey':
        this.injectPlaceholder(
          copy.auth.in === 'header' ? copy.headers : copy.queryParams,
          copy.auth.name,
          '<API_KEY>'
        );
        break;
    }
    return copy;
  }

  private injectPlaceholder(
    pairs: JustRequest['headers'],
    name: string,
    placeholder: string
  ): void {
    const existing = pairs.find(
      pair => pair.enabled && pair.key.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      if (existing.value !== placeholder && existing.value !== '<AUTH_CONFLICT>') {
        existing.value = '<AUTH_CONFLICT>';
      }
      return;
    }
    pairs.push({
      id: `codegen-placeholder-${pairs.length}`,
      key: name,
      value: placeholder,
      enabled: true,
    });
  }

  private containsCredentialPlaceholder(value: string): boolean {
    return value.split(/\s+/).some(part => CREDENTIAL_PLACEHOLDER.test(part));
  }

  private generateJavaScript(request: EffectiveRequest, typed: boolean): string {
    const lines: string[] = [];
    lines.push(`async function main()${typed ? ': Promise<void>' : ''} {`);
    lines.push(`  const url${typed ? ': string' : ''} = ${this.javascriptString(request.url)};`);

    if (request.headers.length > 0) {
      lines.push('  const headers = new Headers();');
      for (const header of request.headers) {
        lines.push(`  headers.set(${this.javascriptString(header.name)}, ${this.javascriptString(header.value)});`);
      }
    }
    const bodyExpression = this.renderJavaScriptBody(request.body, lines, typed);
    lines.push('');
    lines.push(`  const options${typed ? ': RequestInit' : ''} = {`);
    lines.push(`    method: ${this.javascriptString(request.method)},`);
    lines.push(`    redirect: ${this.javascriptString(request.settings.followRedirects ? 'follow' : 'manual')},`);
    if (request.headers.length > 0) {
      lines.push('    headers,');
    }
    if (bodyExpression) {
      lines.push(`    body: ${bodyExpression},`);
    }
    lines.push('  };');
    lines.push('');
    if (!request.settings.verifySSL) {
      lines.push('  // Browser fetch always verifies TLS certificates; it cannot honor verifySSL=false.');
    }
    lines.push('  const response = await fetch(url, options);');
    lines.push('  console.log(response.status, await response.text());');
    lines.push('}');
    lines.push('');
    lines.push('main().catch((error) => {');
    lines.push("  console.error('Request failed:', error);");
    lines.push('});');
    return lines.join('\n');
  }

  private renderJavaScriptBody(
    body: EffectiveRequestBody,
    lines: string[],
    typed: boolean
  ): string | undefined {
    switch (body.type) {
      case 'none':
        return undefined;
      case 'form-data':
        lines.push('  const body = new FormData();');
        for (const field of body.fields) {
          lines.push(`  body.append(${this.javascriptString(field.name)}, ${this.javascriptString(field.value)});`);
        }
        return 'body';
      case 'x-www-form-urlencoded':
        lines.push('  const body = new URLSearchParams();');
        for (const field of body.fields) {
          lines.push(`  body.append(${this.javascriptString(field.name)}, ${this.javascriptString(field.value)});`);
        }
        return 'body';
      default:
        lines.push(`  const body${typed ? ': string' : ''} = ${this.javascriptString(body.content)};`);
        return 'body';
    }
  }

  private generatePython(request: EffectiveRequest): string {
    const lines = ['import requests', '', `url = ${this.pythonString(request.url)}`];
    if (request.headers.length > 0) {
      lines.push('headers = {');
      for (const header of request.headers) {
        lines.push(`    ${this.pythonString(header.name)}: ${this.pythonString(header.value)},`);
      }
      lines.push('}');
    }

    let bodyArgument: string | undefined;
    switch (request.body.type) {
      case 'none':
        break;
      case 'form-data':
        lines.push('files = [');
        for (const field of request.body.fields) {
          lines.push(`    (${this.pythonString(field.name)}, (None, ${this.pythonString(field.value)})),`);
        }
        lines.push(']');
        bodyArgument = 'files=files';
        break;
      case 'x-www-form-urlencoded':
        lines.push('data = [');
        for (const field of request.body.fields) {
          lines.push(`    (${this.pythonString(field.name)}, ${this.pythonString(field.value)}),`);
        }
        lines.push(']');
        bodyArgument = 'data=data';
        break;
      default:
        lines.push(`data = ${this.pythonString(request.body.content)}`);
        bodyArgument = 'data=data';
        break;
    }

    const argumentsList = [
      this.pythonString(request.method),
      'url',
      ...(request.headers.length > 0 ? ['headers=headers'] : []),
      ...(bodyArgument ? [bodyArgument] : []),
      `allow_redirects=${request.settings.followRedirects ? 'True' : 'False'}`,
      `verify=${request.settings.verifySSL ? 'True' : 'False'}`,
      `timeout=${this.seconds(request.settings.timeout)}`,
    ];
    lines.push('');
    lines.push(`response = requests.request(${argumentsList.join(', ')})`);
    lines.push('print(response.status_code)');
    lines.push('print(response.text)');
    return lines.join('\n');
  }

  private generateCurl(request: EffectiveRequest): string {
    const parts = [`-X ${request.method}`];
    if (request.settings.followRedirects) {
      parts.push('-L');
    }
    if (!request.settings.verifySSL) {
      parts.push('-k');
    }
    for (const header of request.headers) {
      parts.push(`-H '${this.shellSingleQuoted(`${header.name}: ${header.value}`)}'`);
    }

    switch (request.body.type) {
      case 'none':
        break;
      case 'form-data':
        for (const field of request.body.fields) {
          parts.push(`--form-string '${this.shellSingleQuoted(`${field.name}=${field.value}`)}'`);
        }
        break;
      case 'x-www-form-urlencoded':
        parts.push(`--data-raw '${this.shellSingleQuoted(encodeFormFields(request.body.fields))}'`);
        break;
      default:
        parts.push(`--data-raw '${this.shellSingleQuoted(request.body.content)}'`);
        break;
    }
    parts.push(`'${this.shellSingleQuoted(request.url)}'`);
    return `curl \\\n  ${parts.join(' \\\n  ')}`;
  }

  private generateCSharp(request: EffectiveRequest): string {
    const lines = [
      'using System;',
      'using System.Collections.Generic;',
      'using System.Net.Http;',
      'using System.Text;',
      'using System.Threading.Tasks;',
      '',
      'public class ApiRequest',
      '{',
      '    public static async Task ExecuteAsync()',
      '    {',
      '        using var handler = new HttpClientHandler',
      '        {',
      `            AllowAutoRedirect = ${request.settings.followRedirects ? 'true' : 'false'},`,
    ];
    if (!request.settings.verifySSL) {
      lines.push('            ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,');
    }
    lines.push('        };');
    lines.push('        using var client = new HttpClient(handler)');
    lines.push('        {');
    lines.push(`            Timeout = TimeSpan.FromMilliseconds(${request.settings.timeout}),`);
    lines.push('        };');
    lines.push(`        using var request = new HttpRequestMessage(new HttpMethod(${this.csharpString(request.method)}), ${this.csharpString(request.url)});`);

    this.renderCSharpBody(request.body, lines);
    for (const header of request.headers) {
      const name = this.csharpString(header.name);
      const value = this.csharpString(header.value);
      lines.push(`        if (!request.Headers.TryAddWithoutValidation(${name}, ${value}))`);
      lines.push('        {');
      lines.push(`            request.Content?.Headers.Remove(${name});`);
      lines.push(`            request.Content?.Headers.TryAddWithoutValidation(${name}, ${value});`);
      lines.push('        }');
    }
    lines.push('');
    lines.push('        using var response = await client.SendAsync(request);');
    lines.push('        Console.WriteLine((int)response.StatusCode);');
    lines.push('        Console.WriteLine(await response.Content.ReadAsStringAsync());');
    lines.push('    }');
    lines.push('}');
    return lines.join('\n');
  }

  private renderCSharpBody(body: EffectiveRequestBody, lines: string[]): void {
    switch (body.type) {
      case 'none':
        return;
      case 'form-data':
        lines.push('        var content = new MultipartFormDataContent();');
        for (const field of body.fields) {
          lines.push(`        content.Add(new StringContent(${this.csharpString(field.value)}, Encoding.UTF8), ${this.csharpString(field.name)});`);
        }
        lines.push('        request.Content = content;');
        return;
      case 'x-www-form-urlencoded':
        lines.push('        var content = new FormUrlEncodedContent(new[]');
        lines.push('        {');
        for (const field of body.fields) {
          lines.push(`            new KeyValuePair<string, string>(${this.csharpString(field.name)}, ${this.csharpString(field.value)}),`);
        }
        lines.push('        });');
        lines.push('        request.Content = content;');
        return;
      default:
        lines.push(`        var content = new ByteArrayContent(Encoding.UTF8.GetBytes(${this.csharpString(body.content)}));`);
        lines.push('        request.Content = content;');
    }
  }

  private generateJava(request: EffectiveRequest): string {
    const lines = [
      'import java.net.URI;',
      'import java.net.http.HttpClient;',
      'import java.net.http.HttpRequest;',
      'import java.net.http.HttpResponse;',
      'import java.nio.charset.StandardCharsets;',
      'import java.time.Duration;',
    ];
    if (request.body.type === 'form-data') {
      lines.push('import java.util.UUID;');
    }
    lines.push('');
    lines.push('public class ApiRequest {');
    lines.push('    public static void main(String[] args) throws Exception {');
    lines.push('        var client = HttpClient.newBuilder()');
    lines.push(`            .followRedirects(HttpClient.Redirect.${request.settings.followRedirects ? 'ALWAYS' : 'NEVER'})`);
    lines.push('            .build();');
    if (!request.settings.verifySSL) {
      lines.push('        // Java HttpClient has no safe per-request TLS-verification bypass; verification remains enabled.');
    }
    lines.push(`        var url = URI.create(${this.javaString(request.url)});`);
    lines.push('');

    this.renderJavaBody(request.body, lines);
    lines.push('        var requestBuilder = HttpRequest.newBuilder()');
    lines.push('            .uri(url)');
    lines.push(`            .timeout(Duration.ofMillis(${request.settings.timeout}));`);
    for (const header of request.headers) {
      lines.push(`        requestBuilder.header(${this.javaString(header.name)}, ${this.javaString(header.value)});`);
    }
    if (request.body.type === 'form-data') {
      lines.push('        requestBuilder.header("Content-Type", "multipart/form-data; boundary=" + boundary);');
    }
    lines.push(`        var request = requestBuilder.method(${this.javaString(request.method)}, bodyPublisher).build();`);
    lines.push('');
    lines.push('        var response = client.send(request, HttpResponse.BodyHandlers.ofString());');
    lines.push('        System.out.println(response.statusCode());');
    lines.push('        System.out.println(response.body());');
    lines.push('    }');
    lines.push('}');
    return lines.join('\n');
  }

  private renderJavaBody(body: EffectiveRequestBody, lines: string[]): void {
    if (body.type === 'none') {
      lines.push('        var bodyPublisher = HttpRequest.BodyPublishers.noBody();');
      return;
    }
    if (body.type === 'form-data') {
      lines.push('        var boundary = "JustAPI-" + UUID.randomUUID();');
      lines.push('        var body = new StringBuilder();');
      for (const field of body.fields) {
        const name = field.name.replace(/\r|\n/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        lines.push('        body.append("--").append(boundary).append("\\r\\n");');
        lines.push(`        body.append("Content-Disposition: form-data; name=\\\"${this.javaStringContent(name)}\\\"\\r\\n\\r\\n");`);
        lines.push(`        body.append(${this.javaString(field.value)}).append("\\r\\n");`);
      }
      lines.push('        body.append("--").append(boundary).append("--\\r\\n");');
      lines.push('        var bodyPublisher = HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8);');
      return;
    }
    const content = body.type === 'x-www-form-urlencoded'
      ? encodeFormFields(body.fields)
      : body.content;
    lines.push(`        var bodyPublisher = HttpRequest.BodyPublishers.ofString(${this.javaString(content)}, StandardCharsets.UTF_8);`);
  }

  private generateGo(request: EffectiveRequest): string {
    const imports = new Set(['fmt', 'io', 'net/http', 'time']);
    if (request.body.type === 'form-data') {
      imports.add('bytes');
      imports.add('mime/multipart');
    } else if (request.body.type !== 'none') {
      imports.add('strings');
    }
    if (!request.settings.verifySSL) {
      imports.add('crypto/tls');
    }

    const lines = ['package main', '', 'import ('];
    for (const name of Array.from(imports).sort()) {
      lines.push(`\t${this.goString(name)}`);
    }
    lines.push(')');
    lines.push('');
    lines.push('func main() {');
    lines.push(`\trequestURL := ${this.goString(request.url)}`);
    const bodyVariable = this.renderGoBody(request.body, lines);
    lines.push(`\treq, err := http.NewRequest(${this.goString(request.method)}, requestURL, ${bodyVariable})`);
    lines.push('\tif err != nil {');
    lines.push('\t\tpanic(err)');
    lines.push('\t}');
    for (const header of request.headers) {
      lines.push(`\treq.Header.Set(${this.goString(header.name)}, ${this.goString(header.value)})`);
    }
    if (request.body.type === 'form-data') {
      lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())');
    }
    lines.push('');
    lines.push(`\tclient := &http.Client{Timeout: ${request.settings.timeout} * time.Millisecond}`);
    if (!request.settings.verifySSL) {
      lines.push('\ttransport := http.DefaultTransport.(*http.Transport).Clone()');
      lines.push('\ttransport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: true}');
      lines.push('\tclient.Transport = transport');
    }
    if (!request.settings.followRedirects) {
      lines.push('\tclient.CheckRedirect = func(req *http.Request, via []*http.Request) error {');
      lines.push('\t\treturn http.ErrUseLastResponse');
      lines.push('\t}');
    }
    lines.push('\tresp, err := client.Do(req)');
    lines.push('\tif err != nil {');
    lines.push('\t\tpanic(err)');
    lines.push('\t}');
    lines.push('\tdefer resp.Body.Close()');
    lines.push('');
    lines.push('\tresult, err := io.ReadAll(resp.Body)');
    lines.push('\tif err != nil {');
    lines.push('\t\tpanic(err)');
    lines.push('\t}');
    lines.push('\tfmt.Println(resp.StatusCode)');
    lines.push('\tfmt.Println(string(result))');
    lines.push('}');
    return lines.join('\n');
  }

  private renderGoBody(body: EffectiveRequestBody, lines: string[]): string {
    if (body.type === 'none') {
      return 'nil';
    }
    if (body.type === 'form-data') {
      lines.push('\tvar body bytes.Buffer');
      lines.push('\twriter := multipart.NewWriter(&body)');
      for (const field of body.fields) {
        lines.push(`\tif err := writer.WriteField(${this.goString(field.name)}, ${this.goString(field.value)}); err != nil {`);
        lines.push('\t\tpanic(err)');
        lines.push('\t}');
      }
      lines.push('\tif err := writer.Close(); err != nil {');
      lines.push('\t\tpanic(err)');
      lines.push('\t}');
      return '&body';
    }
    const content = body.type === 'x-www-form-urlencoded'
      ? encodeFormFields(body.fields)
      : body.content;
    lines.push(`\tbody := strings.NewReader(${this.goString(content)})`);
    return 'body';
  }

  private seconds(milliseconds: number): string {
    return Number((milliseconds / 1000).toFixed(3)).toString();
  }

  private javascriptString(value: string): string {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  private pythonString(value: string): string {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  private goString(value: string): string {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  private javaString(value: string): string {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  private javaStringContent(value: string): string {
    return this.javaString(value).slice(1, -1);
  }

  private csharpString(value: string): string {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  private shellSingleQuoted(value: string): string {
    return value.replace(/'/g, "'\\''");
  }
}
