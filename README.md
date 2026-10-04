# File Metadata Aggregator

A small Node.js (ESM, zero-dependency) library that walks a directory tree with `fs.readdir` (recursive mode) and folds the entries into a single summary: total size of regular files, modification-time range, and a breakdown by entry type.

## Usage

```js
import { tmpdir } from 'node:os';
import { FileMetadataAggregator } from 'file-metadata-aggregator';

const agg = new FileMetadataAggregator();
const result = await agg.aggregate(tmpdir());

console.log(result.totalSize);        // bytes, regular files only
console.log(result.fileCount);        // number of regular files
console.log(result.directoryCount);   // number of subdirectories (excludes root)
console.log(result.symlinkCount);     // number of symbolic links
console.log(result.oldestMtimeMs);    // epoch ms, or null if no files
console.log(result.newestMtimeMs);    // epoch ms, or null if no files
console.log(result.typeBreakdown);    // { file: N, directory: N, symlink: N, ... }
console.log(result.statErrors);       // count of entries whose stat() failed
console.log(result.totalEntries);     // every entry readdir returned
```

The class exports one method, `aggregate(rootPath)`, which returns a `Promise<AggregationResult>`. Construction is stateless; reuse one instance across many paths.

## Why this exists

Scanning a tree to answer "how big is this, what's in it, and when did it last change?" is a recurring chore that's easy to get subtly wrong — double-counting symlinks, forgetting that directory sizes are meaningless, or aborting the whole walk on a single unreadable file. This library makes one set of decisions and sticks with them.

The trade-off: it uses `fs.readdir({ recursive: true })`, which buffers the entire entry list in memory before aggregation begins. That is fine for trees up to a few hundred thousand entries and lets us avoid a hand-rolled recursive walk that would risk stack overflow and stat-after-readdir races. For truly enormous trees, a streaming walker would be a different library.

## Edge cases you will hit

- **Symlinks are counted but not measured.** A symlink's own size and mtime describe the link entry, not its target; mixing them with regular-file stats double-counts. If you need target stats, resolve the symlink yourself first.
- **Directory sizes are not summed.** A directory's byte size is filesystem-dependent and meaningless as a content measure; only regular files contribute to `totalSize`.
- **`directoryCount` excludes the root.** It is the number of subdirectories found, because the root is not an entry returned by `readdir`.
- **Files that vanish between `readdir` and `stat`** are counted in `statErrors` rather than aborting the walk. A partial result for a live filesystem is more useful than a thrown error that forces a full retry.
- **Requires Node 20.9+**, where `readdir({ recursive: true, withFileTypes: true })` landed. Earlier versions will throw at call time.
