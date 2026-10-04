/**
 * File Metadata Aggregator — walks a directory tree with fs.promises.readdir
 * (recursive: true) and folds the resulting entries into:
 *   - total size (sum of file sizes, in bytes)
 *   - modification range (min/max mtime seen)
 *   - type breakdown (counts grouped by Node fs type strings)
 *
 * Design decisions, recorded because they are not obvious from the code:
 *
 * 1. We use readdir({ withFileTypes: true, recursive: true }) rather than
 *    a manual recursive walk. The recursive option is supported in Node 20.9+
 *    and avoids both a stack overflow risk on deep trees and the race
 *    condition window of a two-call (stat-after-readdir) manual walk.
 *
 * 2. Directory sizes are not summed — only regular file sizes contribute to
 *    totalSize. Reporting a directory's "size" as the byte count of its
 *    listing is filesystem-dependent and misleading; we leave it out.
 *
 * 3. Symlinks are reported by their dirent.type ('symlink') but their size
 *    and mtime are NOT added to totals, because lstat-style semantics on a
 *    symlink describe the link, not the target, and mixing the two would
 *    double-count or misattribute. If you need target stats, resolve first.
 *
 * 4. Errors from individual stat calls are swallowed and counted in
 *    statErrors. A single unreadable file should not abort a whole-tree scan.
 *    The alternative — throwing — forces the caller to retry the entire walk.
 *
 * 5. directoryCount counts entries whose type is 'directory'. The recursive
 *    readdir includes the root's subdirectories but not the root itself,
 *    so directoryCount is the count of subdirectories, not root + subdirs.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @typedef {Object} AggregationResult
 * @property {number} totalSize       Sum of sizes of all regular files, in bytes.
 * @property {number} fileCount       Number of regular files seen.
 * @property {number} directoryCount  Number of subdirectories seen (excludes root).
 * @property {number} symlinkCount    Number of symbolic links seen.
 * @property {number} otherCount      Entries whose dirent.type is none of the above.
 * @property {number} statErrors      Number of entries whose stat() rejected.
 * @property {number|null} oldestMtimeMs Earliest mtime seen (epoch ms), or null if no files had a usable mtime.
 * @property {number|null} newestMtimeMs Latest mtime seen (epoch ms), or null likewise.
 * @property {Record<string, number>} typeBreakdown Map of dirent.type -> count.
 * @property {number} totalEntries    Every entry readdir returned, including those that failed stat.
 */

/**
 * Walk a directory tree and aggregate file metadata.
 *
 * The single method, aggregate, is async because the underlying fs calls are.
 * Constructing the class is cheap and stateless; one instance can be reused
 * for multiple paths.
 */
export class FileMetadataAggregator {
  /**
   * @param {string} rootPath Absolute or relative path to the directory to scan.
   * @returns {Promise<AggregationResult>}
   */
  async aggregate(rootPath) {
    if (typeof rootPath !== 'string' || rootPath.length === 0) {
      throw new TypeError('rootPath must be a non-empty string');
    }

    /** @type {AggregationResult} */
    const result = {
      totalSize: 0,
      fileCount: 0,
      directoryCount: 0,
      symlinkCount: 0,
      otherCount: 0,
      statErrors: 0,
      oldestMtimeMs: null,
      newestMtimeMs: null,
      typeBreakdown: {},
      totalEntries: 0,
    };

    let entries;
    try {
      entries = await readdir(rootPath, { withFileTypes: true, recursive: true });
    } catch (err) {
      // If readdir itself fails (missing dir, permission denied at root),
      // surface the error rather than returning a misleading zero result.
      // A zero-result silently hides infrastructure problems; a throw lets
      // the caller distinguish "empty tree" from "could not read tree".
      throw err;
    }

    for (const entry of entries) {
      result.totalEntries += 1;

      const t = entry.isDirectory() ? 'directory'
        : entry.isFile() ? 'file'
        : entry.isSymbolicLink() ? 'symlink'
        : entry.isBlockDevice() ? 'blockdevice'
        : entry.isCharacterDevice() ? 'characterdevice'
        : entry.isFIFO() ? 'fifo'
        : entry.isSocket() ? 'socket'
        : 'unknown';

      result.typeBreakdown[t] = (result.typeBreakdown[t] || 0) + 1;

      if (t === 'directory') {
        result.directoryCount += 1;
        continue;
      }
      if (t === 'symlink') {
        result.symlinkCount += 1;
        continue;
      }
      if (t !== 'file') {
        result.otherCount += 1;
        continue;
      }

      // Regular file: stat for size and mtime.
      // readdir gives the full path when recursive: true, but on some runtimes
      // entry.path may be the root; constructing via join is portable.
      const fullPath = entry.path != null ? join(entry.path, entry.name) : join(rootPath, entry.name);
      try {
        const st = await stat(fullPath);
        result.fileCount += 1;
        result.totalSize += st.size;
        const mtime = st.mtimeMs;
        if (typeof mtime === 'number' && Number.isFinite(mtime)) {
          if (result.oldestMtimeMs === null || mtime < result.oldestMtimeMs) {
            result.oldestMtimeMs = mtime;
          }
          if (result.newestMtimeMs === null || mtime > result.newestMtimeMs) {
            result.newestMtimeMs = mtime;
          }
        }
      } catch (err) {
        // File vanished between readdir and stat, or permissions changed.
        // Count it but don't abort — partial results are more useful than none
        // when scanning live filesystems.
        result.statErrors += 1;
      }
    }

    return result;
  }
}
