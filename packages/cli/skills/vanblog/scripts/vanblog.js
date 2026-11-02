#!/usr/bin/env node
'use strict';

// Self-contained CLI: only Node.js built-ins, also usable after copying the skill folder.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');

const MAX_RESPONSE = 32 * 1024 * 1024;
const MAX_STDOUT = 128 * 1024;
const REFERENCE = path.resolve(__dirname, '../references/api-index.json');
const MULTIPLE = new Set(['query', 'header', 'form', 'param', 'tag']);
const BOOLEAN = new Set(['help', 'live', 'recursive']);
const VALUES = new Set(['url', 'timeout', 'json', 'body-file', 'content-type', 'output', 'schema',
  'filter', 'type', 'id', 'title', 'category', 'content-file', 'content-output', 'fields',
  'page', 'page-size', 'pathname', 'cover', 'author', 'copyright', 'private', 'hidden', 'watermark', 'favicon']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.json': 'application/json',
  '.md': 'text/markdown', '.html': 'text/html', '.pdf': 'application/pdf', '.zip': 'application/zip' };
const HELP = `VanBlog CLI (Node.js >=18)

Environment: VANBLOG_URL=https://blog.example.com, VANBLOG_API_TOKEN=<existing API Token>
Optional global flags: --url URL --timeout SECONDS (default 60)

  info
  images upload FILE_OR_DIRECTORY... [--recursive] [--watermark true|false] [--output manifest.json]
  posts list [--type article|draft] [--title TEXT] [--category NAME] [--tag TAG] [--page N] [--page-size N]
  posts get ID [--type article|draft] [--content-output article.md] [--output metadata.json]
  posts save [--type draft|article] [--id ID] --content-file article.md --title TITLE --category NAME
             [--tag TAG] [--fields @metadata.json] [--output metadata.json]
  posts publish ID [--pathname SLUG] [--fields @options.json] [--output result.json]
  posts delete ID [--type article|draft]

Complete API access (no endpoint allowlist):
  api list [--filter WORD] [--live | --schema swagger.json]
  api describe METHOD PATH [--live | --schema swagger.json]
  api schema [--output swagger.json]
  api request METHOD PATH [--param key=value] [--query key=value] [--header 'Name: value']
              [--json @payload.json | --form file=@file.zip --form name=value | --body-file FILE]
              [--content-type TYPE] [--output FILE]

JSON arguments accept an inline JSON value or @file. Markdown and files are read locally.
Uploads are streamed as multipart binary; no Base64 is generated or printed.
Use --output for downloads/large API results. Write requests are never automatically retried.
Exit codes: 0 success, 1 API/network error, 2 usage/local-file error, 3 partial batch upload failure.
`;

class CliError extends Error {
  constructor(message, exitCode = 1, status) { super(message); this.exitCode = exitCode; this.status = status; }
}
function parse(argv) {
  const args = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { args.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('--')) { args.push(arg); continue; }
    const at = arg.indexOf('=');
    const key = arg.slice(2, at < 0 ? undefined : at);
    if (BOOLEAN.has(key)) {
      if (at >= 0) throw new CliError(`--${key} 不接受参数。`, 2);
      options[key] = true; continue;
    }
    if (!VALUES.has(key) && !MULTIPLE.has(key)) throw new CliError(`未知选项 --${key}，请运行 --help。`, 2);
    const value = at < 0 ? argv[++i] : arg.slice(at + 1);
    if (value === undefined || (at < 0 && value.startsWith('--'))) throw new CliError(`--${key} 缺少参数。`, 2);
    if (MULTIPLE.has(key)) (options[key] ||= []).push(value);
    else options[key] = value;
  }
  return { args, options };
}
function pairs(items = [], separator = '=') {
  return items.map(item => {
    const at = item.indexOf(separator);
    if (at < 1) throw new CliError(`参数必须使用 key${separator}value 格式：${item.split(separator)[0]}`, 2);
    return [item.slice(0, at).trim(), separator === ':' ? item.slice(at + 1).trim() : item.slice(at + 1)];
  });
}
function jsonInput(value) {
  try { return JSON.parse(value.startsWith('@') ? fs.readFileSync(value.slice(1), 'utf8') : value); }
  catch { throw new CliError('JSON 无效，或无法读取 JSON 文件。', 2); }
}
function objectInput(value) {
  const result = value ? jsonInput(value) : {};
  if (!result || Array.isArray(result) || typeof result !== 'object') throw new CliError('此命令的 JSON 参数必须为对象。', 2);
  return result;
}
function integer(value, label = 'ID') {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new CliError(`${label} 必须为正整数。`, 2);
  return number;
}
function bool(value) {
  if (value !== 'true' && value !== 'false') throw new CliError('布尔参数必须为 true 或 false。', 2);
  return value === 'true';
}
function localFile(filename) {
  const resolved = path.resolve(filename);
  try { if (fs.statSync(resolved).isFile()) return resolved; } catch { /* handled below */ }
  throw new CliError(`本地文件不存在或不是普通文件：${filename}`, 2);
}
function atomicWrite(filename, content) {
  const target = path.resolve(filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try { fs.writeFileSync(temporary, content); fs.renameSync(temporary, target); }
  finally { fs.rmSync(temporary, { force: true }); }
  return target;
}
function emit(value, output) {
  const text = JSON.stringify(value, null, 2);
  if (output) {
    const file = atomicWrite(output, text + '\n');
    process.stdout.write(JSON.stringify({ output: file, bytes: Buffer.byteLength(text + '\n') }) + '\n');
  } else {
    if (Buffer.byteLength(text) > MAX_STDOUT) throw new CliError('结果较大，请使用 --output 保存到文件。');
    process.stdout.write(text + '\n');
  }
}
function endpoint(options, route) {
  const base = options.url || process.env.VANBLOG_URL;
  if (!base) throw new CliError('请设置 VANBLOG_URL 或提供 --url。', 2);
  let parsed;
  try { parsed = new URL(base); } catch { throw new CliError('博客地址不是有效 URL。', 2); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new CliError('博客地址必须为无凭证、查询参数和 fragment 的 HTTP(S) 地址。', 2);
  }
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\') || /[\r\n#]/.test(route)) {
    throw new CliError('API 路径必须以单个 / 开头，不能包含完整 URL、反斜杠或 fragment。', 2);
  }
  for (const [key, value] of pairs(options.param)) {
    route = route.split(`{${key}}`).join(encodeURIComponent(value));
    route = route.replace(new RegExp(`:${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?(?=/|\\?|$)`, 'g'), () => encodeURIComponent(value));
  }
  if (/\{[^}]+\}/.test(route)) throw new CliError('路径参数未填充，请使用 --param name=value。', 2);
  // Prefix paths are preserved, so deployments behind a subpath also work.
  const target = new URL(parsed.href.replace(/\/$/, '') + route);
  if (target.origin !== parsed.origin) throw new CliError('拒绝向其他站点发送 API Token。', 2);
  for (const [key, value] of pairs(options.query)) target.searchParams.append(key, value);
  return target;
}
function multipart(forms) {
  const boundary = `vanblog-${crypto.randomBytes(18).toString('hex')}`;
  const parts = [];
  const safe = value => value.replace(/[\r\n]/g, '').replace(/"/g, '%22').replace(/\\/g, '%5C');
  for (const [name, value] of pairs(forms)) {
    if (value.startsWith('@')) {
      const filename = localFile(value.slice(1));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safe(name)}"; filename="${safe(path.basename(filename))}"\r\nContent-Type: ${MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream'}\r\n\r\n`));
      parts.push({ filename, size: fs.statSync(filename).size });
      parts.push(Buffer.from('\r\n'));
    } else parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safe(name)}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, parts,
    size: parts.reduce((total, part) => total + (Buffer.isBuffer(part) ? part.length : part.size), 0) };
}
function bodyPlan(options) {
  if ([options.json !== undefined, Boolean(options.form?.length), Boolean(options['body-file'])].filter(Boolean).length > 1) {
    throw new CliError('--json、--form、--body-file 不能同时使用。', 2);
  }
  if (options.json !== undefined) {
    const buffer = Buffer.from(JSON.stringify(jsonInput(options.json)));
    return { parts: [buffer], size: buffer.length, contentType: 'application/json; charset=utf-8' };
  }
  if (options.form?.length) return multipart(options.form);
  if (options['body-file']) {
    const filename = localFile(options['body-file']);
    return { parts: [{ filename, size: fs.statSync(filename).size }], size: fs.statSync(filename).size,
      contentType: options['content-type'] || 'application/octet-stream' };
  }
  return { parts: [], size: 0 };
}
function apiError(status, body) {
  const business = body && typeof body === 'object' && !Array.isArray(body) ? body.statusCode : undefined;
  if (status >= 400 || business >= 400 || business === 233) {
    const message = body?.message || (business === 233 ? '博客尚未初始化。' : JSON.stringify(body));
    throw new CliError(`API ${business || status}: ${String(message || '请求失败').slice(0, 1500)}`, 1, business || status);
  }
}
function decode(buffer, headers) {
  const text = buffer.toString('utf8');
  if (/json/i.test(headers['content-type'] || '') || /^[\s]*[\[{]/.test(text)) {
    try { return JSON.parse(text); } catch { throw new CliError('API 返回了无效 JSON。'); }
  }
  return text;
}
async function request(options, method, route, download) {
  if (!/^[A-Z]+$/.test(method)) throw new CliError('HTTP 方法必须为字母。', 2);
  const target = endpoint(options, route);
  const plan = bodyPlan(options);
  if (['GET', 'HEAD'].includes(method) && plan.parts.length) throw new CliError('GET/HEAD 不接受请求体。', 2);
  const headers = { accept: 'application/json', 'accept-encoding': 'identity' };
  const token = process.env.VANBLOG_API_TOKEN;
  if (token) headers.token = token;
  for (const [key, value] of pairs(options.header, ':')) headers[key.toLowerCase()] = value;
  if (plan.contentType) headers['content-type'] = options['content-type'] || plan.contentType;
  if (plan.parts.length) headers['content-length'] = String(plan.size);
  const seconds = Number(options.timeout || 60);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new CliError('--timeout 必须为正数。', 2);
  return new Promise((resolve, reject) => {
    let timer;
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(target, { method, headers }, async response => {
      let temporary;
      try {
        const status = response.statusCode;
        // Redirects are not followed: credentials and mutation bodies stay on this origin.
        if (status >= 300 && status < 400) { response.resume(); throw new CliError(`HTTP ${status} 重定向未跟随，请检查 VANBLOG_URL。`, 1, status); }
        if (download && status < 400) {
          const output = path.resolve(download);
          fs.mkdirSync(path.dirname(output), { recursive: true });
          temporary = `${output}.${crypto.randomBytes(8).toString('hex')}.tmp`;
          await pipeline(response, fs.createWriteStream(temporary));
          const size = fs.statSync(temporary).size;
          if (size <= 1024 * 1024 && /json/i.test(response.headers['content-type'] || '')) {
            apiError(status, decode(fs.readFileSync(temporary), response.headers));
          }
          fs.renameSync(temporary, output); temporary = undefined;
          resolve({ status, headers: response.headers, file: output, bytes: size });
        } else {
          const chunks = []; let size = 0;
          for await (const chunk of response) {
            size += chunk.length;
            if (size > MAX_RESPONSE) throw new CliError('响应超过 32 MiB，请使用 api request --output 下载。');
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          const body = buffer.length ? decode(buffer, response.headers) : null;
          apiError(status, body);
          resolve({ status, headers: response.headers, body, bytes: size });
        }
      } catch (error) { response.destroy(); reject(error); }
      finally { clearTimeout(timer); if (temporary) fs.rmSync(temporary, { force: true }); }
    });
    timer = setTimeout(() => req.destroy(new Error('请求超时')), seconds * 1000);
    req.once('error', error => {
      clearTimeout(timer);
      const uncertain = !['GET', 'HEAD', 'OPTIONS'].includes(method) ? ' 写操作结果可能已生效，请先查询状态，勿盲目重试。' : '';
      reject(new CliError(`网络请求失败：${error.code || error.message}.${uncertain}`));
    });
    (async () => {
      for (const part of plan.parts) {
        const chunks = Buffer.isBuffer(part) ? [part] : fs.createReadStream(part.filename);
        for await (const chunk of chunks) if (!req.write(chunk)) await once(req, 'drain');
      }
      req.end();
    })().catch(error => req.destroy(error));
  });
}
function data(result) {
  return result.body && Object.hasOwn(result.body, 'data') ? result.body.data : result.body;
}
function withJson(options, value, query = []) {
  return { ...options, json: JSON.stringify(value), query: [...(options.query || []), ...query], form: undefined, 'body-file': undefined };
}
function postType(options, fallback = 'article') {
  const type = options.type || fallback;
  if (!['draft', 'article'].includes(type)) throw new CliError('--type 必须为 draft 或 article。', 2);
  return type;
}
function summary(post, type, options) {
  if (!post || typeof post !== 'object') throw new CliError('文章或草稿不存在。');
  const output = { type };
  for (const key of ['id', 'title', 'category', 'tags', 'author', 'version', 'createdAt', 'updatedAt', 'pathname', 'cover', 'hidden', 'private']) {
    if (post[key] !== undefined) output[key] = post[key];
  }
  if (type === 'article') {
    const base = options.url || process.env.VANBLOG_URL;
    output.url = `${base.replace(/\/$/, '')}/post/${encodeURIComponent(post.pathname || post.id)}`;
  }
  return output;
}
async function getPost(options, type, id) {
  const post = data(await request(options, 'GET', `/api/admin/${type}/${id}`));
  if (!post || post.deleted) throw new CliError('文章或草稿不存在或已删除。');
  return post;
}
async function posts(args, options) {
  const command = args[0];
  const type = postType(options, command === 'save' ? 'draft' : 'article');
  if (command === 'list') {
    const query = ['toListView=true', `page=${integer(options.page || 1, 'page')}`, `pageSize=${integer(options['page-size'] || 10, 'page-size')}`];
    for (const key of ['title', 'category']) if (options[key]) query.push(`${key}=${options[key]}`);
    if (options.tag) query.push(`tags=${options.tag.join(',')}`);
    const result = data(await request({ ...options, query: [...(options.query || []), ...query] }, 'GET', `/api/admin/${type}`));
    return emit({ type, total: result.total, items: (result.articles || result.drafts || []).map(post => summary(post, type, options)) }, options.output);
  }
  if (command === 'get') {
    const id = integer(args[1]);
    const post = await getPost(options, type, id);
    const output = summary(post, type, options);
    if (options['content-output']) output.contentFile = atomicWrite(options['content-output'], post.content || '');
    return emit(output, options.output);
  }
  if (command === 'save') {
    const body = objectInput(options.fields);
    for (const key of ['title', 'category', 'author', 'pathname', 'cover', 'copyright']) if (options[key] !== undefined) body[key] = options[key];
    for (const key of ['hidden', 'private']) if (options[key] !== undefined) body[key] = bool(options[key]);
    if (options.tag) body.tags = options.tag;
    if (options['content-file']) body.content = fs.readFileSync(localFile(options['content-file']), 'utf8');
    if (options.id) {
      const id = integer(options.id);
      await getPost(options, type, id);
      const result = data(await request(withJson(options, body), 'PUT', `/api/admin/${type}/${id}`));
      if (result?.matchedCount === 0) throw new CliError('没有更新到目标内容。');
      return emit(summary(await getPost(options, type, id), type, options), options.output);
    }
    if (!body.title || !body.category) throw new CliError('创建内容必须提供 title 和 category。', 2);
    const post = data(await request(withJson(options, body), 'POST', `/api/admin/${type}`));
    return emit(summary(post, type, options), options.output);
  }
  if (command === 'publish') {
    const id = integer(args[1]);
    const draft = await getPost(options, 'draft', id);
    if (!String(draft.content || '').includes('<!-- more -->')) throw new CliError('发布前正文必须包含 <!-- more --> 摘要分隔符。', 2);
    const body = objectInput(options.fields);
    for (const key of ['pathname', 'copyright', 'cover']) if (options[key] !== undefined) body[key] = options[key];
    for (const key of ['hidden', 'private']) if (options[key] !== undefined) body[key] = bool(options[key]);
    const post = data(await request(withJson(options, body, [`id=${id}`]), 'POST', '/api/admin/draft/publish'));
    return emit(summary(post, 'article', options), options.output);
  }
  if (command === 'delete') {
    const id = integer(args[1]);
    await request(options, 'DELETE', `/api/admin/${type}/${id}`);
    return emit({ type, id, deleted: true }, options.output);
  }
  throw new CliError('未知 posts 命令，请运行 --help。', 2);
}
function imageFiles(inputs, recursive) {
  const found = [];
  function add(input, explicit = false) {
    const filename = path.resolve(input);
    let stat;
    try { stat = fs.statSync(filename); } catch { throw new CliError(`图片路径不存在：${input}`, 2); }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(filename, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isFile() && MIME[path.extname(entry.name).toLowerCase()]?.startsWith('image/')) add(path.join(filename, entry.name));
        else if (recursive && entry.isDirectory()) add(path.join(filename, entry.name));
      }
    } else if (stat.isFile() && (explicit || MIME[path.extname(filename).toLowerCase()]?.startsWith('image/'))) found.push(filename);
    else throw new CliError(`不是可上传的图片文件：${input}`, 2);
  }
  for (const input of inputs) add(input, true);
  return [...new Set(found)];
}
async function images(args, options) {
  if (args[0] !== 'upload' || args.length < 2) throw new CliError('使用 images upload FILE_OR_DIRECTORY...。', 2);
  const files = imageFiles(args.slice(1), options.recursive);
  if (!files.length) throw new CliError('没有找到图片。', 2);
  const output = { images: [], failed: [] };
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    try {
      const query = [`withWaterMark=${options.watermark === undefined ? 'true' : String(bool(options.watermark))}`];
      if (options.favicon !== undefined) query.push(`favicon=${bool(options.favicon)}`);
      const uploaded = data(await request({ ...options, json: undefined, 'body-file': undefined, form: [`file=@${filename}`], query }, 'POST', '/api/admin/img/upload'));
      if (!uploaded?.src) throw new CliError('上传响应缺少图片地址。');
      const url = new URL(uploaded.src, (options.url || process.env.VANBLOG_URL).replace(/\/$/, '') + '/').href;
      const alt = path.basename(filename, path.extname(filename)).replace(/[\[\]\\\r\n]/g, ' ');
      output.images.push({ file: filename, url, markdown: `![${alt}](<${url}>)`, isNew: uploaded.isNew });
    } catch (error) {
      output.failed.push({ file: filename, error: redact(error.message) });
      if (!error.status || [401, 403].includes(error.status)) {
        for (const skipped of files.slice(i + 1)) output.failed.push({ file: skipped, error: '未尝试：前一项发生认证或网络错误。' });
        break;
      }
    }
  }
  emit(output, options.output);
  return output.failed.length ? 3 : 0;
}
function canonical(route) { return route.replace(/:([A-Za-z_][\w]*)/g, '{$1}').replace(/\/$/, '') || '/'; }
async function schema(options) {
  if (options.schema) return JSON.parse(fs.readFileSync(localFile(options.schema), 'utf8'));
  if (options.live) return (await request(options, 'GET', '/swagger-json')).body;
  return JSON.parse(fs.readFileSync(REFERENCE, 'utf8'));
}
function operations(document) {
  if (Array.isArray(document.routes)) return document.routes;
  if (!document.paths) throw new CliError('文件不是 OpenAPI 文档或 VanBlog 接口索引。', 2);
  const result = [];
  for (const [route, item] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) {
      if (item[method]) result.push({ method: method.toUpperCase(), path: route, ...item[method], parameters: [...(item.parameters || []), ...(item[method].parameters || [])] });
    }
  }
  return result;
}
async function api(args, options) {
  if (args[0] === 'request') {
    if (!args[1] || !args[2]) throw new CliError('使用 api request METHOD /api/path。', 2);
    const result = await request(options, args[1].toUpperCase(), args[2], options.output);
    if (result.file) return emit({ output: result.file, bytes: result.bytes, status: result.status });
    if (result.body === null) return emit({ status: result.status });
    if (typeof result.body === 'string' && !/json/i.test(result.headers['content-type'] || '')) {
      if (!/^(text\/|application\/(xml|javascript))/i.test(result.headers['content-type'] || '')) throw new CliError('二进制响应请使用 --output 保存。');
      if (result.bytes > MAX_STDOUT) throw new CliError('响应较大，请使用 --output 保存。');
      process.stdout.write(result.body + '\n'); return;
    }
    return emit(result.body);
  }
  if (args[0] === 'schema') {
    const result = await request(options, 'GET', '/swagger-json', options.output);
    return result.file ? emit({ output: result.file, bytes: result.bytes }) : emit(result.body);
  }
  const document = await schema(options);
  if (args[0] === 'list') {
    const filter = (options.filter || '').toLowerCase();
    return emit({ source: options.live ? 'live Swagger' : options.schema || 'bundled API index', operations: operations(document)
      .filter(item => `${item.method} ${item.path} ${item.summary || ''} ${item.operationId || ''}`.toLowerCase().includes(filter))
      .map(item => ({ method: item.method, path: item.path, operationId: item.operationId, summary: item.summary })) }, options.output);
  }
  if (args[0] === 'describe') {
    const operation = operations(document).find(item => item.method === args[1]?.toUpperCase() && canonical(item.path) === canonical(args[2] || ''));
    if (!operation) throw new CliError('未找到该接口，请用 api list --filter 搜索，或添加 --live 查询当前实例。', 2);
    const refs = {};
    function collect(value) {
      if (!value || typeof value !== 'object') return;
      if (value.$ref?.startsWith('#/') && !Object.hasOwn(refs, value.$ref)) {
        const ref = value.$ref;
        refs[ref] = ref.slice(2).split('/').reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], document) ?? null;
        collect(refs[ref]);
      }
      for (const child of Object.values(value)) collect(child);
    }
    collect(operation);
    return emit({ ...operation, ...(Object.keys(refs).length ? { definitions: refs } : {}) }, options.output);
  }
  throw new CliError('未知 api 命令，请运行 --help。', 2);
}
function redact(message) {
  const token = process.env.VANBLOG_API_TOKEN;
  return token ? String(message).split(token).join('[REDACTED]') : String(message);
}
async function main(argv = process.argv.slice(2)) {
  try {
    const { args, options } = parse(argv);
    if (!args.length || options.help) { process.stdout.write(HELP); return 0; }
    if (args[0] === 'api') { await api(args.slice(1), options); return 0; }
    if (args[0] === 'posts') { await posts(args.slice(1), options); return 0; }
    if (args[0] === 'images') return await images(args.slice(1), options);
    if (args[0] === 'info') {
      const [metaResult, categoryResult, tagResult] = await Promise.all([
        request(options, 'GET', '/api/public/meta'),
        request(options, 'GET', '/api/admin/category/all'),
        request(options, 'GET', '/api/admin/tag/all'),
      ]);
      const metadata = data(metaResult);
      const site = metadata?.meta?.siteInfo || {};
      emit({ siteName: site.siteName, description: site.siteDesc, author: site.author, baseUrl: site.baseUrl,
        categories: data(categoryResult), tags: data(tagResult), summarySeparator: '<!-- more -->' }, options.output);
      return 0;
    }
    throw new CliError('未知命令，请运行 --help。', 2);
  } catch (error) {
    const message = redact(error.message);
    process.stderr.write(JSON.stringify({ error: message }) + '\n');
    return error.exitCode || (['ENOENT', 'EACCES'].includes(error.code) ? 2 : 1);
  }
}
module.exports = { main, request, parse, multipart, endpoint, operations };
if (require.main === module) main().then(code => { process.exitCode = code; });
