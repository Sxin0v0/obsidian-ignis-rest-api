# Contributing

Thank you for helping improve this community-maintained Ignis adaptation.

## Before opening a change

1. Confirm the behavior against the current upstream projects where relevant.
2. Avoid changing compatibility behavior without a regression test.
3. Do not commit real vault contents, API keys, internal URLs, or personal data.
4. Preserve upstream attribution and license notices.

## Local checks

The runtime plugin has no additional npm runtime dependencies; it uses Node.js
and the Express instance provided by Ignis.

Run:

```bash
npm test
npm run check
npm run security:scan
npm run build
```

## Pull requests

Keep pull requests focused. Describe:

- the problem being solved;
- compatibility impact;
- tests added or updated;
- whether a browser-side Ignis tab is required for the affected feature.

Changes that intentionally diverge from upstream behavior should document the
reason in `COMPATIBILITY.md` or `MIGRATION_NOTES.md`.
