# DBOPFS

[![release tests](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTheWizardNexus%2FDBOPFS%2Fmain%2Frelease%2Fbadges%2Ftests.json)](https://thewizardnexus.github.io/DBOPFS/status.html)
[![code coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTheWizardNexus%2FDBOPFS%2Fmain%2Frelease%2Fbadges%2Fcoverage.json)](https://thewizardnexus.github.io/DBOPFS/status.html)
[![version 1.0.0](https://img.shields.io/badge/version-1.0.0-ab94ff)](https://github.com/TheWizardNexus/DBOPFS/releases/tag/v1.0.0)
[![PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-d7a84d)](LICENSE)

DBOPFS is a browser-native database built directly on the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). Tables are directories, records are files, and application data stays in the browser unless the application exports it.

This `1.0.0` package preserves the production ARCANE OS runtime byte-for-byte. Its surrounding package, release tests, coverage evidence, licensing, and documentation are new; the three implementation files are unchanged.

[Read the documentation](https://thewizardnexus.github.io/DBOPFS/) · [Open the playground](https://thewizardnexus.github.io/DBOPFS/playground/) · [Review release evidence](https://thewizardnexus.github.io/DBOPFS/status.html)

## Install

```sh
npm install dbopfs@1.0.0
```

DBOPFS is a browser-only ESM module. Serve it over HTTPS or localhost; do not import it during Node.js server-side rendering.

Declare a stable application ID before loading the module:

```html
<meta name="arcane-app-id" content="my-app">
<script type="module">
  import '/node_modules/dbopfs/arcane/modules/DBOPFS.js';

  await window.dbopfs.readyPromise;

  await window.dbopfs.set('users', 'alex.json', {
    email: 'alex@example.com',
    role: 'admin'
  });

  const alex = await window.dbopfs.get('users', 'alex.json');
  console.log(alex);
</script>
```

With a browser-aware bundler or import map, the package root exports the same default `DBOPFS` class:

```js
import DBOPFS from 'dbopfs';

const db = window.dbopfs || new DBOPFS({applicationId: 'my-app'});
await db.readyPromise;
```

Use a `.json` key when you want `get()` to parse an object. Plain-text keys return strings; `.jsonl` and `.ndjson` keys return parsed row arrays.

## Core model

```text
OPFS root/
└── apps/
    └── my-app/
        ├── users/
        │   └── alex.json
        ├── documents/
        └── memory/
```

The application-ID folder prevents accidental cross-application access. It is not a security boundary against hostile code on the same origin. Use separate origins or browser profiles for mutually untrusted applications.

## Readiness

The race-safe path is the singleton promise:

```js
await window.dbopfs.readyPromise;
```

The module also dispatches `dbopfs-ready` with `{dbopfs, applicationId, storagePath}`:

```js
window.addEventListener('dbopfs-ready', ({detail}) => {
  console.log(detail.applicationId, detail.storagePath);
});
```

## API at a glance

| Area | Members |
| --- | --- |
| State | `ready`, `readyPromise`, `applicationId`, `storagePath`, `tables` |
| Records | `set`, `get`, `delete`, `setMany`, `getMany`, `deleteMany` |
| Tables | `getTableHandle`, `getAll`, `clear`, `deleteTable`, `getTableNames` |
| Discovery | `getAllKeys`, `filterKeyIncludes`, `hasKey`, `count` |
| Raw files | `writeFile`, `readFile`, `getFileMetadata` |
| Lifecycle | `clearAllStorage`, `downloadCompressedPNG`, `restoreFromPNG` |

The [API reference](https://thewizardnexus.github.io/DBOPFS/api.html) documents signatures, return values, cache behavior, and existing error semantics.

## ARCANE OS migration

The package intentionally keeps this layout:

```text
node_modules/dbopfs/
├── arcane/modules/
│   ├── AppDataScope.js
│   ├── DBOPFS.js
│   └── DBOPFSWorker.js
└── node_modules/strong-type/
```

An ARCANE installation can redirect its DBOPFS module mount or import pointer from the in-tree `arcane/modules` source to `node_modules/dbopfs/arcane/modules`. The worker and application-scope module remain adjacent, and the relative `strong-type` import remains valid because that dependency is bundled. Existing DBOPFS call sites do not need API changes.

The release test installs the packed tarball into a clean consumer fixture and verifies this exact layout before publication.

## Tests and coverage

Release tests use [`vanilla-test@1.4.9`](https://github.com/RIAEvangelist/vanilla-test) in Google Chrome against real OPFS on localhost. Chrome precise coverage is captured for the three runtime modules. There is intentionally no GitHub workflow; badges are generated from the final release evidence committed under `release/`.

```sh
npm ci
npm run release:test
```

## Browser support and limitations

- Requires a secure context and `navigator.storage.getDirectory()`.
- Uses a dedicated worker when synchronous OPFS access is needed.
- Requests persistent storage when the browser supports it; the browser may decline.
- Browser storage quotas, eviction rules, and backup APIs vary by browser.
- Importing in Node.js or SSR without browser globals is unsupported.
- Existing implementation behavior is documented rather than silently changed for `1.0.0`.

## License

Noncommercial use is licensed under [PolyForm Noncommercial 1.0.0](LICENSE). This is source-available software, not OSI open source.

A separate paid commercial license is available for a nominal fee; see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md). Downloading the package does not grant commercial rights.

Source identity and hashes are recorded in [SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md). Third-party terms are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
