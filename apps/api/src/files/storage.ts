import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Storage port (ADR-014): the API only needs put/get of opaque, already-encrypted blobs. */
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/** Local disk — development and tests. */
export class FsStorage implements ObjectStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, data, { flag: "wx" });
    await rename(tmp, p);
  }
  get(key: string) {
    return readFile(this.path(key));
  }
}

/** S3-compatible object storage (Hetzner Object Storage, MinIO). Loaded only when configured. */
export async function createS3Storage(o: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }): Promise<ObjectStorage> {
  const { S3Client, PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ endpoint: o.endpoint, region: o.region, forcePathStyle: true, credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } });
  return {
    async put(key, data) {
      await s3.send(new PutObjectCommand({ Bucket: o.bucket, Key: key, Body: data, ContentType: "application/octet-stream" }));
    },
    async get(key) {
      const r = await s3.send(new GetObjectCommand({ Bucket: o.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
  };
}

/** Files are encrypted with the tenant's file key before they leave the API (TEN-003). */
export function encryptFile(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from("FE1"), iv, c.getAuthTag(), body]);
}

export function decryptFile(key: Buffer, blob: Buffer): Buffer {
  if (blob.subarray(0, 3).toString() !== "FE1") throw new Error("unknown file envelope");
  const iv = blob.subarray(3, 15);
  const tag = blob.subarray(15, 31);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(31)), d.final()]);
}
