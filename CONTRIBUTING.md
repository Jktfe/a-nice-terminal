# Contributing to ANT

Thanks for your interest in contributing to ANT.

## Before you start

1. Open an issue for bugs, regressions, or larger feature ideas before starting major work.
2. Keep pull requests focused. Separate refactors, feature work, and documentation updates when possible.
3. Do not commit secrets, personal config, or machine-specific paths.

## Local development

```bash
bun install
bun run build
bun run start
```

For CLI work:

```bash
cd cli
bun install
bun link
```

## Pull requests

1. Make the smallest change that fully solves the problem.
2. Update documentation when behavior, setup, or user-facing workflows change.
3. Include clear reproduction and verification steps in the pull request description.
4. Keep commits and file layout readable for reviewers.

## Reporting issues

When filing a bug, include:

- what you expected to happen
- what actually happened
- steps to reproduce
- relevant logs, screenshots, or terminal output
- your OS, runtime, and how ANT was started

## Security

Please do not file public issues for suspected security problems. Follow the process in `SECURITY.md`.
