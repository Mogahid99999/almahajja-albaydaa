// Cloudflare R2 access (S3 API). Existence checks use a 1-byte ranged
// GetObjectCommand — NEVER HeadObjectCommand, which hangs/fails against R2
// (V13 gotcha, same as supabase/functions/r2-upload-url).

import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { AbortedError } from './errors.js';

export interface ListedObject {
  key: string;
  /** null when the listing did not say (treated as "too new" by the sweep). */
  lastModified: Date | null;
}

export interface ListPage {
  objects: ListedObject[];
  /** Continuation token for the next page, or null when done. */
  next: string | null;
}

export interface Storage {
  /** Stream an object to `path`. `onFraction` gets 0..1 when the size is known. */
  downloadToFile(key: string, path: string, opts?: { signal?: AbortSignal; onFraction?: (f: number) => void }): Promise<number>;
  /** Upload a local file (multipart for big files). Returns the uploaded byte size. */
  uploadFile(
    key: string,
    path: string,
    contentType: string,
    opts?: { signal?: AbortSignal; onFraction?: (f: number) => void },
  ): Promise<number>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** One ListObjectsV2 page (≤ 1000 keys) under `prefix`. */
  listPage(prefix: string, continuationToken?: string | null): Promise<ListPage>;
}

export interface R2Options {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

interface S3ishError {
  name?: string;
  Code?: string;
  $metadata?: { httpStatusCode?: number };
}

/** NoSuchKey / 404 → the key is free. */
export function isNotFound(err: unknown): boolean {
  const e = err as S3ishError;
  return e?.name === 'NoSuchKey' || e?.Code === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

/** 416 on `bytes=0-0` means the object exists but is empty. */
export function isInvalidRange(err: unknown): boolean {
  const e = err as S3ishError;
  return e?.name === 'InvalidRange' || e?.Code === 'InvalidRange' || e?.$metadata?.httpStatusCode === 416;
}

export function createR2Storage(opts: R2Options): Storage {
  const client = new S3Client({
    region: 'auto',
    endpoint: opts.endpoint,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    // R2 does not implement every flexible-checksum algorithm the newer SDKs
    // send by default; only checksum when the operation requires it.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 4,
    // Idle-socket timeout (not a total-request cap — a 2 GB download may take a
    // while): a stalled R2 connection errors out instead of hanging the job.
    requestHandler: { connectionTimeout: 10_000, socketTimeout: 120_000 },
  });
  const Bucket = opts.bucket;

  return {
    async downloadToFile(key, path, o = {}) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }), { abortSignal: o.signal });
      if (!res.Body) throw new Error(`empty body for ${key}`);
      const total = res.ContentLength ?? 0;
      let seen = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          seen += chunk.length;
          if (total > 0) o.onFraction?.(seen / total);
          cb(null, chunk);
        },
      });
      try {
        await pipeline(res.Body as Readable, counter, createWriteStream(path), { signal: o.signal });
      } catch (err) {
        if (o.signal?.aborted) throw new AbortedError('download aborted');
        throw err;
      }
      if (total > 0 && seen !== total) throw new Error(`short read for ${key}: ${seen}/${total} bytes`);
      return seen;
    },

    async uploadFile(key, path, contentType, o = {}) {
      const { size } = await stat(path);
      const upload = new Upload({
        client,
        params: { Bucket, Key: key, Body: createReadStream(path), ContentType: contentType, ContentLength: size },
        queueSize: 4,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      });
      upload.on('httpUploadProgress', (p) => {
        const total = p.total ?? size;
        if (total > 0 && typeof p.loaded === 'number') o.onFraction?.(p.loaded / total);
      });
      const onAbort = () => void upload.abort().catch(() => {});
      o.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        await upload.done();
      } catch (err) {
        if (o.signal?.aborted) throw new AbortedError('upload aborted');
        throw err;
      } finally {
        o.signal?.removeEventListener('abort', onAbort);
      }
      return size;
    },

    async exists(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: 'bytes=0-0' }));
        // Release the socket — we only wanted the status.
        (res.Body as Readable | undefined)?.destroy?.();
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        if (isInvalidRange(err)) return true;
        // Unknown failure: refuse to guess (a false "free" would overwrite a lecture).
        throw err;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    async listPage(prefix, continuationToken) {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }),
      );
      return {
        objects: (res.Contents ?? [])
          .filter((o): o is typeof o & { Key: string } => typeof o.Key === 'string')
          .map((o) => ({ key: o.Key, lastModified: o.LastModified ?? null })),
        next: res.IsTruncated && res.NextContinuationToken ? res.NextContinuationToken : null,
      };
    },
  };
}
