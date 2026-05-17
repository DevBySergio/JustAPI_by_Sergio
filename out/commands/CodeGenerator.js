"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeGenerator = void 0;
class CodeGenerator {
    generate(request, language) {
        switch (language) {
            case 'javascript': return this.generateJavaScript(request);
            case 'typescript': return this.generateTypeScript(request);
            case 'python': return this.generatePython(request);
            case 'curl': return this.generateCurl(request);
            case 'csharp': return this.generateCSharp(request);
            case 'java': return this.generateJava(request);
            case 'go': return this.generateGo(request);
            default: return `// Unsupported language: ${language}`;
        }
    }
    generateJavaScript(req) {
        const lines = [];
        lines.push(`const url = '${this.escapeString(req.url)}';`);
        lines.push('');
        lines.push(`const options = {`);
        lines.push(`  method: '${req.method}',`);
        const enabledHeaders = req.headers.filter(h => h.enabled && h.key);
        if (enabledHeaders.length > 0) {
            lines.push(`  headers: {`);
            for (const h of enabledHeaders) {
                lines.push(`    '${this.escapeString(h.key)}': '${this.escapeString(h.value)}',`);
            }
            lines.push(`  },`);
        }
        if (req.body.type !== 'none' && req.body.content) {
            if (req.body.type === 'json') {
                lines.push(`  body: '${this.escapeString(req.body.content)}',`);
            }
            else {
                lines.push(`  body: '${this.escapeString(req.body.content)}',`);
            }
        }
        lines.push(`};`);
        lines.push('');
        lines.push(`try {`);
        lines.push(`  const response = await fetch(url, options);`);
        lines.push(`  const data = await response.json();`);
        lines.push(`  console.log(data);`);
        lines.push(`} catch (error) {`);
        lines.push(`  console.error('Error:', error);`);
        lines.push(`}`);
        return lines.join('\n');
    }
    generateTypeScript(req) {
        const lines = [];
        lines.push(`const url: string = '${this.escapeString(req.url)}';`);
        lines.push('');
        lines.push(`interface ResponseData {`);
        lines.push(`  [key: string]: unknown;`);
        lines.push(`}`);
        lines.push('');
        lines.push(`const options: RequestInit = {`);
        lines.push(`  method: '${req.method}',`);
        const enabledHeaders = req.headers.filter(h => h.enabled && h.key);
        if (enabledHeaders.length > 0) {
            lines.push(`  headers: {`);
            for (const h of enabledHeaders) {
                lines.push(`    '${this.escapeString(h.key)}': '${this.escapeString(h.value)}',`);
            }
            lines.push(`  } as Record<string, string>,`);
        }
        if (req.body.type !== 'none' && req.body.content) {
            if (req.body.type === 'json') {
                lines.push(`  body: '${this.escapeString(req.body.content)}',`);
            }
            else {
                lines.push(`  body: '${this.escapeString(req.body.content)}',`);
            }
        }
        lines.push(`};`);
        lines.push('');
        lines.push(`try {`);
        lines.push(`  const response = await fetch(url, options);`);
        lines.push(`  const data: ResponseData = await response.json() as ResponseData;`);
        lines.push(`  console.log(data);`);
        lines.push(`} catch (error) {`);
        lines.push(`  console.error('Error:', error);`);
        lines.push(`}`);
        return lines.join('\n');
    }
    generatePython(req) {
        const lines = [];
        lines.push(`import requests`);
        lines.push('');
        lines.push(`url = '${this.escapeString(req.url)}'`);
        const enabledHeaders = req.headers.filter(h => h.enabled && h.key);
        if (enabledHeaders.length > 0) {
            lines.push(`headers = {`);
            for (const h of enabledHeaders) {
                lines.push(`    '${this.escapeString(h.key)}': '${this.escapeString(h.value)}',`);
            }
            lines.push(`}`);
        }
        let bodyArg = '';
        if (req.body.type !== 'none' && req.body.content) {
            if (req.body.type === 'json') {
                lines.push(`import json`);
                lines.push(`data = ${req.body.content}`);
                bodyArg = `json=data`;
            }
            else if (req.body.type === 'x-www-form-urlencoded') {
                bodyArg = `data='${this.escapeString(req.body.content)}'`;
            }
            else {
                bodyArg = `data='${this.escapeString(req.body.content)}'`;
            }
        }
        const method = req.method.toLowerCase();
        const hasHeaders = enabledHeaders.length > 0;
        const args = [
            `'${this.escapeString(req.url)}'`,
            ...(hasHeaders ? ['headers=headers'] : []),
            ...(bodyArg ? [bodyArg] : []),
        ];
        lines.push(`response = requests.${method}(${args.join(', ')})`);
        lines.push(`print(response.status_code)`);
        lines.push(`print(response.text)`);
        return lines.join('\n');
    }
    generateCurl(req) {
        const parts = ['curl'];
        parts.push(`-X ${req.method}`);
        const enabledHeaders = req.headers.filter(h => h.enabled && h.key);
        for (const h of enabledHeaders) {
            parts.push(`-H '${this.escapeString(h.key)}: ${this.escapeString(h.value)}'`);
        }
        if (req.body.type !== 'none' && req.body.content) {
            parts.push(`-d '${this.escapeString(req.body.content)}'`);
        }
        if (!req.settings.verifySSL) {
            parts.push('-k');
        }
        parts.push(`'${this.escapeString(req.url)}'`);
        return parts.join(' \\\n  ');
    }
    generateCSharp(req) {
        const lines = [];
        const className = 'ApiRequest';
        lines.push(`using System.Net.Http;`);
        lines.push(`using System.Threading.Tasks;`);
        lines.push('');
        lines.push(`public class ${className}`);
        lines.push(`{`);
        lines.push(`    public static async Task ExecuteAsync()`);
        lines.push(`    {`);
        lines.push(`        var url = "${this.escapeString(req.url)}";`);
        lines.push(`        using var client = new HttpClient();`);
        const enabledHeaders = req.headers.filter(h => h.enabled && h.key);
        for (const h of enabledHeaders) {
            lines.push(`        client.DefaultRequestHeaders.Add("${this.escapeString(h.key)}", "${this.escapeString(h.value)}");`);
        }
        let contentVar = '';
        if (req.body.type !== 'none' && req.body.content) {
            const escaped = this.escapeString(req.body.content);
            if (req.body.type === 'json') {
                contentVar = '\n            var content = new StringContent(\'' + escaped + '\', System.Text.Encoding.UTF8, "application/json");';
                lines.push(contentVar);
            }
            else {
                contentVar = '\n            var content = new StringContent(\'' + escaped + '\');';
                lines.push(contentVar);
            }
        }
        if (req.method === 'GET') {
            lines.push(`        var response = await client.GetAsync(url);`);
        }
        else if (req.method === 'POST') {
            lines.push(`        var response = await client.PostAsync(url, content);`);
        }
        else if (req.method === 'PUT') {
            lines.push(`        var response = await client.PutAsync(url, content);`);
        }
        else if (req.method === 'DELETE') {
            lines.push(`        var response = await client.DeleteAsync(url);`);
        }
        else {
            lines.push(`        var request = new HttpRequestMessage(HttpMethod.${req.method}, url);`);
            if (contentVar)
                lines.push(`        request.Content = content;`);
            lines.push(`        var response = await client.SendAsync(request);`);
        }
        lines.push(`        var result = await response.Content.ReadAsStringAsync();`);
        lines.push(`        System.Console.WriteLine(result);`);
        lines.push(`    }`);
        lines.push(`}`);
        return lines.join('\n');
    }
    generateJava(req) {
        const lines = [];
        lines.push(`import java.net.http.HttpClient;`);
        lines.push(`import java.net.http.HttpRequest;`);
        lines.push(`import java.net.http.HttpResponse;`);
        lines.push(`import java.net.URI;`);
        lines.push('');
        lines.push(`public class ApiRequest {`);
        lines.push(`    public static void main(String[] args) throws Exception {`);
        lines.push(`        var client = HttpClient.newHttpClient();`);
        lines.push(`        var url = URI.create("${this.escapeString(req.url)}");`);
        lines.push('');
        const enabledHeaders = req.headers.filter(h => h.enabled && h.key);
        for (const h of enabledHeaders) {
            lines.push(`        var requestBuilder = HttpRequest.newBuilder()`);
            lines.push(`            .uri(url)`);
            lines.push(`            .header("${this.escapeString(h.key)}", "${this.escapeString(h.value)}")`);
        }
        if (req.body.type !== 'none' && req.body.content) {
            if (!enabledHeaders.length) {
                lines.push(`        var requestBuilder = HttpRequest.newBuilder()`);
                lines.push(`            .uri(url)`);
            }
            lines.push(`            .method("${req.method}", HttpRequest.BodyPublishers.ofString("${this.escapeString(req.body.content)}"))`);
            lines.push(`            .build();`);
            lines.push('');
            lines.push(`        var request = requestBuilder;`);
        }
        else if (enabledHeaders.length) {
            lines.push(`        var requestBuilder = HttpRequest.newBuilder()`);
            lines.push(`            .uri(url)`);
            lines.push(`            .method("${req.method}", HttpRequest.BodyPublishers.noBody())`);
            lines.push(`            .build();`);
            lines.push('');
            lines.push(`        var request = requestBuilder;`);
        }
        else {
            lines.push(`        var request = HttpRequest.newBuilder()`);
            lines.push(`            .uri(url)`);
            lines.push(`            .method("${req.method}", HttpRequest.BodyPublishers.noBody())`);
            lines.push(`            .build();`);
        }
        lines.push(`        var response = client.send(request, HttpResponse.BodyHandlers.ofString());`);
        lines.push(`        System.out.println(response.body());`);
        lines.push(`    }`);
        lines.push(`}`);
        return lines.join('\n');
    }
    generateGo(req) {
        const lines = [];
        lines.push(`package main`);
        lines.push('');
        lines.push(`import (`);
        lines.push(`    "fmt"`);
        lines.push(`    "io"`);
        lines.push(`    "net/http"`);
        lines.push(`    "strings"`);
        lines.push(`)`);
        lines.push('');
        lines.push(`func main() {`);
        lines.push(`    url := "${this.escapeString(req.url)}"`);
        lines.push('');
        let bodyVar = '';
        if (req.body.type !== 'none' && req.body.content) {
            lines.push(`    body := strings.NewReader("${this.escapeString(req.body.content)}")`);
            bodyVar = 'body';
        }
        const varName = bodyVar ? 'body' : 'nil';
        lines.push(`    req, err := http.NewRequest("${req.method}", url, ${varName})`);
        lines.push(`    if err != nil {`);
        lines.push(`        fmt.Println("Error:", err)`);
        lines.push(`        return`);
        lines.push(`    }`);
        const enabledHeaders = req.headers.filter(h => h.enabled && h.key);
        for (const h of enabledHeaders) {
            lines.push(`    req.Header.Set("${this.escapeString(h.key)}", "${this.escapeString(h.value)}")`);
        }
        lines.push('');
        lines.push(`    client := &http.Client{}`);
        lines.push(`    resp, err := client.Do(req)`);
        lines.push(`    if err != nil {`);
        lines.push(`        fmt.Println("Error:", err)`);
        lines.push(`        return`);
        lines.push(`    }`);
        lines.push(`    defer resp.Body.Close()`);
        lines.push('');
        lines.push(`    result, _ := io.ReadAll(resp.Body)`);
        lines.push(`    fmt.Println(string(result))`);
        lines.push(`}`);
        return lines.join('\n');
    }
    escapeString(s) {
        return s
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }
}
exports.CodeGenerator = CodeGenerator;
//# sourceMappingURL=CodeGenerator.js.map