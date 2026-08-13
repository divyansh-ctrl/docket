# Dependency risk register

**Reviewed:** 2026-08-13  
**Scope:** `apps/dashboard`

## Current release decision

The deployed dependency set reports no known vulnerabilities with
`npm audit --omit=dev`. The full development-tree audit reports two high
findings inherited from `vinext@1.0.0-beta.2` through its exact
`image-size@2.0.2` dependency:

- [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr):
  denial of service in the ICNS parser;
- [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq):
  denial of service in JXL and HEIF parsers.

No patched `image-size` release was available at review time. npm proposes
downgrading Vinext to `0.0.45`, which is a breaking and unsuitable change for
this prototype, so that recommendation was not applied.

## Exposure assessment

- `image-size` is absent from the compiled `dist` artifact.
- The dashboard does not accept or inspect user-supplied images.
- The vulnerable parser is therefore limited to the local build toolchain, not
  the deployed request path.
- Development dependencies must still be treated as trusted tooling: do not
  build untrusted branches or untrusted image assets on a privileged machine.

## Controls and exit criteria

1. Keep the production audit at zero.
2. Build only reviewed source and repository-owned assets.
3. Run the toolchain in a disposable or least-privileged environment.
4. Recheck the advisory database before every release.
5. Upgrade Vinext/image-size when a compatible patched release is available.
6. Block any future feature that feeds untrusted image bytes to the affected
   development dependency.

This is a time-bounded risk acceptance for the prototype, not a claim that the
full dependency tree is vulnerability-free.
