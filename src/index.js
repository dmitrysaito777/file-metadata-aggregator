/**
 * Public entry point for the File Metadata Aggregator.
 *
 * Re-exports the aggregator so callers import a single path:
 *   import { FileMetadataAggregator } from 'file-metadata-aggregator';
 *
 * The split between index.js and core.js keeps the public surface
 * (a single class) separate from the implementation details, which
 * makes future refactors that move helpers around invisible to users.
 */
export { FileMetadataAggregator } from './core.js';
