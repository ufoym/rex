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

The default CI uses a hosted build and runs the syntax / asset checks, every unit and integration test, and editor / cached-offline browser checks. For compiler or local-file runtime changes, also run **Actions → CI → Run workflow** with **full** selected on your branch. That option retains the complete offline build, startup measurements and all Chromium / WebKit browser suites. It is available before merging a pull request or preparing a release.

Explain the problem, resulting behavior and validation in the pull request. Preserve frozen layout evidence; explain geometry changes rather than regenerating fixtures to hide them. Keep dependencies, lockfiles, download checksums and license notices consistent. Do not commit `vendor/`, `dist/` or `artifacts/`.

## Commit messages

Use the same format for commits and squash-merge titles:

```text
type(scope): description
```

The scope is optional: `type: description` is valid. Use a short, lowercase scope naming the affected area, such as `editor`, `compiler` or `preview`.

| Type | Change |
| --- | --- |
| `feat` | New user-facing behavior |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Code restructuring without changing behavior |
| `docs` | Documentation |
| `test` | Tests or test infrastructure |
| `bench` | Benchmark drivers or results |
| `build` | Build tooling, dependencies or runtime setup |
| `ci` | CI or deployment workflows |
| `chore` | Other repository maintenance |
| `revert` | Reverting a previous change |

Write the description in English, start with a lowercase imperative verb, and omit a trailing period. Keep the complete subject at most 72 characters. Describe the resulting change rather than using vague subjects such as `update files` or `fix bug`.

Examples:

```text
feat(editor): add recent project restoration
fix(preview): follow the editor cursor after recompilation
bench: measure realtime-tex preview latency
docs: define the commit message format
```

When context is useful, leave a blank line after the subject and explain why the change is needed and how it was validated. Mark an incompatible change with `!` before the colon, for example `feat(compiler)!: change the worker protocol`, and add a `BREAKING CHANGE:` footer explaining the migration. For a revert, use `revert: <original description>` and identify the reverted commit hash in the body.

## Security and community

Report sensitive vulnerabilities through the repository's private vulnerability reporting channel when available. Otherwise request a private contact from the maintainer without posting exploit details publicly. Include affected versions, impact and a minimal reproduction privately. Report issues against the current source revision; no separate release support policy is established yet.

Be respectful and constructive. Harassment and disclosure of private information are unacceptable. Report community concerns privately to the maintainer. Contributions use the project's MIT license unless a file explicitly retains another license.
