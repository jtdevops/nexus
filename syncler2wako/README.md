# syncler2wako

Convert Syncler Express provider packages into [Wako Helios](https://github.com/wako-unofficial-addons/helios)-compatible JSON.

Syncler Express and Helios share the same provider schema lineage. This tool fetches an Express package, strips Syncler-only metadata, and remaps a few fields Helios expects.

## Provider list

Generated Express providers (for Helios):

https://raw.githubusercontent.com/jtdevops/nexus/main/syncler2wako/providers/express-hybrid.json

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
```

In Wako, install Helios, then add the provider list URL above (or another hosted copy of `providers/express-hybrid.json`) in Helios provider settings.

## Options

| Option | Description |
| --- | --- |
| `--source express` | Use the default JakedUp Express URL |
| `--url <url>` / positional input | Explicit Express URL or local JSON file |
| `-o, --out <file>` | Write output to a file (default: stdout) |
| `--blacklist <a,b,c>` | Remove providers by id or name |
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
