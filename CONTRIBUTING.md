# Contributing to ANT

ANT is an open-source project licensed under AGPL-3.0-or-later. Contributions
are welcome — this document explains how.

## Developer Certificate of Origin (DCO)

ANT uses the Developer Certificate of Origin. Every commit must include a
`Signed-off-by:` line:

```
Signed-off-by: Name <email>
```

Add it with `git commit -s` or by appending it manually to the commit
message. By signing off, you certify:

> Developer Certificate of Origin
> Version 1.1
>
> Copyright (C) 2004, 2005, 2006 The Linux Foundation and its contributors.
>
> Everyone is permitted to copy and distribute verbatim copies of this
> license document, but changing it is not allowed.
>
> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I
>     have the right to submit it under the open source license
>     indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best
>     of my knowledge, is covered under an appropriate open source
>     license and I have the right under that license to submit that
>     work with modifications, whether created in whole or in part
>     by me, under the same open source license (unless I am
>     permitted to submit under a different license), as indicated
>     in the file; or
>
> (c) The contribution was provided directly to me by some other
>     person who certified (a), (b) or (c) and I have not modified
>     it.
>
> (d) I understand and agree that this project and the contribution
>     are public and that a record of the contribution (including all
>     personal information I submit with it, including my sign-off) is
>     maintained indefinitely and may be redistributed consistent with
>     this project or the open source license(s) involved.

## License Posture

Unless an explicit maintainer-approved exception is documented in the file or
pull request, contributions are accepted under the same license as this project:
AGPL-3.0-or-later.

## How to Contribute

1. **Open an issue** — bugs, features, questions. Search existing issues first.
2. **Fork the repo** and create a branch from `main`.
3. **Follow the code conventions** — see `STYLE.md` for the 9-year-old-readable bar.
4. **Write tests** — new features need tests. Bug fixes need regression tests.
5. **Run the suite** — `bun run check && bun test` must pass.
6. **Sign off** — every commit needs `Signed-off-by`.
7. **Open a PR** — describe what changed and why. Link the issue.

## Commit Conventions

Use conventional commit prefixes:

```
feat(scope): short description
fix(scope): short description
refactor(scope): short description
docs: short description
chore: short description
```

Look at recent `git log --oneline -20` for the in-house flavour.

## Code of Conduct

Be respectful. Communicate with empathy. Stay on topic.
We follow the [GitHub Community Guidelines](https://docs.github.com/en/site-policy/github-community-guidelines).

## Questions

Open a GitHub issue or join the community discussion room (link TBD).
