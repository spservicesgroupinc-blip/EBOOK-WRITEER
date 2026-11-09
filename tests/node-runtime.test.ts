import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

test('compiled API starts in native Node ESM without tsx or a bundler', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ebook-api-runtime-'));
  try {
    await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const file of ['api/index.ts', 'services/wikipediaResearch.ts', 'types.ts']) {
      const compiled = ts.transpileModule(await readFile(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      const destination = path.join(dir, file.replace(/\.ts$/, '.js'));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, compiled);
    }
    const script = `const {default:handler}=await import(${JSON.stringify(pathToFileURL(path.join(dir, 'api/index.js')).href)});
      const res={setHeader(){},end(text){console.log(text)}};
      await handler({url:'/api/health'},res);
      await handler({url:'/api/research',method:'POST',body:{topic:''}},res);`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(responses[0].status, 'ok');
    assert.match(responses[1].error, /research topic/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
