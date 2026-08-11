# Source provenance

DBOPFS 1.0.0 preserves the production runtime extracted from The Wizard Nexus ARCANE OS repository without implementation edits.

Source commit: `0d20bd517fd292d59c108fecf862e67c67197c9e`

| Runtime file | Git blob | SHA-256 |
| --- | --- | --- |
| `arcane/modules/DBOPFS.js` | `f313b8c2ba18cf9e7a619f627dce215807b33387` | `133EA76AE80210B6F2E873D4240CACA62E1F8D43558F77FC0E471E60355EE5E8` |
| `arcane/modules/DBOPFSWorker.js` | `5250c0854ce894f1e67d9b78342df68646085c2d` | `7B3F1B5176431A104A0FAA80063577362CC57EEF0800212ABAFC209F7912D14E` |
| `arcane/modules/AppDataScope.js` | `9943961bd8c4cf93655eece17f14b29ea817357a` | `4AC7BE2FC8C7E0E3DFAE4D748ED6DFD7A9169464B3FFB91E12C65D6D69574A06` |

The npm artifact retains the `arcane/modules/` layout and bundles `strong-type@1.1.0` inside the package. This preserves the runtime's existing relative dependency and worker URLs, so Arcane can redirect its DBOPFS module pointer to the installed package without changing DBOPFS call sites.
