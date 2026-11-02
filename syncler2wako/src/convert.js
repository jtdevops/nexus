/**
 * Syncler Express → Wako Helios provider conversion.
 *
 * Syncler Express grew out of the same Helios provider schema. Remaining
 * differences are mostly metadata and a few renamed fields.
 */

const STRIP_PROVIDER_FIELDS = new Set([
  '_manifest',
  'original_package',
  'enabled_in_list',
]);

const HELIOS_PROVIDER_FIELDS = [
  'name',
  'enabled',
  'languages',
  'base_url',
  'fallback_urls',
  'response_type',
  'http_method',
  'trust_movie_results',
  'trust_episode_results',
  'trust_anime_results',
  'time_to_wait_between_each_request_ms',
  'time_to_wait_on_too_many_request_ms',
  'timeout_ms',
  'token',
  'title_replacement',
  'separator',
  'movie',
  'episode',
  'season',
  'anime',
  'json_format',
  'html_parser',
  'source_is_in_sub_page',
];

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Detect Syncler vendor manifests (package index, not providers).
 * @param {unknown} data
 */
export function isVendorManifest(data) {
  return (
    isPlainObject(data) &&
    Array.isArray(data.packages) &&
    data.packages.some((pkg) => isPlainObject(pkg) && typeof pkg.manifest === 'string')
  );
}

/**
 * Detect Syncler package manifests (`type` + `permaUrl`).
 * @param {unknown} data
 */
export function isPackageManifest(data) {
  return (
    isPlainObject(data) &&
    typeof data.permaUrl === 'string' &&
    (data.type === 'express' || data.type === 'kosmos' || typeof data.id === 'string') &&
    !Object.values(data).some((value) => isPlainObject(value) && typeof value?.base_url === 'string')
  );
}

/**
 * Detect an Express / Helios-style provider map.
 * @param {unknown} data
 */
export function isProviderList(data) {
  if (!isPlainObject(data)) return false;
  return Object.entries(data).some(
    ([key, value]) =>
      key !== '_manifest' &&
      isPlainObject(value) &&
      typeof value.base_url === 'string' &&
      typeof value.name === 'string',
  );
}

/**
 * Convert one Syncler Express provider object into a Helios provider.
 * @param {Record<string, any>} provider
 * @returns {Record<string, any> | null}
 */
export function convertProvider(provider) {
  if (!isPlainObject(provider) || typeof provider.base_url !== 'string') {
    return null;
  }

  const converted = {};

  for (const field of HELIOS_PROVIDER_FIELDS) {
    if (provider[field] !== undefined) {
      converted[field] = structuredClone(provider[field]);
    }
  }

  // Syncler sometimes uses `method` instead of Helios `http_method`.
  if (!converted.http_method && typeof provider.method === 'string') {
    converted.http_method = provider.method.toUpperCase() === 'POST' ? 'POST' : 'GET';
  }

  // Syncler `trust_results` → Helios per-category trust flags.
  if (provider.trust_results === true) {
    converted.trust_movie_results = true;
    converted.trust_episode_results = true;
    converted.trust_anime_results = true;
  }

  if (typeof converted.name !== 'string' || !converted.name.trim()) {
    converted.name = 'Unknown';
  }
  if (typeof converted.enabled !== 'boolean') {
    converted.enabled = true;
  }
  if (!Array.isArray(converted.languages)) {
    converted.languages = ['en'];
  }
  if (converted.response_type !== 'json' && converted.response_type !== 'text') {
    converted.response_type = converted.json_format ? 'json' : 'text';
  }

  // Drop empty optional objects that would confuse Helios.
  for (const key of Object.keys(converted)) {
    if (STRIP_PROVIDER_FIELDS.has(key)) {
      delete converted[key];
    }
  }

  return converted;
}

/**
 * Convert a Syncler Express provider map into a Helios ProviderList.
 * Later duplicates keep the first provider (Helios merge behavior).
 *
 * @param {Record<string, any>} input
 * @param {{ blacklist?: string[] }} [options]
 * @returns {{ providers: Record<string, any>, stats: { input: number, output: number, skipped: string[] } }}
 */
export function convertProviderList(input, options = {}) {
  const blacklist = new Set(
    (options.blacklist || [])
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean),
  );

  const providers = {};
  const skipped = [];
  let inputCount = 0;

  for (const [key, value] of Object.entries(input || {})) {
    if (key === '_manifest' || STRIP_PROVIDER_FIELDS.has(key)) {
      continue;
    }
    if (!isPlainObject(value) || typeof value.base_url !== 'string') {
      skipped.push(key);
      continue;
    }

    inputCount += 1;

    const id = String(key);
    const name = typeof value.name === 'string' ? value.name : id;
    if (blacklist.has(id.toLowerCase()) || blacklist.has(name.toLowerCase())) {
      skipped.push(id);
      continue;
    }

    if (providers[id]) {
      skipped.push(`${id} (duplicate)`);
      continue;
    }

    const converted = convertProvider(value);
    if (!converted) {
      skipped.push(id);
      continue;
    }

    providers[id] = converted;
  }

  return {
    providers,
    stats: {
      input: inputCount,
      output: Object.keys(providers).length,
      skipped,
    },
  };
}

/**
 * Merge multiple converted provider lists. First provider key wins.
 * @param {Array<Record<string, any>>} lists
 */
export function mergeProviderLists(lists) {
  const providers = {};
  for (const list of lists) {
    for (const [key, provider] of Object.entries(list || {})) {
      if (!providers[key]) {
        providers[key] = provider;
      }
    }
  }
  return providers;
}
