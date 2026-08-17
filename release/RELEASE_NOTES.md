# DBOPFS 1.0.0 release notes

DBOPFS 1.0.0 packages the preserved Arcane OS browser database modules as an
npm-installable module. The public entry point remains
`arcane/modules/DBOPFS.js`, and `strong-type` is bundled at the nested location
used by the preserved runtime import.

The local release gate runs the existing vanilla-test 2.1.0 suite in installed
Google Chrome using Node.js 22.12 or newer, records precise Chrome DevTools
byte coverage without inventing a coverage threshold, packs the npm artifact
with lifecycle scripts disabled, and installs that tarball into a fresh
operating-system temporary directory.
It then verifies the three runtime files against the checked-in SHA-256 source
manifest and imports the installed package in Chrome for a real OPFS set/get
round trip.

Run the complete gate with:

```console
npm run release:test
```

Machine-readable evidence is written to `release/files/`, Shields endpoint
JSON is written to `release/badges/`, and the temporary install fixture is
removed after every run. Publishing is a separate, intentional step after the
checklist is complete.
