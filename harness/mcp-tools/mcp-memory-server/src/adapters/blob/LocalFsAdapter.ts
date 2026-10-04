import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { BlobAdapter } from "./BlobAdapter.js";
import type { FileMeta } from "../../types.js";

// ─── Local Filesystem Adapter ─────────────────────────────────────────────────
//
// Stores files under a configurable root directory.
// Metadata (path, content-type, size, created-at) is persisted in a sidecar
// JSON index file (`_index.json`) in the root dir so we can reconstruct the
// full FileMeta list without scanning the filesystem every time.

interface IndexEntry {
  fileId: string;
  storagePath: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export class LocalFsAdapter implements BlobAdapter {
  private readonly rootDir: string;
  private readonly indexPath: string;
  private index: Map<string, IndexEntry> = new Map();

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.indexPath = path.join(rootDir, "_index.json");
  }

  async connect(): Promise<void> {
    fs.mkdirSync(this.rootDir, { recursive: true });
    this.loadIndex();
  }

  async disconnect(): Promise<void> {
    this.saveIndex();
  }

  async upload(
    storagePath: string,
    data: Buffer,
    contentType: string
  ): Promise<string> {
    // Sanitise the storagePath to prevent path traversal
    const safe = storagePath.replace(/\.\.\//g, "").replace(/^\//, "");
    const fileId = safe; // use the logical path as the fileId for deterministic keys

    const abs = path.join(this.rootDir, safe);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);

    const entry: IndexEntry = {
      fileId,
      storagePath: safe,
      contentType,
      size: data.length,
      createdAt: new Date().toISOString(),
    };
    this.index.set(fileId, entry);
    this.saveIndex();

    return fileId;
  }

  async download(fileId: string): Promise<Buffer> {
    const entry = this.index.get(fileId);
    if (!entry) throw new Error(`File not found: ${fileId}`);
    const abs = path.join(this.rootDir, entry.storagePath);
    if (!fs.existsSync(abs)) {
      throw new Error(`File "${fileId}" is indexed but missing on disk: ${abs}`);
    }
    return fs.readFileSync(abs);
  }

  async delete(fileId: string): Promise<void> {
    const entry = this.index.get(fileId);
    if (!entry) throw new Error(`File not found: ${fileId}`);
    const abs = path.join(this.rootDir, entry.storagePath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    this.index.delete(fileId);
    this.saveIndex();
  }

  async list(prefix?: string): Promise<FileMeta[]> {
    const entries = [...this.index.values()];
    const filtered = prefix
      ? entries.filter((e) => e.storagePath.startsWith(prefix))
      : entries;
    return filtered.map((e) => ({
      fileId: e.fileId,
      path: e.storagePath,
      contentType: e.contentType,
      size: e.size,
      createdAt: e.createdAt,
    }));
  }

  async getSignedUrl(fileId: string, _expiresInSec: number): Promise<string> {
    const entry = this.index.get(fileId);
    if (!entry) throw new Error(`File not found: ${fileId}`);
    return `file://${path.resolve(this.rootDir, entry.storagePath)}`;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private loadIndex(): void {
    if (!fs.existsSync(this.indexPath)) return;
    try {
      const raw = fs.readFileSync(this.indexPath, "utf8");
      const entries = JSON.parse(raw) as IndexEntry[];
      this.index = new Map(entries.map((e) => [e.fileId, e]));
    } catch {
      this.index = new Map();
    }
  }

  private saveIndex(): void {
    const entries = [...this.index.values()];
    fs.writeFileSync(this.indexPath, JSON.stringify(entries, null, 2), "utf8");
  }
}
