# syncler2wako

Convert Syncler Express provider packages into [Wako Helios](https://github.com/wako-unofficial-addons/helios)-compatible JSON.

Syncler Express and Helios share the same provider schema lineage. This tool fetches an Express package, strips Syncler-only metadata, and remaps a few fields Helios expects.

## Provider lists (raw GitHub URLs)

Use one of these URLs in Helios provider settings:

| File | Description | Raw URL |
| --- | --- | --- |
| `providers/express-hybrid.json` | Full converted JakedUp Express hybrid | https://raw.githubusercontent.com/jtdevops/nexus/main/syncler2wako/providers/express-hybrid.json |
| `providers/express-hybrid-filtered.json` | Hybrid minus Wako dual/single-media blacklist | https://raw.githubusercontent.com/jtdevops/nexus/main/syncler2wako/providers/express-hybrid-filtered.json |
| `providers/express-hybrid-filtered-strict.json` | Filtered list plus probe-deemed additional removals | https://raw.githubusercontent.com/jtdevops/nexus/main/syncler2wako/providers/express-hybrid-filtered-strict.json |

Blacklist sources used for the filtered files:

- `providers/blacklist.txt` — user/Wako rule blacklist
- `providers/blacklist-additional.txt` — probe-deemed extras
- `providers/blacklist-combined.txt` — both lists combined
- `providers/probe-report.json` — full probe + blacklist metadata (`userBlacklist.csv`, `additionalBlacklist.csv`, `combinedBlacklist.csv`)

## Requirements

- Node.js 18+

## Usage

```bash
# Latest JakedUp Express hybrid → providers/express-hybrid.json
npm run convert -- --source express -o providers/express-hybrid.json

# Custom URL + blacklist
node ./src/syncler2wako.js https://jakedup.com/syncler/express --blacklist yts,zooqle -o providers/express-hybrid.json

# Local Express file downloaded from JakedUp (https://jakedup.com/syncler/express)
node ./src/syncler2wako.js ./express.json -o providers/express-hybrid.json

# same as: node ./src/syncler2wako.js --source express -o providers/express-hybrid.json
npm run convert:express

# pass extra args after --
npm run convert -- ./express.json -o providers/express-hybrid.json
npm run convert -- https://jakedup.com/syncler/express --blacklist yts,zooqle -o providers/express-hybrid.json

# Apply blacklists to local hybrid output
npm run convert:filtered
npm run convert:filtered-strict
```

In Wako, install Helios, then paste one of the raw provider list URLs above into Helios provider settings.

## Probe failing providers

Uses sample Helios-style movie, episode, and anime queries to find providers that error, time out, or return unusable responses:

```bash
npm run probe
```

This writes:

- `providers/probe-report.json` — full per-provider results and blacklist CSVs
- `providers/blacklist.txt` — recommended user/Wako blacklist (when recomputed)

Regenerate filtered lists:

```bash
npm run convert:filtered
npm run convert:filtered-strict
```

Or pass a blacklist explicitly:

```bash
npm run convert -- ./providers/express-hybrid.json --blacklist-file providers/blacklist.txt -o providers/express-hybrid-filtered.json
npm run convert -- ./providers/express-hybrid.json --blacklist-file providers/blacklist-combined.txt -o providers/express-hybrid-filtered-strict.json
```

**Blacklist rule used for `express-hybrid-filtered.json`:**

- If a provider supports both SERIES and MOVIES, both must fail before removal
- If a provider supports only one of SERIES / MOVIES / ANIME, failure of that one is enough

**`express-hybrid-filtered-strict.json`** also removes probe-deemed failing providers from `blacklist-additional.txt`.

**Note:** HTML providers are only checked for HTTP reachability in the probe. A site can return HTTP 200 and still have broken CSS selectors inside Helios.

## Options

| Option | Description |
| --- | --- |
| `--source express` | Use the default JakedUp Express URL |
| `--url <url>` / positional input | Explicit Express URL or local JSON file |
| `-o, --out <file>` | Write output to a file (default: stdout) |
| `--blacklist <a,b,c>` | Remove providers by id or name |
| `--blacklist-file <file>` | Read blacklist ids from a file (comma/newline separated) |
| `--orion-api-key <key>` | Pass an Orion key through to JakedUp hybrid URLs |
| `--exclude-orion` | Exclude Orion common providers |
| `--jackett-base-url <url>` | Include a Jackett custom provider |
| `--jackett-api-key <key>` | Jackett API key (required with `--jackett-base-url`) |
| `--compact` | Compact JSON output |
| `-h, --help` | Show help |

## What gets converted

- Strips `_manifest` and `original_package`
- Maps `method` → `http_method`
- Maps `trust_results` → `trust_movie_results` / `trust_episode_results` / `trust_anime_results`
