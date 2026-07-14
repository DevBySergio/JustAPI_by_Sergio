import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

export interface HttpFixtureServer {
  baseUrl: string;
  close(): Promise<void>;
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function startHttpFixtureServer(): Promise<HttpFixtureServer> {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/redirect') {
      response.writeHead(302, { location: '/echo?redirected=1' });
      response.end();
      return;
    }

    if (url.pathname === '/delay') {
      const milliseconds = Math.min(Number(url.searchParams.get('ms') ?? 50), 2_000);
      setTimeout(() => {
        if (!response.destroyed) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ delayed: milliseconds }));
        }
      }, milliseconds);
      return;
    }

    if (url.pathname === '/gzip') {
      const body = gzipSync(JSON.stringify({ compressed: true }));
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/large') {
      const size = Math.min(Number(url.searchParams.get('bytes') ?? 1_024), 1_048_576);
      const body = Buffer.alloc(size, 'x');
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    const body = await readBody(request);
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': 'fixture=value; Path=/; HttpOnly',
    });
    response.end(JSON.stringify({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: request.headers,
      body,
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}
