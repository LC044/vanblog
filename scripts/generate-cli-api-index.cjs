#!/usr/bin/env node
'use strict';
// Development-only generator. The installed CLI reads the generated index without TypeScript.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../packages/server/node_modules/typescript');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'packages/server/src');
const output = path.join(root, 'packages/cli/skills/vanblog/references/api-index.json');
const verbs = new Map(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All'].map(name => [name, name.toUpperCase()]));
function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(item => item.isDirectory()
    ? files(path.join(folder, item.name)) : item.name.endsWith('.controller.ts') ? [path.join(folder, item.name)] : []);
}
function parse(filename) {
  return ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n'), ts.ScriptTarget.Latest, true);
}
function decorators(node) {
  return (ts.getDecorators(node) || []).map(item => item.expression).filter(ts.isCallExpression);
}
function name(call) { return call.expression.getText(); }
function literal(node) { return node && ts.isStringLiteralLike(node) ? node.text : ''; }
function paths(node, source) {
  if (!node) return [''];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(item => paths(item, source));
  if (ts.isIdentifier(node)) {
    const declaration = source.statements.filter(ts.isVariableStatement)
      .flatMap(item => [...item.declarationList.declarations]).find(item => item.name.getText() === node.text);
    if (declaration?.initializer) return paths(declaration.initializer, source);
  }
  throw new Error(`Unsupported route expression: ${node.getText()} in ${source.fileName}`);
}
const routes = [], models = {};
for (const filename of [...files(path.join(sourceRoot, 'controller')), path.join(sourceRoot, 'app.controller.ts')].sort()) {
  const source = parse(filename);
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    const module = literal(statement.moduleSpecifier);
    const base = module.startsWith('src/') ? path.join(sourceRoot, module.slice(4)) : module.startsWith('.') ? path.resolve(path.dirname(filename), module) : null;
    if (!base) continue;
    for (const element of statement.importClause.namedBindings.elements) imports.set(element.name.text, { filename: base + '.ts', name: (element.propertyName || element.name).text });
  }
  for (const controller of source.statements.filter(ts.isClassDeclaration)) {
    const classDecorators = decorators(controller);
    const prefix = classDecorators.find(item => name(item) === 'Controller');
    if (!prefix || classDecorators.some(item => name(item) === 'ApiExcludeController')) continue;
    for (const member of controller.members.filter(ts.isMethodDeclaration)) {
      for (const action of decorators(member).filter(item => verbs.has(name(item)))) {
        for (const base of paths(prefix.arguments[0], source)) for (const suffix of paths(action.arguments[0], source)) {
        const route = {
          method: verbs.get(name(action)),
          path: ('/' + [base, suffix].join('/')).replace(/\/+/g, '/').replace(/\/$/, '') || '/',
          operationId: `${controller.name.text}_${member.name.getText()}`,
          source: path.relative(root, filename).replace(/\\/g, '/'),
          parameters: [],
        };
        for (const parameter of member.parameters) {
          for (const decorator of decorators(parameter)) {
            const kind = name(decorator);
            if (['Query', 'Param', 'Headers'].includes(kind)) route.parameters.push({
              in: { Query: 'query', Param: 'path', Headers: 'header' }[kind],
              name: literal(decorator.arguments[0]) || parameter.name.getText(),
              type: parameter.type?.getText() || 'unknown',
              required: kind === 'Param' || (!parameter.questionToken && !parameter.initializer),
              ...(parameter.initializer ? { default: parameter.initializer.getText() } : {}),
            });
            if (kind === 'Body') {
              const type = parameter.type?.getText() || 'unknown';
              route.requestBody = { type, ...(literal(decorator.arguments[0]) ? { field: literal(decorator.arguments[0]) } : {}), definitions: [] };
              for (const identifier of new Set(type.match(/[A-Za-z_$][\w$]*/g) || [])) {
                const imported = imports.get(identifier);
                if (!imported || !fs.existsSync(imported.filename)) continue;
                const declaration = parse(imported.filename).statements.find(node => node.name?.text === imported.name);
                if (!declaration) continue;
                const file = path.relative(root, imported.filename).replace(/\\/g, '/');
                const key = `${file}#${imported.name}`;
                models[key] = { name: imported.name, source: file, declaration: declaration.getText() };
                route.requestBody.definitions.push({ $ref: '#/models/' + key.replace(/~/g, '~0').replace(/\//g, '~1') });
              }
            }
          }
        }
        const interceptor = decorators(member).find(item => name(item) === 'UseInterceptors');
        const upload = interceptor?.arguments.find(item => ts.isCallExpression(item) && ['FileInterceptor', 'FilesInterceptor', 'FileFieldsInterceptor'].includes(item.expression.getText()));
        if (upload) route.upload = { contentType: 'multipart/form-data', field: literal(upload.arguments[0]) || upload.arguments[0]?.getText() };
        routes.push(route);
        }
      }
    }
  }
}
routes.sort((a, b) => `${a.path} ${a.method}` < `${b.path} ${b.method}` ? -1 : 1);
const keys = routes.map(item => `${item.method} ${item.path}`);
if (new Set(keys).size !== keys.length) throw new Error('Duplicate API routes: ' + JSON.stringify(routes.filter((item, i) => keys.indexOf(keys[i]) !== i)));
const text = JSON.stringify({ format: 'vanblog-api-index-v1', source: 'NestJS controller and DTO declarations', routes, models }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8').replace(/\r\n/g, '\n') !== text) {
    console.error('API index is stale. Run: node scripts/generate-cli-api-index.cjs');
    process.exitCode = 1;
  } else console.log(`API index is current (${routes.length} operations).`);
} else {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, text);
  console.log(`Generated ${routes.length} API operations: ${path.relative(root, output)}`);
}
