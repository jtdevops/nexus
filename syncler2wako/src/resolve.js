import {
  convertProviderList,
  isPackageManifest,
  isProviderList,
  isVendorManifest,
  mergeProviderLists,
} from './convert.js';

export const DEFAULT_SOURCES = {
  vendor: 'https://jakedup.com/syncler/vendor',
  express: 'https://jakedup.com/syncler/express',
};

/**
 * @param {string} url
 * @param {Record<string, string | undefined>} [params]
 */
export function withQueryParams(url, params = {}) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    parsed.searchParams.set(key, String(value));
  }
  // Keep blacklist comma-separated (matches JakedUp configurator style).
  return parsed.toString().replace(/%2C/gi, ',');
}

/**
 * @param {string} input
 * @param {{ headers?: Record<string, string>, timeoutMs?: number }} [options]
 */
export async function loadJson(input, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;

  if (/^https?:\/\//i.test(input)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json,text/plain,*/*',
          'User-Agent': 'syncler2wako/1.0',
          ...(options.headers || {}),
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${input}`);
      }
      const text = await response.text();
      try {
        return { data: JSON.parse(text), source: input };
      } catch {
        throw new Error(`Response from ${input} is not valid JSON`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const { readFile } = await import('node:fs/promises');
  const text = await readFile(input, 'utf8');
  return { data: JSON.parse(text), source: input };
}

/**
 * Build JakedUp-style query params from CLI options.
 * @param {{
 *   orionApiKey?: string,
 *   excludeOrion?: boolean,
 *   commonProviders?: 'on' | 'off',
 *   jackettBaseUrl?: string,
 *   jackettApiKey?: string,
 *   blacklist?: string[],
 * }} options
 */
export function buildJakedUpParams(options = {}) {
  const params = {};

  if (options.orionApiKey) {
    params['orion-api-key'] = options.orionApiKey;
  }
  if (options.excludeOrion || options.commonProviders === 'off') {
    params['common-providers'] = 'off';
  }
  if (options.jackettBaseUrl && options.jackettApiKey) {
    params['jackett-base-url'] = options.jackettBaseUrl.replace(/[/\s]+$/, '');
    params['jackett-api-key'] = options.jackettApiKey;
  }
  if (options.blacklist?.length) {
    params.blacklist = options.blacklist.join(',');
  }

  return params;
}

/**
 * Resolve a vendor package entry into an Express provider list URL.
 * @param {string} manifestUrl
 * @param {Record<string, string | undefined>} [params]
 */
async function resolvePackageToExpressUrl(manifestUrl, params = {}) {
  const url = withQueryParams(manifestUrl, params);
  const { data } = await loadJson(url);

  if (isProviderList(data)) {
    return url;
  }

  if (isPackageManifest(data)) {
    if (data.type === 'kosmos') {
      return null;
    }
    if (!data.permaUrl) {
      throw new Error(`Package manifest at ${url} has no permaUrl`);
    }
    return withQueryParams(data.permaUrl, params);
  }

  throw new Error(`Unrecognized package payload at ${url}`);
}

/**
 * Fetch + convert Syncler vendor/express input into a Helios provider list.
 *
 * @param {string} input URL or local file path
 * @param {{
 *   blacklist?: string[],
 *   orionApiKey?: string,
 *   excludeOrion?: boolean,
 *   commonProviders?: 'on' | 'off',
 *   jackettBaseUrl?: string,
 *   jackettApiKey?: string,
 *   includeKosmos?: boolean,
 * }} [options]
 */
export async function resolveAndConvert(input, options = {}) {
  const jakedUpParams = buildJakedUpParams(options);
  const resolvedInput = /^https?:\/\//i.test(input)
    ? withQueryParams(input, jakedUpParams)
    : input;

  const { data, source } = await loadJson(resolvedInput);
  const packageSources = [];
  const warnings = [];

  if (isVendorManifest(data)) {
    const manifests = [
      ...new Set(
        [
          ...(Array.isArray(data.defaults?.packages) ? data.defaults.packages : []),
          ...data.packages.map((pkg) => pkg.manifest).filter(Boolean),
        ].filter(Boolean),
      ),
    ];

    for (const manifestUrl of manifests) {
      try {
        const expressUrl = await resolvePackageToExpressUrl(manifestUrl, jakedUpParams);
        if (!expressUrl) {
          warnings.push(`Skipped non-Express package: ${manifestUrl}`);
          continue;
        }
        packageSources.push(expressUrl);
      } catch (error) {
        warnings.push(`Failed package ${manifestUrl}: ${error.message}`);
      }
    }
  } else if (isPackageManifest(data)) {
    if (data.type === 'kosmos' && !options.includeKosmos) {
      throw new Error(`Kosmos packages are not Helios-compatible: ${source}`);
    }
    packageSources.push(withQueryParams(data.permaUrl, jakedUpParams));
  } else if (isProviderList(data)) {
    packageSources.push(source);
  } else {
    throw new Error(
      `Unrecognized Syncler input at ${source}. Expected vendor manifest, package manifest, or Express provider JSON.`,
    );
  }

  const convertedLists = [];
  const sourceStats = [];

  for (const packageSource of packageSources) {
    const payload =
      packageSource === source
        ? data
        : (await loadJson(withQueryParams(packageSource, jakedUpParams))).data;

    if (!isProviderList(payload)) {
      warnings.push(`No providers found in ${packageSource}`);
      continue;
    }

    const { providers, stats } = convertProviderList(payload, {
      blacklist: options.blacklist,
    });
    convertedLists.push(providers);
    sourceStats.push({ source: packageSource, ...stats });
  }

  const providers = mergeProviderLists(convertedLists);

  return {
    providers,
    meta: {
      input: source,
      sources: sourceStats,
      warnings,
      providerCount: Object.keys(providers).length,
    },
  };
}
