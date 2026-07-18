export const RESPONSE_RENDER_LIMITS = {
  maximumTextCharacters: 200_000,
  maximumJsonCharacters: 500_000,
  maximumImageBytes: 25 * 1024 * 1024,
  maximumTreeEntriesPerNode: 500,
  maximumTreeDepth: 24,
} as const;

const SAFE_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface BoundedText {
  text: string;
  omittedCharacters: number;
}

export function boundResponseText(
  value: string,
  maximum: number = RESPONSE_RENDER_LIMITS.maximumTextCharacters
): BoundedText {
  const safeMaximum = Number.isInteger(maximum) && maximum >= 0
    ? maximum
    : RESPONSE_RENDER_LIMITS.maximumTextCharacters;
  if (value.length <= safeMaximum) {
    return { text: value, omittedCharacters: 0 };
  }
  return {
    text: value.slice(0, safeMaximum),
    omittedCharacters: value.length - safeMaximum,
  };
}

export function normalizeImageMimeType(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const mimeType = value.split(';', 1)[0].trim().toLowerCase();
  return SAFE_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null;
}

export function decodedBase64Size(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function validateImagePreview(
  mimeType: string | undefined,
  base64Body: string
): { ok: true; mimeType: string; byteLength: number } | { ok: false; reason: string } {
  const normalizedMimeType = normalizeImageMimeType(mimeType);
  if (!normalizedMimeType) {
    return { ok: false, reason: 'This image MIME type is not allowed for inline preview.' };
  }
  const byteLength = decodedBase64Size(base64Body);
  if (byteLength === null) {
    return { ok: false, reason: 'The response is not exact base64 image data.' };
  }
  if (byteLength > RESPONSE_RENDER_LIMITS.maximumImageBytes) {
    return { ok: false, reason: 'The image is too large to preview safely.' };
  }
  return { ok: true, mimeType: normalizedMimeType, byteLength };
}
