# Release evidence

Generated: 2026-08-17T16:21:24.695Z

| Gate | Result | Evidence |
| --- | --- | --- |
| Package | dbopfs | 1.0.0 |
| Overall release gate | PASSED | All gates passed |
| Browser tests | passed | 87 passed, 0 failed, 0 skipped; vanilla-test 1.4.9 |
| Precise coverage | 86.68% | 35920 / 41441 executed source bytes; no release threshold is asserted |
| npm pack | passed | dbopfs-1.0.0.tgz |
| Fresh install | passed | npm lifecycle scripts disabled: true |
| Installed Chrome smoke | passed | imported /node_modules/dbopfs/arcane/modules/DBOPFS.js; set/get round trip |
| Temporary fixture cleanup | passed | cleanup restricted to the mkdtemp path |

## Browser test suites

| Suite | Passed | Failed | Skipped | Total |
| --- | ---: | ---: | ---: | ---: |
| Unit | 37 | 0 | 0 | 37 |
| Functional | 34 | 0 | 0 | 34 |
| Integration | 12 | 0 | 0 | 12 |
| Regression | 4 | 0 | 0 | 4 |

## Installed runtime integrity

| Runtime file | Expected SHA-256 | Installed SHA-256 | Match |
| --- | --- | --- | --- |
| arcane/modules/AppDataScope.js | 4ac7be2fc8c7e0e3dfae4d748ed6dfd7a9169464b3ffb91e12c65d6d69574a06 | 4ac7be2fc8c7e0e3dfae4d748ed6dfd7a9169464b3ffb91e12c65d6d69574a06 | yes |
| arcane/modules/DBOPFS.js | 133ea76ae80210b6f2e873d4240caca62e1f8d43558f77fc0e471e60355ee5e8 | 133ea76ae80210b6f2e873d4240caca62e1f8d43558f77fc0e471e60355ee5e8 | yes |
| arcane/modules/DBOPFSWorker.js | 7b3f1b5176431a104a0faa80063577362cc57eef0800212abafc209f7912d14e | 7b3f1b5176431a104a0faa80063577362cc57eef0800212abafc209f7912d14e | yes |

## Bundled runtime dependency

Verified `node_modules/strong-type/index.js` (strong-type 1.1.0, SHA-256 a7b76761aa83553f172846587cbc96809b648640e90d019ae94c2795418a02f4).

## Artifact inventory

- `test-results.json`: vanilla-test browser results and source-integrity checks.
- `coverage-summary.json` and `coverage-raw.json`: actual Chrome DevTools coverage.
- `npm-pack.json`: machine-readable output from `npm pack --json`.
- `packed-install.json`: clean-install, hash, nested-dependency, browser-smoke, and cleanup evidence.
- `SHA256SUMS.txt`: SHA-256 checksums for the release files.

