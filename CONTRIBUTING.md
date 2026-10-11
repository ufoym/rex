# Contributing

Small, focused improvements are welcome. Read the [guide](docs/guide.md) and [module map](docs/architecture.md) before changing compilation, caching or rendering.

## Issues and pull requests

For a bug, include a minimal `.tex` project, reproduction steps, expected and actual behavior, browser version, and relevant console / TeX logs. Remove private document content. For performance issues, include hardware, document size, cache state, measurement method and raw results.

Describe feature requests through a concrete use case. Discuss changes to the compilation protocol, dependencies or cache semantics before implementing a large change.

Keep ES modules small and the edit path direct. Place source and tests by responsibility using the [project structure](docs/architecture.md); performance drivers belong in `benchmarks/`. Add a regression test for changed behavior, update relevant documentation, then run:

```sh
npm run build
npm run test:all
npm run bench  # when changing compilation or rendering performance
```

Explain the problem, resulting behavior and validation in the pull request. Preserve frozen layout evidence; explain geometry changes rather than regenerating fixtures to hide them. Keep dependencies, lockfiles, download checksums and license notices consistent. Do not commit `vendor/`, `dist/` or `artifacts/`.

## Security and community

Report sensitive vulnerabilities through the repository's private vulnerability reporting channel when available. Otherwise request a private contact from the maintainer without posting exploit details publicly. Include affected versions, impact and a minimal reproduction privately. Report issues against the current source revision; no separate release support policy is established yet.

Be respectful and constructive. Harassment and disclosure of private information are unacceptable. Report community concerns privately to the maintainer. Contributions use the project's MIT license unless a file explicitly retains another license.
