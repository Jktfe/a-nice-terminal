# Contributing

Thanks for helping improve ANT.

## Development Checks

Run these before proposing a change:

```sh
npm run check
npm test
npm run build
```

For focused changes, run the nearest targeted tests first, then run the broader
checks before claiming completion.

## Working Practices

- Keep changes narrowly scoped.
- Add or update tests for behavior changes.
- Do not commit secrets, local databases, runtime snapshots, or personal
  screenshots.
- Use explicit file staging; avoid `git add -A` in shared worktrees.
- Preserve the server singleton pattern: long-lived server modules should use
  `globalThis` guards where duplicate instances would break hot reload or
  production restart safety.

## Developer Certificate of Origin

Contributions use the Developer Certificate of Origin 1.1 sign-off model.
Add a `Signed-off-by:` line to commits when contributing through the public
project:

```text
Signed-off-by: Your Name <you@example.com>
```

By signing off, you certify that you wrote the contribution or otherwise have
the right to submit it under this project's open-source license.

## License

By contributing, you agree that your contribution is provided under the same
license as the project: AGPL-3.0-or-later.
