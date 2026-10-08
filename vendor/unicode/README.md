# Vendored Unicode data (raw UCD inputs)

Raw Unicode Character Database files used to generate the create-name key tables of
`hn-create-name-key-v3` (absence-witness evidence contract r3.4, §1.5, §2.6 P-10). They are committed
so that `T12` + `ccc12` and `K`'s case-folding table can be regenerated offline and re-checked by
anyone against unicode.org by hash. The generator `scripts/gen-create-name-key-tables.mjs` checks the
four sha256 values below before reading anything and needs no network. The Docker image copies `src`
only, so these raw files stay out of the image; the generated tables live in `src/lib/unicode-data/`
next to a second, identical copy of the licence notice.

| File | Source URL | Bytes | sha256 | Fetched |
|---|---|---|---|---|
| `ucd-12.1.0/UnicodeData.txt` | https://www.unicode.org/Public/12.1.0/ucd/UnicodeData.txt | 1797778 | `93ab1acd8fd9d450463b50ae77eab151a7cda48f98b25b56baed8070f80fc936` | 2026-10-08 |
| `ucd-12.1.0/CaseFolding.txt` | https://www.unicode.org/Public/12.1.0/ucd/CaseFolding.txt | 82624 | `9c772627c6ee77eea6a17b42927b8ee28ca05dc65d6a511062104baaf3d12294` | 2026-10-08 |
| `ucd-12.1.0/DerivedCoreProperties.txt` | https://www.unicode.org/Public/12.1.0/ucd/DerivedCoreProperties.txt | 993782 | `a6eb7a8671fb532fbd88c37fd7b20b5b2e7dbfc8b121f74c14abe2947db0da68` | 2026-10-08 |
| `ucd-17.0.0/CaseFolding.txt` | https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt | 87539 | `ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183` | 2026-10-08 |

- The three 12.1.0 files are the inputs of the kernel-model table `T12` + `ccc12`
  (`src/lib/unicode-data/kernel-nfdicf-12.1.0.js`). Unicode 12.1.0 is the version of the table that
  Linux ships (`UTF8_LATEST`, tag `v6.17`); the kernel itself is used only as an out-of-repo
  cross-check (KM-3 listing digest `35428a6864b7ee7c3b842135f952c9163b68d4e7238f26149ff26d2b2061c97a`,
  KM-3b `b08a8500c7c6fa9e28a021745ded7a0f1fd759ff22738cdc9f7d9675827367a3`). No kernel source, table or port is in this
  repository (GPL-2.0).
- The 17.0.0 `CaseFolding.txt` is the source of `K`'s full case folding table (status C and F only,
  `src/lib/unicode-data/casefold-17.0.0.js`).
- `DerivedAge.txt` is intentionally not committed: it is not an input of `T12` for the 12.1.0 view.
  Reference pin only: sha256 `2fc081011d8fabaf7cf4937732dd5a6d6a57e492c43f3adfeded513387ee0ec3` (118029 bytes).
- `LICENSE-UNICODE-V3.txt`: the Unicode License v3 text from https://www.unicode.org/license.txt
  (fetched 2026-10-08, 1995 bytes). It covers these data files and every table derived from them;
  `src/lib/unicode-data/LICENSE-UNICODE-V3.txt` is an identical copy.

Regenerate or check the derived tables:

```
node scripts/gen-create-name-key-tables.mjs --write
node scripts/gen-create-name-key-tables.mjs --check
```
