#!/usr/bin/env node

const baseUrl = process.env.JAM_BASE_URL || 'http://localhost:3000';

function usage() {
  console.error(`Usage:
  npm run jam -- state
  npm run jam -- elements
  npm run jam -- add '{"id":"elem_x","filePath":"/elements/elem_x_visual.js","type":"visual","authored":"hand"}'
  npm run jam -- patch <id> '{"authored":"hand"}'
  npm run jam -- delete <id>
  npm run jam -- reload <id>
  npm run jam -- bus <key> '<json-value>'
  npm run jam -- clock '{"bpm":92}'
  npm run jam -- compile-check <id> <filePath> [authored]
`);
}

function parseJsonArg(value, fallback = {}) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`Expected JSON argument, got: ${value}`);
  }
}

async function request(method, path, data) {
  const options = { method, headers: {} };
  if (data !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }

  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON response text.
  }

  if (!response.ok) {
    const detail = typeof body === 'object' ? JSON.stringify(body) : body;
    throw new Error(`${method} ${path} failed with ${response.status}: ${detail}`);
  }
  return body;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'state':
      print(await request('GET', '/api/workspace/state'));
      break;
    case 'elements':
      print(await request('GET', '/api/workspace/elements'));
      break;
    case 'add':
      print(await request('POST', '/api/workspace/elements', parseJsonArg(args[0])));
      break;
    case 'patch':
      if (!args[0]) throw new Error('patch requires <id>');
      print(await request('PATCH', `/api/workspace/elements/${encodeURIComponent(args[0])}`, parseJsonArg(args[1])));
      break;
    case 'delete':
      if (!args[0]) throw new Error('delete requires <id>');
      print(await request('DELETE', `/api/workspace/elements/${encodeURIComponent(args[0])}`));
      break;
    case 'reload':
      if (!args[0]) throw new Error('reload requires <id>');
      print(await request('POST', `/api/workspace/elements/${encodeURIComponent(args[0])}/reload`));
      break;
    case 'bus':
      if (!args[0]) throw new Error('bus requires <key>');
      print(await request('POST', `/api/workspace/global-bus/${encodeURIComponent(args[0])}`, {
        value: parseJsonArg(args[1], null)
      }));
      break;
    case 'clock':
      print(await request('POST', '/api/workspace/clock', parseJsonArg(args[0])));
      break;
    case 'compile-check': {
      const [id, filePath, authored = 'hand'] = args;
      if (!id || !filePath) throw new Error('compile-check requires <id> <filePath> [authored]');
      const result = await request('POST', '/api/compile', {
        prompt: 'Initialize or reload module',
        elementId: id,
        filePath,
        prevState: null,
        forceCompile: false,
        authored,
        allowOverwrite: false
      });
      print({
        success: result.success,
        filePath: result.filePath,
        rawBytes: result.rawCode?.length || 0,
        transpiledBytes: result.transpiledCode?.length || 0
      });
      break;
    }
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
