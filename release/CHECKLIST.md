# DBOPFS 1.0.0 release checklist

- [ ] Confirm `package.json` contains the intended npm name and version.
- [ ] Run `npm ci` from the repository root.
- [ ] Run `npm run release:test` and require a zero exit code.
- [ ] Confirm `release/files/test-results.json` reports vanilla-test with zero failures.
- [ ] Confirm `release/files/coverage-summary.json` contains measured coverage for all three runtime modules.
- [ ] Confirm `release/files/npm-pack.json` identifies the expected name and version.
- [ ] Confirm `release/files/packed-install.json` reports exact runtime hash matches, nested `strong-type`, a passing installed-package Chrome set/get test, and successful fixture cleanup.
- [ ] Verify `release/files/SHA256SUMS.txt` before distributing the tarball.
- [ ] Confirm the tests and coverage Shields endpoint badges resolve from `release/badges/`.
- [ ] Confirm the repository state, release notes, documentation site, and licensing files are final.
- [ ] Publish the single verified tarball and create the corresponding GitHub 1.0.0 release.
- [ ] Verify a clean Arcane OS checkout can replace only its DBOPFS module pointer with the installed package URL.
