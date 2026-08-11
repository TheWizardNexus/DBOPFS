# Contributing

DBOPFS 1.0.0 is the byte-preserved ARCANE OS runtime. Open an issue before proposing an implementation change so compatibility and licensing can be discussed first.

For documentation or release-infrastructure changes:

1. Install the exact dependencies with `npm ci`.
2. Run `npm run release:test` in Google Chrome.
3. Confirm that all three runtime hashes still match `SOURCE_PROVENANCE.md`.
4. Include the release-test and coverage result in the change description.

Contributions are accepted only under terms that allow The Wizard Nexus to distribute the resulting work under the repository's public noncommercial license and its separate commercial licenses.
