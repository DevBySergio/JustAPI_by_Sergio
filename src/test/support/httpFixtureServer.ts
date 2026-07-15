import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';

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
      const status = Math.min(399, Math.max(300, Number(url.searchParams.get('status') ?? 302)));
      const location = url.searchParams.get('location') ?? '/echo?redirected=1';
      response.writeHead(status, { location });
      response.end();
      return;
    }

    if (url.pathname === '/redirect-query' && url.searchParams.get('done') !== '1') {
      response.writeHead(302, { location: '?done=1' });
      response.end();
      return;
    }

    if (url.pathname === '/redirect-loop') {
      response.writeHead(302, { location: '/redirect-loop' });
      response.end();
      return;
    }

    if (url.pathname === '/redirect-invalid') {
      response.writeHead(302, { location: 'http://[invalid-host' });
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
      const body = gzipSync(JSON.stringify({ encoding: 'gzip', compressed: true }));
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/gzip-large') {
      const uncompressedBytes = Math.min(
        Number(url.searchParams.get('bytes') ?? 2_048),
        2 * 1024 * 1024
      );
      const body = gzipSync(Buffer.alloc(uncompressedBytes, 'x'));
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-encoding': 'gzip',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/deflate') {
      const body = deflateSync(JSON.stringify({ encoding: 'deflate', compressed: true }));
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'deflate',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/brotli') {
      const body = brotliCompressSync(JSON.stringify({ encoding: 'br', compressed: true }));
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'br',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/bad-gzip') {
      const body = Buffer.from('not-gzip', 'utf8');
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/unsupported-encoding') {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'compress',
      });
      response.end('encoded');
      return;
    }

    if (url.pathname === '/charset') {
      const body = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
      response.writeHead(200, {
        'content-type': 'text/plain; charset=windows-1252',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/binary') {
      const body = Buffer.from([0x00, 0xff, 0x01, 0x02, 0x80]);
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/image') {
      const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/large') {
      const size = Math.min(Number(url.searchParams.get('bytes') ?? 1_024), 16 * 1024 * 1024);
      const body = Buffer.alloc(size, 'x');
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/stream') {
      const firstByteDelay = Math.min(Number(url.searchParams.get('firstMs') ?? 10), 500);
      const downloadDelay = Math.min(Number(url.searchParams.get('downloadMs') ?? 20), 500);
      const bytes = Math.min(Number(url.searchParams.get('bytes') ?? 32), 2 * 1024 * 1024);
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      setTimeout(() => {
        if (response.destroyed) { return; }
        const firstChunk = Math.max(1, Math.floor(bytes / 2));
        response.write(Buffer.alloc(firstChunk, 'a'));
        setTimeout(() => {
          if (!response.destroyed) {
            response.end(Buffer.alloc(bytes - firstChunk, 'b'));
          }
        }, downloadDelay);
      }, firstByteDelay);
      return;
    }

    if (url.pathname === '/close-early') {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': '100',
      });
      response.write('partial');
      response.socket?.destroy();
      return;
    }

    const body = await readBody(request);
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': 'fixture=value; Path=/; HttpOnly',
      'x-fixture-method': request.method ?? '',
    });
    response.end(JSON.stringify({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      queryEntries: Array.from(url.searchParams.entries()),
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
