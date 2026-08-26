import api from '#/lib/api/http'

export interface CloudinarySignature {
  timestamp: number
  signature: string
  apiKey: string
  cloudName: string
  folder: string
  resourceType: string
}

export interface CloudinaryUploadResult {
  url: string
  publicId: string
}

/**
 * Fetch a signed upload signature from the backend.
 */
export async function getUploadSignature(
  folder = 'soroman'
): Promise<CloudinarySignature> {
  const res = await api.get('/uploads/signature', { params: { folder } })
  return res.data.data
}

/**
 * Upload a file directly to Cloudinary using a signed signature.
 *
 * @param file  The file to upload
 * @param signature  Signed params from getUploadSignature()
 * @returns  The uploaded file's URL and public ID
 */
/**
 * Which Cloudinary delivery type a file belongs under.
 *
 * `auto` — what this used to send — files a PDF as an `image`, and Cloudinary
 * refuses to DELIVER PDFs from the image pipeline unless the account opts in.
 * The upload succeeds, the link is stored, and clicking it months later
 * returns 401; the browser turns that into a login prompt, which is what an
 * expense attachment appeared to be asking for.
 *
 * `raw` has no such restriction and serves the file under its real content
 * type, so a PDF opens in the viewer instead of bouncing. Images stay on the
 * image pipeline, where they belong and where transformations work.
 *
 * The signature covers only `folder` and `timestamp` (see upload.service.js),
 * so choosing the delivery type here does not invalidate it.
 */
export function resourceTypeFor(file: File): 'image' | 'video' | 'raw' {
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  return 'raw'
}

export async function uploadToCloudinary(
  file: File,
  signature: CloudinarySignature
): Promise<CloudinaryUploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('api_key', signature.apiKey)
  formData.append('timestamp', String(signature.timestamp))
  formData.append('signature', signature.signature)
  formData.append('folder', signature.folder)

  // The server asks for "auto"; the file itself decides. See resourceTypeFor.
  const resourceType =
    signature.resourceType && signature.resourceType !== 'auto'
      ? signature.resourceType
      : resourceTypeFor(file)

  const endpoint = `https://api.cloudinary.com/v1_1/${signature.cloudName}/${resourceType}/upload`

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error?.message || 'Cloudinary upload failed')
  }

  const data = await response.json()
  return {
    url: data.secure_url,
    publicId: data.public_id,
  }
}

/**
 * Convenience: fetch signature + upload in one call.
 */
export async function uploadFile(
  file: File,
  folder = 'soroman'
): Promise<CloudinaryUploadResult> {
  const signature = await getUploadSignature(folder)
  return uploadToCloudinary(file, signature)
}

/** What the expense-attachment endpoints store for one uploaded file. */
export type ExpenseUploadedFile = {
  url: string
  publicId: string
  fileName: string
  contentType: string
  sizeBytes: number
}

/**
 * Upload straight to Cloudinary with a signature scoped to expenses.
 *
 * The general `/uploads/signature` route sits behind `verifyStaff`, which
 * admits only admin and super_admin — so the person actually holding the
 * receipt could not upload it. This fetches the same signature under the same
 * rule as raising a request: if you can raise one, you can attach its
 * paperwork.
 */
export async function uploadExpenseFile(file: File): Promise<ExpenseUploadedFile> {
  const res = await api.get('/expenses/attachments/signature')
  const signature = res.data.data as CloudinarySignature
  const up = await uploadToCloudinary(file, signature)
  return {
    url: up.url,
    publicId: up.publicId,
    fileName: file.name,
    contentType: file.type || '',
    sizeBytes: file.size,
  }
}
