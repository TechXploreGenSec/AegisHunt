import type { FileMeta } from "../../types.js";

// ─── Blob / File Adapter Interface ───────────────────────────────────────────
//
// Every file-storage backend (local filesystem, Cloudflare R2, Backblaze B2,
// Supabase Storage, MinIO, …) must satisfy this contract.
//
// S3-compatible providers (R2, B2, Supabase Storage, MinIO) share the single
// S3Adapter implementation — only the endpoint URL and credentials change.

export interface BlobAdapter {
  /** Initialise the backend (create root bucket/dir if missing, etc.) */
  connect(): Promise<void>;

  /** Tear down gracefully */
  disconnect(): Promise<void>;

  /**
   * Upload raw bytes.
   *
   * @param storagePath  Logical path/key, e.g. "notes/2024-01-01.md"
   * @param data         File contents as a Buffer
   * @param contentType  MIME type, e.g. "text/markdown"
   * @returns            The file id/key used for subsequent operations
   */
  upload(storagePath: string, data: Buffer, contentType: string): Promise<string>;

  /**
   * Download a stored file by its id.
   * Throws if the file does not exist.
   */
  download(fileId: string): Promise<Buffer>;

  /** Permanently delete a stored file. */
  delete(fileId: string): Promise<void>;

  /**
   * List stored files, optionally filtered by a path prefix.
   *
   * @param prefix  Optional prefix, e.g. "notes/" to list only notes.
   */
  list(prefix?: string): Promise<FileMeta[]>;

  /**
   * Generate a temporary signed URL for a stored file.
   * Links expire after `expiresInSec` seconds (default 3600).
   * For local-fs backends this returns a `file://` URI.
   */
  getSignedUrl(fileId: string, expiresInSec: number): Promise<string>;
}
