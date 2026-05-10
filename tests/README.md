# Tests

Default regression entry:

```bash
bun run regression
```

This runs TypeScript type checking plus the ae-wiki-agent test suite under `tests/`.

Useful narrower commands:

```bash
bun run test
bun run test:governance
bun run test:watch
```

`bun run test` intentionally targets only `tests/` so it does not pick up the reference `demo/gbrain/test` suite.
