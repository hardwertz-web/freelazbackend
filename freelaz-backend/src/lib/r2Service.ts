import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

let client: S3Client | null = null;

function getClient(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
}

export type R2SaveResult =
  | { ok: true; url: string; key: string }
  | { ok: false; error: string };

export async function uploadToR2(
  bytes: Buffer,
  key: string,
  contentType: string
): Promise<R2SaveResult> {
  const s3 = getClient();
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!s3 || !bucket || !publicUrl) {
    return { ok: false, error: "R2 não configurado" };
  }

  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }));

    return {
      ok: true,
      url: `${publicUrl.replace(/\/$/, "")}/${key}`,
      key,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `R2 upload falhou: ${message}` };
  }
}

export async function deleteFromR2(key: string): Promise<{ ok: boolean }> {
  const s3 = getClient();
  const bucket = process.env.R2_BUCKET;
  if (!s3 || !bucket) return { ok: false };
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
