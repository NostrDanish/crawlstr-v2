# Crawlstr v2

> **Decentralized browser crawler for the SIP-01 index.** Crawlstr v2 turns your
> browser into a crawl node: it fetches web pages through a hardened SSRF guard,
> extracts content and links, and publishes signed **kind 39697 web-index
> observations** to Nostr relays — every event tagged **`source=crawlstr/2`**.

This is a self-contained v2 app repo, sliced from the web-crawler monorepo.
Everything needed to build and run Crawlstr v2 is in this tree.

## Layout

```
├── packages/sip01-protocol/   # @sip01/protocol — SIP-01 v1.2 wire format (kind 39697 build/parse/verify)
├── packages/crawler-core/     # @sip01/crawler-core — shared deep crawler (SSRF guard, queue, scheduler, publishing lane)
└── apps/crawlstr/             # the Crawlstr v2 web app (Vite + React 19 + Tailwind 4)
```

## Quickstart

Requires Node.js ≥ 20 and pnpm 12.

```bash
pnpm install        # no frozen lockfile is shipped; resolves fresh
pnpm build          # builds @sip01/protocol, then the app (pnpm -r build)
pnpm test           # typecheck + lint + vitest + production build
pnpm typecheck      # tsc --noEmit across the workspace
```

Dev server:

```bash
pnpm --filter crawlstr dev    # http://localhost:8080
```

## Source tag

All SIP-01 observations published by this app carry `source=crawlstr/2`
(`apps/crawlstr/src/lib/crawlerNode.ts` → `CRAWLER_SOURCE`), so indexers and
stats dashboards can distinguish v2 Crawlstr traffic from v1 and from Indexstr
(`indexstr/2`) nodes.

## Notes

- No lockfile is included (repository size limits) — `pnpm install` resolves
  dependencies fresh; do not use `--frozen-lockfile`.
- `packages/*` are workspace dependencies of the app (`workspace:*`); pnpm
  links them automatically at install time. The root `postinstall` builds
  `@sip01/protocol` first, since its published entry points at `dist/`.
- Production homepage: https://crawlstr.shakespeare.wtf

## License

MIT — see [LICENSE](LICENSE).
