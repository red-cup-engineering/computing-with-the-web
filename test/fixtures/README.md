# Source provenance

The received implementation and original seven cases retain the work from
[emsenn/web-taxonomy](https://github.com/emsenn/web-taxonomy/tree/3834b98d2cdb85b85e49b9ee601c58040c49576d).
The last implementation change is
[abb2677212fb5e88e103191184450553051024ea](https://github.com/emsenn/web-taxonomy/commit/abb2677212fb5e88e103191184450553051024ea),
authored by emsenn on 2026-06-14 and carrying the source commit's
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` attribution.
That repository and history are preserved.

The SWARM fixture is generated from the named functions and exact Git blobs in
`swarm-taxonomy-provenance.json`. It contains the actual item projection,
four-state projection, relation-document projection, and their pure helpers
after TypeScript erasure. It contains no replacement implementation and no HTTP
adapter. Obtain the three source files from
[the pinned SWARM revision](https://github.com/emsenn/swarm/tree/72847d0a5a0e3303a0ec417e793daabb0634fa8d/src)
and run:

```sh
node test/extract-swarm-taxonomy-fixture.mjs /path/to/pinned-swarm-src
```

The generator refuses a different Git blob. Run `test/swarm-taxonomy.test.mjs`
against the built receiving package to exercise both ordinary archives and the
pure document behind `relation.json`. This does not execute or migrate SWARM's
legacy `ctx.req/ctx.res/send` interface.

