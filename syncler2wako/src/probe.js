#!/usr/bin/env node
/**
 * Probe Express/Helios providers with sample movie + episode queries.
 * Reports HTTP / parse failures suitable for --blacklist.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PROVIDERS = 'providers/express-hybrid.json';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 6;

const FIXTURES = {
  movie: {
    category: 'movie',
    title: 'Moana 2',
    year: '2024',
    imdbId: 'tt13622970',
  },
  episode: {
    category: 'tv',
    title: 'Welcome to Wrexham',
    year: '2022',
    imdbId: 'tt14674086',
    showImdbId: 'tt14674086',
    season: '5',
    episode: '7',
    seasonCode: 's05',
    episodeCode: 's05e07',
    absoluteNumber: '',
  },
  anime: {
    category: 'anime',
    title: 'Frieren',
    year: '2023',
    imdbId: 'tt22248376',
    showImdbId: 'tt22248376',
    season: '1',
    episode: '1',
    seasonCode: 's01',
    episodeCode: 's01e01',
    absoluteNumber: '1',
  },
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function printHelp() {
  console.log(`syncler2wako probe — check which providers fail sample Helios queries

Usage:
  node ./src/probe.js [options]

Options:
  --providers <file>   Provider JSON (default: ${DEFAULT_PROVIDERS})
  --timeout <ms>       Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --concurrency <n>    Parallel requests (default: ${DEFAULT_CONCURRENCY})
  --out <file>         Write JSON report
  --blacklist-out <file>  Write comma-separated failing provider ids
  --help, -h           Show help
`);
}

function parseArgs(argv) {
  const options = {
    providers: DEFAULT_PROVIDERS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    concurrency: DEFAULT_CONCURRENCY,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--providers':
        options.providers = next();
        break;
      case '--timeout':
        options.timeoutMs = Number(next());
        break;
      case '--concurrency':
        options.concurrency = Number(next());
        break;
      case '--out':
        options.out = next();
        break;
      case '--blacklist-out':
        options.blacklistOut = next();
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function applyTitleReplacement(title, replacement) {
  let value = title;
  if (!replacement || typeof replacement !== 'object') return value;
  for (const [from, to] of Object.entries(replacement)) {
    value = value.split(from).join(to);
  }
  return value;
}

function replacer(template, data) {
  return String(template).replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function getPath(root, keyString) {
  if (!keyString) return root;
  let current = root;
  for (const key of String(keyString).split('.')) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

function buildReplacement(provider, fixture, token = '') {
  const cleanedTitle = applyTitleReplacement(fixture.title, provider.title_replacement);
  const raw = {
    title: fixture.title,
    titleFirstLetter: fixture.title[0]?.toLowerCase?.() || fixture.title[0] || '',
    token,
    year: fixture.year || '',
    imdbId: fixture.imdbId || '',
    showImdbId: fixture.showImdbId || fixture.imdbId || '',
    episodeCode: fixture.episodeCode || '',
    seasonCode: fixture.seasonCode || '',
    season: fixture.season || '',
    episode: fixture.episode || '',
    absoluteNumber: fixture.absoluteNumber || '',
    query: '',
  };

  const cleaned = {
    ...raw,
    title: cleanedTitle,
    titleFirstLetter: cleanedTitle[0]?.toLowerCase?.() || cleanedTitle[0] || '',
  };

  return { raw, cleaned };
}

function buildProviderUrl(provider, providerInfo, fixture, token = '') {
  const keywords = Array.isArray(providerInfo.keywords)
    ? providerInfo.keywords
    : [providerInfo.keywords];
  const keyword = keywords[0];
  const { cleaned, raw } = buildReplacement(provider, fixture, token);
  const isPost = provider.http_method === 'POST';

  let query = replacer(keyword, cleaned).trim();
  if (provider.separator) {
    query = query.replace(/\s/g, provider.separator);
  } else if (!isPost) {
    query = encodeURIComponent(query);
  }

  const vars = { ...cleaned, query, token };
  // Prefer cleaned title vars but keep raw imdb ids.
  vars.imdbId = raw.imdbId;
  vars.showImdbId = raw.showImdbId;

  if (isPost) {
    return {
      url: provider.base_url,
      method: 'POST',
      body: replacer(providerInfo.query, vars),
      keyword,
      query,
    };
  }

  return {
    url: replacer(provider.base_url + providerInfo.query, vars),
    method: 'GET',
    body: null,
    keyword,
    query,
  };
}

async function fetchWithTimeout(url, { method = 'GET', body = null, responseType, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const headers = {
      'user-agent': USER_AGENT,
      accept: responseType === 'json' ? 'application/json,text/plain,*/*' : 'text/html,application/xhtml+xml,*/*',
    };
    if (body) headers['content-type'] = 'application/json';

    const response = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      signal: controller.signal,
      redirect: 'follow',
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getToken(provider, timeoutMs) {
  if (!provider.token?.query) return '';
  const url = provider.base_url + provider.token.query;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    responseType: 'json',
    timeoutMs,
  });
  if (!response.ok) {
    throw new Error(`token HTTP ${response.status}`);
  }
  const json = JSON.parse(response.text);
  const token = getPath(json, provider.token.token_format?.token || 'token');
  if (!token) throw new Error('token missing in response');
  return String(token);
}

function evaluateJsonResponse(provider, text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid JSON', resultCount: 0 };
  }

  const format = provider.json_format || {};
  if (!format.results) {
    // Some providers only expose streams at top-level path via results.
    return { ok: true, reason: 'json ok (no results path)', resultCount: Array.isArray(json) ? json.length : 1 };
  }

  const results = getPath(json, format.results);
  if (!Array.isArray(results)) {
    return { ok: false, reason: `missing results path "${format.results}"`, resultCount: 0 };
  }

  return { ok: true, reason: results.length ? 'json results' : 'json ok (0 results)', resultCount: results.length };
}

function evaluateTextResponse(text, status) {
  if (status === 403) return { ok: false, reason: 'HTTP 403 forbidden', resultCount: 0 };
  if (status === 401) return { ok: false, reason: 'HTTP 401 unauthorized', resultCount: 0 };
  if (status === 404) return { ok: false, reason: 'HTTP 404 not found', resultCount: 0 };
  if (status >= 500) return { ok: false, reason: `HTTP ${status}`, resultCount: 0 };
  if (!text || text.trim().length < 40) {
    return { ok: false, reason: 'empty/short HTML body', resultCount: 0 };
  }
  // Network succeeded; HTML selector validity is not fully checked without a DOM.
  return { ok: true, reason: 'HTTP ok (HTML not deeply parsed)', resultCount: null };
}

async function probeProviderMedia(providerId, provider, mediaKey, fixture, timeoutMs) {
  const providerInfo = provider[mediaKey];
  if (!providerInfo) {
    return {
      id: providerId,
      name: provider.name,
      media: mediaKey,
      skipped: true,
      ok: null,
      reason: `no ${mediaKey} config`,
    };
  }

  const urlsToTry = [provider.base_url, ...(provider.fallback_urls || [])];
  let lastError = null;

  for (let index = 0; index < urlsToTry.length; index += 1) {
    const baseUrl = urlsToTry[index];
    const candidate = { ...provider, base_url: baseUrl };

    try {
      const token = await getToken(candidate, timeoutMs);
      const request = buildProviderUrl(candidate, providerInfo, fixture, token);
      const response = await fetchWithTimeout(request.url, {
        method: request.method,
        body: request.body,
        responseType: candidate.response_type,
        timeoutMs,
      });

      if (!response.ok && response.status !== 404) {
        // Still attempt parse on some soft failures; record status.
      }

      let evaluation;
      if (candidate.response_type === 'json') {
        if (!response.ok) {
          evaluation = { ok: false, reason: `HTTP ${response.status}`, resultCount: 0 };
        } else {
          evaluation = evaluateJsonResponse(candidate, response.text);
        }
      } else if (!response.ok) {
        evaluation = { ok: false, reason: `HTTP ${response.status}`, resultCount: 0 };
      } else {
        evaluation = evaluateTextResponse(response.text, response.status);
      }

      return {
        id: providerId,
        name: provider.name,
        media: mediaKey,
        ok: evaluation.ok,
        reason: evaluation.reason,
        resultCount: evaluation.resultCount,
        status: response.status,
        elapsedMs: response.elapsedMs,
        url: request.url,
        usedFallback: index > 0,
        keyword: request.keyword,
      };
    } catch (error) {
      lastError = error;
      const reason =
        error.name === 'AbortError'
          ? `timeout after ${timeoutMs}ms`
          : error.message || String(error);
      lastError = reason;
    }
  }

  return {
    id: providerId,
    name: provider.name,
    media: mediaKey,
    ok: false,
    reason: lastError || 'request failed',
    resultCount: 0,
  };
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

function summarize(results) {
  const byProvider = new Map();

  for (const result of results) {
    if (!byProvider.has(result.id)) {
      byProvider.set(result.id, {
        id: result.id,
        name: result.name,
        checks: [],
      });
    }
    byProvider.get(result.id).checks.push(result);
  }

  const failing = [];
  const passing = [];
  const partial = [];

  for (const entry of byProvider.values()) {
    const active = entry.checks.filter((check) => !check.skipped);
    const failed = active.filter((check) => check.ok === false);
    const passed = active.filter((check) => check.ok === true);

    if (active.length === 0) {
      partial.push(entry);
    } else if (failed.length === active.length) {
      failing.push(entry);
    } else if (failed.length > 0) {
      partial.push(entry);
    } else {
      passing.push(entry);
    }
  }

  return { failing, passing, partial, byProvider };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const providers = JSON.parse(await readFile(options.providers, 'utf8'));
  const jobs = [];

  for (const [id, provider] of Object.entries(providers)) {
    if (provider.movie) jobs.push({ id, provider, media: 'movie', fixture: FIXTURES.movie });
    if (provider.episode) jobs.push({ id, provider, media: 'episode', fixture: FIXTURES.episode });
    if (provider.anime) jobs.push({ id, provider, media: 'anime', fixture: FIXTURES.anime });
  }

  console.error(
    `Probing ${Object.keys(providers).length} providers (${jobs.length} checks), concurrency=${options.concurrency}`,
  );

  const results = await mapPool(jobs, options.concurrency, async (job) => {
    const result = await probeProviderMedia(
      job.id,
      job.provider,
      job.media,
      job.fixture,
      options.timeoutMs,
    );
    const mark = result.skipped ? 'skip' : result.ok ? 'ok' : 'FAIL';
    console.error(
      `[${mark}] ${result.id}/${result.media}: ${result.reason}` +
        (result.status ? ` (HTTP ${result.status}, ${result.elapsedMs}ms)` : ''),
    );
    return result;
  });

  const summary = summarize(results);
  const blacklist = summary.failing.map((entry) => entry.id).sort();
  const softBlacklist = [...summary.failing, ...summary.partial].map((entry) => entry.id).sort();

  console.error('');
  console.error(`Passing: ${summary.passing.length}`);
  console.error(`Partial: ${summary.partial.length}`);
  console.error(`Failing: ${summary.failing.length}`);
  console.error('');
  console.error('Hard fail blacklist (all configured media checks failed):');
  console.error(blacklist.join(',') || '(none)');
  console.error('');
  console.error('Failing + partial (any media check failed):');
  console.error(softBlacklist.join(',') || '(none)');

  if (summary.failing.length) {
    console.error('\nFailing details:');
    for (const entry of summary.failing) {
      for (const check of entry.checks.filter((item) => !item.skipped)) {
        console.error(`  - ${entry.id}/${check.media}: ${check.reason}`);
      }
    }
  }

  if (summary.partial.length) {
    console.error('\nPartial details:');
    for (const entry of summary.partial) {
      for (const check of entry.checks.filter((item) => !item.skipped)) {
        console.error(
          `  - ${entry.id}/${check.media}: ${check.ok ? 'ok' : 'FAIL'} (${check.reason})`,
        );
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    fixtures: FIXTURES,
    providersFile: options.providers,
    counts: {
      providers: Object.keys(providers).length,
      checks: results.length,
      passing: summary.passing.length,
      partial: summary.partial.length,
      failing: summary.failing.length,
    },
    blacklist,
    blacklistIncludingPartial: softBlacklist,
    results,
  };

  if (options.out) {
    await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
    await writeFile(options.out, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.error(`\nWrote report: ${options.out}`);
  }

  if (options.blacklistOut) {
    await mkdir(path.dirname(path.resolve(options.blacklistOut)), { recursive: true });
    await writeFile(options.blacklistOut, blacklist.join(',') + '\n', 'utf8');
    console.error(`Wrote blacklist: ${options.blacklistOut}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
