import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { BlobAdapter } from "./BlobAdapter.js";
import type { FileMeta } from "../../types.js";

// ─── S3-Compatible Adapter ────────────────────────────────────────────────────
//
// Works with any S3-compatible provider:
//   - AWS S3              (no endpoint override needed)
//   - Cloudflare R2       (endpoint = https://<accountId>.r2.cloudflarestorage.com)
//   - Backblaze B2        (endpoint = https://s3.<region>.backblazeb2.com)
//   - Supabase Storage    (endpoint = https://<project>.supabase.co/storage/v1/s3)
//   - MinIO               (endpoint = http://localhost:9000)
//
// Only the endpoint URL and credentials differ — the adapter logic is identical.

export interface S3AdapterConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional endpoint override for non-AWS providers */
  endpoint?: string;
  /** Force path-style URLs (required for MinIO and some S3-compatible services) */
  forcePathStyle?: boolean;
}

export class S3Adapter implements BlobAdapter {
  private client!: S3Client;
  private readonly config: S3AdapterConfig;

  constructor(config: S3AdapterConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.client = new S3Client({
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      ...(this.config.endpoint
        ? { endpoint: this.config.endpoint }
        : {}),
      forcePathStyle: this.config.forcePathStyle ?? false,
    });

    // Connectivity check — list up to 1 key to confirm credentials work
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.config.bucket, MaxKeys: 1 })
      );
    } catch (err) {
      throw new Error(
        `S3 connection check failed for bucket "${this.config.bucket}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }

  async upload(
    storagePath: string,
    data: Buffer,
    contentType: string
  ): Promise<string> {
    const key = storagePath.replace(/^\//, ""); // strip leading slash
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ContentLength: data.length,
      })
    );
    return key; // the S3 key is the canonical fileId
  }

  async download(fileId: string): Promise<Buffer> {
    const { Body } = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: fileId })
    );
    if (!Body) throw new Error(`Empty response for key "${fileId}"`);

    // Body is a web ReadableStream in Node ≥18 / AWS SDK v3
    const chunks: Uint8Array[] = [];
    for await (const chunk of Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(fileId: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: fileId })
    );
  }

  async list(prefix?: string): Promise<FileMeta[]> {
    const results: FileMeta[] = [];
    let continuationToken: string | undefined;

    do {
      const resp = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of resp.Contents ?? []) {
        if (!obj.Key) continue;
        // Fetch content-type via HEAD for each object (cheap, parallel-able)
        let contentType = "application/octet-stream";
        try {
          const head = await this.client.send(
            new HeadObjectCommand({ Bucket: this.config.bucket, Key: obj.Key })
          );
          contentType = head.ContentType ?? contentType;
        } catch {
          // ignore head failures
        }

        results.push({
          fileId: obj.Key,
          path: obj.Key,
          contentType,
          size: obj.Size ?? 0,
          createdAt: obj.LastModified?.toISOString() ?? new Date().toISOString(),
        });
      }

      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);

    return results;
  }

  async getSignedUrl(fileId: string, expiresInSec: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: fileId,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSec });
  }
}
