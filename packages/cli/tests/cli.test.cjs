'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const CLI = path.resolve(__dirname, '../skills/vanblog/scripts/vanblog.js');
const TOKEN = 'test-api-token-never-print';

async function fixture(t, handler) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vanblog-cli-'));
  const calls = [];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const call = { method: req.method, url: new URL(req.url, 'http://localhost'), headers: req.headers, body };
      calls.push(call);
      res.setHeader('content-type', 'application/json');
      await handler(call, res, calls);
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ message: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    fs.rmSync(folder, { recursive: true, force: true });
  });
  function run(args, env = {}, script = CLI) {
    return new Promise(resolve => execFile(process.execPath, [script, ...args], {
      cwd: folder, env: { ...process.env, VANBLOG_URL: url, VANBLOG_API_TOKEN: TOKEN, ...env }, maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => resolve({ code: error?.code || 0, stdout, stderr })));
  }
  function file(name, body) {
    const filename = path.join(folder, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, body); return filename;
  }
  return { folder, calls, url, run, file };
}
function json(res, data, statusCode = 200) { res.end(JSON.stringify({ statusCode, data })); }
function ok(result) { assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout); }

test('publishing context includes admin categories and tags, including hidden categories', async t => {
  const f = await fixture(t, (call, res) => {
    if (call.url.pathname === '/api/public/meta') return json(res, { meta: { siteInfo: { siteName: 'Blog' }, categories: ['公开'] }, tags: ['公开标签'] });
    if (call.url.pathname === '/api/admin/category/all') return json(res, ['公开', '隐藏分类']);
    if (call.url.pathname === '/api/admin/tag/all') return json(res, ['公开标签', '隐藏标签']);
    res.statusCode = 404; res.end('{}');
  });
  const context = ok(await f.run(['info']));
  assert.deepEqual(context.categories, ['公开', '隐藏分类']);
  assert.deepEqual(context.tags, ['公开标签', '隐藏标签']);
  assert.equal(context.siteName, 'Blog');
});

test('generic API supports arbitrary routes, HTTP methods, JSON files and encoded/repeated parameters', async t => {
  const f = await fixture(t, (call, res) => json(res, { method: call.method, path: call.url.pathname, query: [...call.url.searchParams],
    header: call.headers['x-extra'], body: call.body.length ? JSON.parse(call.body) : null }));
  const payload = f.file('字段.json', JSON.stringify({ enabled: false, values: ['摄影', 4] }));
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const result = ok(await f.run(['api', 'request', method, '/api/admin/future/{name}', '--param', 'name=摄影 / A',
      '--query', 'tag=一', '--query', 'tag= two ', '--header', 'X-Extra: yes',
      ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? ['--json', '@' + payload] : [])]));
    if (method === 'HEAD') assert.equal(result.status, 200);
    else {
      assert.equal(result.data.path, '/api/admin/future/%E6%91%84%E5%BD%B1%20%2F%20A');
      assert.deepEqual(result.data.query, [['tag', '一'], ['tag', ' two ']]);
      assert.equal(result.data.header, 'yes');
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) assert.equal(result.data.body.enabled, false);
    }
  }
  assert.ok(f.calls.every(call => call.headers.token === TOKEN && !call.headers.authorization));
  for (const value of ['[1,"二"]', 'false', '"hello"']) {
    const result = ok(await f.run(['api', 'request', 'POST', '/new-api', '--json', value]));
    assert.deepEqual(result.data.body, JSON.parse(value));
  }
});

test('11 images are uploaded byte-for-byte as multipart; output contains only a URL manifest', async t => {
  const originals = [];
  const f = await fixture(t, (call, res, calls) => {
    const boundary = call.headers['content-type'].split('boundary=')[1];
    const start = call.body.indexOf(Buffer.from('\r\n\r\n')) + 4;
    const end = call.body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
    assert.deepEqual(call.body.subarray(start, end), originals[calls.length - 1]);
    assert.equal(Number(call.headers['content-length']), call.body.length);
    assert.equal(call.url.searchParams.get('withWaterMark'), 'false');
    json(res, { src: `/static/${calls.length}.png`, isNew: true });
  });
  for (let i = 0; i < 11; i++) {
    const bytes = crypto.randomBytes(70000 + i); originals.push(bytes);
    f.file(`图 片/${String(i).padStart(2, '0')}.png`, bytes);
  }
  f.file('图 片/notes.txt', 'do not upload');
  const manifestFile = path.join(f.folder, 'manifest.json');
  const run = await f.run(['images', 'upload', path.join(f.folder, '图 片'), '--watermark', 'false', '--output', manifestFile]);
  const result = ok(run);
  assert.equal(result.output, manifestFile);
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  assert.equal(manifest.images.length, 11); assert.deepEqual(manifest.failed, []);
  assert.ok(manifest.images.every(item => item.url.startsWith(f.url) && item.markdown.includes(item.url)));
  assert.ok(JSON.stringify(manifest).length < 7000);
  assert.ok(!run.stdout.includes('base64'));
  assert.ok(!JSON.stringify(manifest).includes(originals[0].toString('base64')));
});

test('recursive directories deduplicate inputs and partial failures retain successful URLs', async t => {
  const f = await fixture(t, (call, res, calls) => {
    if (calls.length === 2) return json(res, null, 500);
    json(res, { src: '/img/ok.png' });
  });
  const first = f.file('images/a.png', 'a'); f.file('images/sub/b.jpg', 'b'); f.file('images/sub/c.png', 'c');
  const result = await f.run(['images', 'upload', path.join(f.folder, 'images'), first, '--recursive']);
  assert.equal(result.code, 3); const output = JSON.parse(result.stdout);
  assert.equal(output.images.length, 2); assert.equal(output.failed.length, 1); assert.equal(f.calls.length, 3);
});

test('batch authentication failures stop remaining uploads and redact error tokens', async t => {
  const f = await fixture(t, (call, res) => res.end(JSON.stringify({ statusCode: 401, message: TOKEN })));
  const a = f.file('a.png', 'a'), b = f.file('b.png', 'b');
  const result = await f.run(['images', 'upload', a, b]);
  assert.equal(result.code, 3); assert.equal(f.calls.length, 1);
  assert.equal(JSON.parse(result.stdout).failed.length, 2); assert.ok(!result.stdout.includes(TOKEN));
});

test('generic multipart handles files and text; raw bodies and binary downloads preserve bytes', async t => {
  const bytes = crypto.randomBytes(200000);
  const f = await fixture(t, (call, res) => {
    if (call.url.pathname === '/download') { res.setHeader('content-type', 'application/octet-stream'); return res.end(bytes); }
    if (call.url.pathname === '/raw') { assert.deepEqual(call.body, bytes); return json(res, true); }
    assert.ok(call.body.includes(bytes)); assert.ok(call.body.includes(Buffer.from(' 保留空格 ')));
    json(res, true);
  });
  const input = f.file('备 份.zip', bytes);
  ok(await f.run(['api', 'request', 'POST', '/api/admin/backup/import', '--form', `file=@${input}`, '--form', 'note= 保留空格 ']));
  ok(await f.run(['api', 'request', 'PATCH', '/raw', '--body-file', input]));
  const output = path.join(f.folder, 'download.bin');
  ok(await f.run(['api', 'request', 'GET', '/download', '--output', output]));
  assert.deepEqual(fs.readFileSync(output), bytes);
  assert.equal((await f.run(['api', 'request', 'GET', '/download'])).code, 1);
});

test('draft save, update, publish and article read avoid printing content/password', async t => {
  let draft, article, publications = 0;
  const f = await fixture(t, (call, res) => {
    const route = call.url.pathname;
    if (route === '/api/admin/draft/publish') {
      publications++; assert.equal(call.url.searchParams.get('id'), '3');
      article = { ...draft, id: 19, ...JSON.parse(call.body) }; draft = null; return json(res, article);
    }
    if (route === '/api/admin/draft' && call.method === 'POST') { draft = { id: 3, ...JSON.parse(call.body) }; return json(res, draft); }
    if (route === '/api/admin/draft/3' && call.method === 'PUT') { Object.assign(draft, JSON.parse(call.body)); return json(res, { matchedCount: 1 }); }
    if (route === '/api/admin/draft/3') return json(res, draft);
    if (route === '/api/admin/article/19' && call.method === 'DELETE') { article = null; return json(res, {}); }
    if (route === '/api/admin/article/19') return json(res, article);
    if (route === '/api/admin/article') return json(res, { total: 1, articles: [article] });
    res.statusCode = 404; res.end('{}');
  });
  const content = '摘要\n<!-- more -->\n正文私有标记\n![图片](https://example.com/a.png)';
  const md = f.file('article.md', content);
  const metadata = f.file('metadata.json', JSON.stringify({ password: 'article-secret' }));
  const saved = await f.run(['posts', 'save', '--title', '图文测试', '--category', '技术', '--tag', '旅行', '--content-file', md, '--fields', '@' + metadata]);
  assert.equal(ok(saved).id, 3); assert.equal(draft.content, content); assert.equal(draft.password, 'article-secret');
  assert.ok(!saved.stdout.includes('正文私有标记')); assert.ok(!saved.stdout.includes('article-secret'));
  ok(await f.run(['posts', 'save', '--id', '3', '--title', '修改标题'])); assert.equal(draft.title, '修改标题');
  const result = ok(await f.run(['posts', 'publish', '3', '--pathname', 'my-post']));
  assert.equal(result.id, 19); assert.equal(result.url, f.url + '/post/my-post'); assert.equal(publications, 1);
  const out = path.join(f.folder, 'article-out.md');
  ok(await f.run(['posts', 'get', '19', '--content-output', out])); assert.equal(fs.readFileSync(out, 'utf8'), content);
  assert.equal(ok(await f.run(['posts', 'list'])).items.length, 1);
  ok(await f.run(['posts', 'delete', '19'])); assert.equal(article, null);
});

test('publish rejects absent summary marker before sending mutation', async t => {
  const f = await fixture(t, (call, res) => json(res, { id: 1, content: '尚无摘要' }));
  const result = await f.run(['posts', 'publish', '1']);
  assert.equal(result.code, 2); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
});

test('business/HTTP errors fail without overwriting downloads; redirects never replay requests', async t => {
  let redirected = 0;
  const external = await fixture(t, (call, res) => { redirected++; json(res, true); });
  const f = await fixture(t, (call, res) => {
    if (call.url.pathname === '/redirect') { res.statusCode = 307; res.setHeader('location', external.url); return res.end(); }
    const code = Number(call.url.pathname.slice(1));
    if (code === 500) res.statusCode = 500;
    res.end(JSON.stringify({ statusCode: code, message: 'error ' + TOKEN }));
  });
  const output = f.file('existing.json', 'keep existing data');
  for (const status of [401, 403, 500, 233]) {
    const result = await f.run(['api', 'request', 'GET', '/' + status, '--output', output]);
    assert.equal(result.code, 1); assert.ok(!result.stderr.includes(TOKEN));
    assert.equal(fs.readFileSync(output, 'utf8'), 'keep existing data');
  }
  assert.equal((await f.run(['api', 'request', 'POST', '/redirect', '--json', '{}'])).code, 1);
  assert.equal(redirected, 0);
});

test('timed out writes are not retried and report uncertain state', async t => {
  const f = await fixture(t, () => {});
  const result = await f.run(['api', 'request', 'POST', '/slow', '--json', '{}', '--timeout', '0.1']);
  assert.equal(result.code, 1); assert.equal(f.calls.length, 1); assert.match(result.stderr, /勿盲目重试/);
});

test('large JSON needs file output and JSON string scalar is supported', async t => {
  const large = { text: 'x'.repeat(150000) };
  const f = await fixture(t, (call, res) => res.end(JSON.stringify(call.url.pathname === '/string' ? 'hello' : large)));
  assert.equal((await f.run(['api', 'request', 'GET', '/large'])).code, 1);
  const output = path.join(f.folder, 'large.json');
  ok(await f.run(['api', 'request', 'GET', '/large', '--output', output]));
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), large);
  assert.equal(ok(await f.run(['api', 'request', 'GET', '/string'])), 'hello');
});

test('skill is portable and offline catalog covers non-MCP capabilities and DTO details', async t => {
  const f = await fixture(t, () => {});
  const portable = path.join(f.folder, 'skill');
  fs.cpSync(path.resolve(__dirname, '../skills/vanblog'), portable, { recursive: true });
  const script = path.join(portable, 'scripts/vanblog.js');
  const env = { VANBLOG_URL: '', VANBLOG_API_TOKEN: '' };
  const list = ok(await f.run(['api', 'list'], env, script)).operations;
  assert.ok(list.length >= 120);
  for (const route of ['/api/admin/backup/import', '/api/admin/customPage/upload', '/api/admin/category', '/api/admin/audit', '/api/admin/log']) {
    assert.ok(list.some(item => item.path === route), route);
  }
  const details = ok(await f.run(['api', 'describe', 'POST', '/api/admin/draft'], env, script));
  assert.ok(JSON.stringify(details.definitions).includes('CreateDraftDto'));
  assert.equal(f.calls.length, 0);
});

test('live and file OpenAPI discovery expand referenced models including cycles', async t => {
  const document = { paths: { '/api/future/{id}': { parameters: [{ name: 'id', in: 'path' }], post: {
    operationId: 'future', requestBody: { $ref: '#/components/schemas/Future' },
  } } }, components: { schemas: { Future: { type: 'object', properties: { next: { $ref: '#/components/schemas/Future' } } } } } };
  const f = await fixture(t, (call, res) => { assert.equal(call.url.pathname, '/swagger-json'); res.end(JSON.stringify(document)); });
  assert.equal(ok(await f.run(['api', 'list', '--live'])).operations.length, 1);
  const schemaFile = path.join(f.folder, 'swagger.json');
  ok(await f.run(['api', 'schema', '--output', schemaFile]));
  const result = ok(await f.run(['api', 'describe', 'POST', '/api/future/:id', '--schema', schemaFile]));
  assert.equal(result.parameters[0].name, 'id'); assert.ok(result.definitions['#/components/schemas/Future']);
});

test('invalid paths, payloads, files and unknown flags fail locally', async t => {
  const f = await fixture(t, () => {});
  for (const args of [
    ['api', 'request', 'GET', '//evil.example/api'],
    ['api', 'request', 'GET', 'https://evil.example/api'],
    ['api', 'request', 'GET', '/{missing}'],
    ['api', 'request', 'GET', '/api', '--json', '{}'],
    ['api', 'request', 'POST', '/api', '--json', 'invalid'],
    ['api', 'request', 'POST', '/api', '--json', '{}', '--form', 'a=b'],
    ['api', 'request', 'POST', '/api', '--body-file', 'missing'],
    ['images', 'upload', f.folder], ['posts', 'get', '0'], ['info', '--token', 'not-supported'],
  ]) assert.equal((await f.run(args)).code, 2, args.join(' '));
  assert.equal(f.calls.length, 0);
});
