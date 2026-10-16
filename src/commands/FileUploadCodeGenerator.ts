import type { EffectiveRequest, EffectiveFileField } from '../engine/http/EffectiveRequest';

const q = (value: string): string => JSON.stringify(value);
const shell = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'";
const formQuote = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const parameter = (value: string): string => value.replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Recipes ask for replacement files. They never embed selected paths, opaque IDs or bytes. */
export function generateFileUploadCode(request: EffectiveRequest, language: string): string {
  const multipart = request.body.type === 'form-data';
  const files: EffectiveFileField[] = request.body.type === 'file' ? [{ name: 'body', file: request.body.file, contentType: request.body.contentType }]
    : request.body.type === 'form-data' ? request.body.files ?? [] : [];
  const fields = multipart ? request.body.fields : [];
  const headers = request.headers;
  const path = (index: number) => `<LOCAL_FILE_${index + 1}>`;
  const disposition = (field: EffectiveFileField) => `form-data; name="${parameter(field.name)}"; filename="${parameter(field.file.name)}"`;
  const timeout = request.settings.timeout;
  if (language === 'javascript' || language === 'typescript') {
    const lines = ['// Browser example: choose each file, then click Send request.', `const inputs = Array.from({ length: ${files.length} }, () => document.createElement('input'));`,
      "inputs.forEach((input, index) => { input.type = 'file'; input.setAttribute('aria-label', 'Upload file ' + (index + 1)); document.body.appendChild(input); });", 'async function main() {',
      "  const files = inputs.map(input => { const file = input.files?.[0]; if (!file) { throw new Error('Choose every upload file first.'); } return file; });",
      '  const headers = new Headers();'];
    for (const header of headers) { lines.push(`  headers.set(${q(header.name)}, ${q(header.value)});`); }
    if (multipart) {
      lines.push('  const body = new FormData();');
      for (const field of fields) { lines.push(`  body.append(${q(field.name)}, ${q(field.value)});`); }
      files.forEach((file, index) => lines.push(`  body.append(${q(file.name)}, new Blob([files[${index}]], { type: ${q(file.contentType)} }), ${q(file.file.name)});`));
    } else { lines.push(`  const body = new Blob([files[0]], { type: ${q(files[0].contentType)} });`); }
    if (!request.settings.verifySSL) { lines.push('  // Browser fetch always verifies TLS; verifySSL=false cannot be honored here.'); }
    lines.push(`  const response = await fetch(${q(request.url)}, { method: ${q(request.method)}, headers, body, redirect: ${q(request.settings.followRedirects ? 'follow' : 'manual')}, signal: AbortSignal.timeout(${timeout}) });`,
      '  console.log(response.status, await response.text());', '}', "const send = document.createElement('button'); send.textContent = 'Send request';", 'send.onclick = () => { void main().catch(console.error); }; document.body.appendChild(send);');
    return lines.join('\n');
  }
  if (language === 'python') {
    const lines = ['# Replace every <LOCAL_FILE_n> with a chosen local path.', 'import requests', 'from contextlib import ExitStack', '', 'headers = {'];
    for (const header of headers) { lines.push(`    ${q(header.name)}: ${q(header.value)},`); }
    lines.push('}', 'with ExitStack() as stack:');
    files.forEach((_, index) => lines.push(`    file${index + 1} = stack.enter_context(open(${q(path(index))}, "rb"))`));
    if (multipart) {
      lines.push('    parts = [');
      for (const field of fields) { lines.push(`        (${q(field.name)}, (None, ${q(field.value)})),`); }
      files.forEach((field, index) => lines.push(`        (${q(field.name)}, (${q(field.file.name)}, file${index + 1}, ${q(field.contentType)})),`)); lines.push('    ]');
    }
    lines.push(`    response = requests.request(${q(request.method)}, ${q(request.url)}, headers=headers, ${multipart ? 'files=parts' : 'data=file1'}, timeout=${timeout / 1000}, allow_redirects=${request.settings.followRedirects ? 'True' : 'False'}, verify=${request.settings.verifySSL ? 'True' : 'False'})`, '    print(response.status_code, response.text)'); return lines.join('\n');
  }
  if (language === 'curl') {
    const args = ['curl', '--request', shell(request.method), '--max-time', String(timeout / 1000)];
    if (request.settings.followRedirects) { args.push('--location'); } if (!request.settings.verifySSL) { args.push('--insecure'); }
    for (const header of headers) { args.push('--header', shell(`${header.name}: ${header.value}`)); }
    for (const field of fields) {
      if (/[=\r\n]/.test(field.name)) {
        args.push('--form', shell(`field="${formQuote(field.value)}";headers="${formQuote(`Content-Disposition: form-data; name="${parameter(field.name)}"`)}"`));
      } else { args.push('--form-string', shell(`${field.name}=${field.value}`)); }
    }
    if (multipart) { files.forEach((file, index) => {
      const specialName = /[=\r\n]/.test(file.name);
      args.push('--form', shell(`${specialName ? 'file' : file.name}=@"${path(index)}";filename="${parameter(file.file.name)}";type=${file.contentType}${specialName ? `;headers="${formQuote(`Content-Disposition: ${disposition(file)}`)}"` : ''}`));
    }); }
    else { args.push('--data-binary', shell(`@${path(0)}`)); }
    args.push(shell(request.url)); return '# Replace every <LOCAL_FILE_n> with a chosen local path.\n' + args.join(' ');
  }
  if (language === 'csharp') {
    const lines = ['// Replace every <LOCAL_FILE_n> with a chosen local path.', 'using System;', 'using System.IO;', 'using System.Net.Http;', 'using System.Net.Http.Headers;', 'using System.Text;', 'using System.Threading.Tasks;', '', 'public class ApiRequest { public static async Task Main() {',
      `  using var handler = new HttpClientHandler { AllowAutoRedirect = ${request.settings.followRedirects} };`];
    if (!request.settings.verifySSL) { lines.push('  handler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;'); }
    lines.push(`  using var client = new HttpClient(handler) { Timeout = TimeSpan.FromMilliseconds(${timeout}) };`);
    if (multipart) {
      lines.push('  using var body = new MultipartFormDataContent();');
      for (const field of fields) { lines.push(`  body.Add(new StringContent(${q(field.value)}, Encoding.UTF8), ${q(field.name)});`); }
      files.forEach((file, index) => lines.push(`  var file${index + 1} = new StreamContent(File.OpenRead(${q(path(index))}));`, `  file${index + 1}.Headers.ContentType = MediaTypeHeaderValue.Parse(${q(file.contentType)});`, `  body.Add(file${index + 1}, ${q(file.name)}, ${q(file.file.name)});`));
    } else { lines.push(`  using var body = new StreamContent(File.OpenRead(${q(path(0))}));`); }
    lines.push(`  using var request = new HttpRequestMessage(new HttpMethod(${q(request.method)}), ${q(request.url)}) { Content = body };`);
    for (const header of headers) { lines.push(header.name.toLowerCase() === 'content-type' ? `  body.Headers.ContentType = MediaTypeHeaderValue.Parse(${q(header.value)});` : `  request.Headers.TryAddWithoutValidation(${q(header.name)}, ${q(header.value)});`); }
    lines.push('  using var response = await client.SendAsync(request);', '  Console.WriteLine(await response.Content.ReadAsStringAsync());', '} }'); return lines.join('\n');
  }
  if (language === 'java') {
    const lines = ['// Replace every <LOCAL_FILE_n> with a chosen local path.', 'import java.net.URI;', 'import java.net.http.*;', 'import java.nio.file.*;', 'import java.nio.charset.StandardCharsets;', 'import java.io.ByteArrayOutputStream;', 'import java.time.Duration;', 'import java.util.UUID;',
      'public class ApiRequest { public static void main(String[] args) throws Exception {', `  var clientBuilder = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.${request.settings.followRedirects ? 'NORMAL' : 'NEVER'});`];
    if (!request.settings.verifySSL) { lines.push('  // Configure an explicit SSLContext for verifySSL=false; this sample retains JVM TLS verification.'); }
    if (multipart) {
      lines.push('  String boundary = "JustAPI-" + UUID.randomUUID();', '  var output = new ByteArrayOutputStream();');
      for (const field of fields) { lines.push(`  output.write((${q('--')} + boundary + ${q(`\r\nContent-Disposition: form-data; name="${parameter(field.name)}"\r\n\r\n${field.value}\r\n`)}).getBytes(StandardCharsets.UTF_8));`); }
      files.forEach((file, index) => lines.push(`  output.write((${q('--')} + boundary + ${q(`\r\nContent-Disposition: ${disposition(file)}\r\nContent-Type: ${file.contentType}\r\n\r\n`)}).getBytes(StandardCharsets.UTF_8));`, `  Files.copy(Path.of(${q(path(index))}), output);`, '  output.write("\\r\\n".getBytes(StandardCharsets.UTF_8));'));
      lines.push('  output.write(("--" + boundary + "--\\r\\n").getBytes(StandardCharsets.UTF_8));', '  var body = HttpRequest.BodyPublishers.ofByteArray(output.toByteArray());');
    } else { lines.push(`  var body = HttpRequest.BodyPublishers.ofFile(Path.of(${q(path(0))}));`); }
    lines.push(`  var builder = HttpRequest.newBuilder(URI.create(${q(request.url)})).timeout(Duration.ofMillis(${timeout})).method(${q(request.method)}, body);`);
    for (const header of headers) { lines.push(`  builder.header(${q(header.name)}, ${q(header.value)});`); }
    if (multipart) { lines.push('  builder.header("Content-Type", "multipart/form-data; boundary=" + boundary);'); }
    lines.push('  var response = clientBuilder.build().send(builder.build(), HttpResponse.BodyHandlers.ofString());', '  System.out.println(response.body());', '} }'); return lines.join('\n');
  }
  const lines = ['// Replace every <LOCAL_FILE_n> with a chosen local path.', 'package main', 'import (', '  "fmt"', '  "io"', '  "net/http"', '  "os"', '  "time"'];
  if (multipart) { lines.push('  "bytes"', '  "mime/multipart"', '  "net/textproto"'); }
  if (!request.settings.verifySSL) { lines.push('  "crypto/tls"'); }
  lines.push(')', 'func main() {');
  if (multipart) {
    lines.push('  var body bytes.Buffer', '  writer := multipart.NewWriter(&body)');
    for (const field of fields) { lines.push(`  if err := writer.WriteField(${q(field.name)}, ${q(field.value)}); err != nil { panic(err) }`); }
    files.forEach((file, index) => lines.push(`  file${index + 1}, err := os.Open(${q(path(index))}); if err != nil { panic(err) }; defer file${index + 1}.Close()`,
      `  part${index + 1}, err := writer.CreatePart(textproto.MIMEHeader{"Content-Disposition": {${q(disposition(file))}}, "Content-Type": {${q(file.contentType)}}}); if err != nil { panic(err) }`, `  if _, err = io.Copy(part${index + 1}, file${index + 1}); err != nil { panic(err) }`));
    lines.push('  if err := writer.Close(); err != nil { panic(err) }');
  } else { lines.push(`  body, err := os.Open(${q(path(0))}); if err != nil { panic(err) }; defer body.Close()`); }
  lines.push(`  req, err := http.NewRequest(${q(request.method)}, ${q(request.url)}, ${multipart ? '&body' : 'body'}); if err != nil { panic(err) }`);
  for (const header of headers) { lines.push(`  req.Header.Set(${q(header.name)}, ${q(header.value)})`); }
  if (multipart) { lines.push('  req.Header.Set("Content-Type", writer.FormDataContentType())'); }
  lines.push(`  client := &http.Client{Timeout: ${timeout} * time.Millisecond}`);
  if (!request.settings.followRedirects) { lines.push('  client.CheckRedirect = func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }'); }
  if (!request.settings.verifySSL) { lines.push('  client.Transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}'); }
  lines.push('  res, err := client.Do(req); if err != nil { panic(err) }; defer res.Body.Close()', '  data, err := io.ReadAll(res.Body); if err != nil { panic(err) }; fmt.Println(res.StatusCode, string(data))', '}'); return lines.join('\n');
}
