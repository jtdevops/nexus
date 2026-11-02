#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SOURCES, resolveAndConvert } from './resolve.js';

function printHelp() {
  console.log(`syncler2wako — convert Syncler vendor/express providers to Wako Helios JSON

Usage:
  syncler2wako [options] [input]

Input can be:
  - a Syncler vendor URL   (e.g. https://jakedup.com/syncler/vendor)
  - a Syncler express URL  (e.g. https://jakedup.com/syncler/express)
  - a package manifest URL (type=express + permaUrl)
  - a local Express JSON file

Options:
  --source <vendor|express>   Use the default JakedUp source
  --url <url>                 Explicit input URL/path (same as positional input)
  --out, -o <file>            Write Helios JSON to this file (default: stdout)
  --pretty                    Pretty-print JSON (default: true)
  --compact                   Compact JSON output
  --blacklist <a,b,c>         Remove providers by id or name
  --orion-api-key <key>       Pass Orion key through to JakedUp hybrid URLs
  --exclude-orion             Exclude Orion common providers (common-providers=off)
  --jackett-base-url <url>    Include Jackett custom provider
  --jackett-api-key <key>     Jackett API key (required with --jackett-base-url)
  --help, -h                  Show this help

Examples:
  npm run convert -- --source express -o dist/helios-providers.json
  npm run convert -- --source vendor -o dist/helios-from-vendor.json
  npm run convert -- https://jakedup.com/syncler/express --blacklist yts,zooqle
`);
}

function parseArgs(argv) {
  const options = {
    pretty: true,
    blacklist: [],
  };

  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--source':
        options.source = next();
        break;
      case '--url':
        options.url = next();
        break;
      case '--out':
      case '-o':
        options.out = next();
        break;
      case '--pretty':
        options.pretty = true;
        break;
      case '--compact':
        options.pretty = false;
        break;
      case '--blacklist':
        options.blacklist = next()
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case '--orion-api-key':
        options.orionApiKey = next();
        break;
      case '--exclude-orion':
        options.excludeOrion = true;
        break;
      case '--jackett-base-url':
        options.jackettBaseUrl = next();
        break;
      case '--jackett-api-key':
        options.jackettApiKey = next();
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positional.push(arg);
        break;
    }
  }

  if (positional.length > 1) {
    throw new Error('Only one input path/URL is supported');
  }

  if (positional[0]) {
    options.url = positional[0];
  }

  return options;
}

function resolveInput(options) {
  if (options.url) return options.url;
  if (options.source) {
    const key = String(options.source).toLowerCase();
    if (!DEFAULT_SOURCES[key]) {
      throw new Error(`Unknown --source "${options.source}". Use vendor or express.`);
    }
    return DEFAULT_SOURCES[key];
  }
  return DEFAULT_SOURCES.express;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const input = resolveInput(options);
  const result = await resolveAndConvert(input, options);
  const json = JSON.stringify(result.providers, null, options.pretty ? 2 : undefined) + '\n';

  if (options.out) {
    await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
    await writeFile(options.out, json, 'utf8');
  } else {
    process.stdout.write(json);
  }

  const summary = [
    `Input: ${result.meta.input}`,
    `Providers: ${result.meta.providerCount}`,
    `Packages: ${result.meta.sources.length}`,
  ];
  if (options.out) {
    summary.push(`Wrote: ${options.out}`);
  }
  console.error(summary.join(' | '));

  for (const source of result.meta.sources) {
    console.error(
      `  - ${source.source}: kept ${source.output}/${source.input}` +
        (source.skipped.length ? ` (skipped ${source.skipped.length})` : ''),
    );
  }
  for (const warning of result.meta.warnings) {
    console.error(`  warning: ${warning}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
