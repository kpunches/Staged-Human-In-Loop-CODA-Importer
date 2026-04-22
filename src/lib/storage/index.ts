import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

// R2 is S3-compatible — we just point the endpoint at Cloudflare
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = process.env.R2_BUCKET_NAME!

// ─── Key helpers ─────────────────────────────────────────────────────────────

export function sourceFileKey(tenantId: string, reviewId: string, filename: string) {
  return `${tenantId}/${reviewId}/source/${filename}`
}

export function extractionKey(tenantId: string, reviewId: string) {
  return `${tenantId}/${reviewId}/extraction.json`
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export async function uploadFile(key: string, body: Buffer | Uint8Array, contentType: string) {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
  return key
}

export async function uploadJson(key: string, data: unknown) {
  const body = Buffer.from(JSON.stringify(data, null, 2))
  return uploadFile(key, body, "application/json")
}

// ─── Download ─────────────────────────────────────────────────────────────────

export async function downloadJson<T = unknown>(key: string): Promise<T> {
  const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const text = await response.Body?.transformToString()
  if (!text) throw new Error(`Empty response from R2 for key: ${key}`)
  return JSON.parse(text) as T
}

export async function downloadBuffer(key: string): Promise<Buffer> {
  const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const bytes = await response.Body?.transformToByteArray()
  if (!bytes) throw new Error(`Empty response from R2 for key: ${key}`)
  return Buffer.from(bytes)
}

// ─── Signed URLs (15-min expiry) ──────────────────────────────────────────────

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 900) {
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: expiresInSeconds }
  )
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteFile(key: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}
