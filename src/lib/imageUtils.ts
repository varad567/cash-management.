// Downscales and re-compresses a photo before it ever reaches
// Supabase Storage. Phone cameras routinely produce 3-8MB photos;
// a receipt only needs to be legible, not print-quality — this
// keeps storage and bandwidth usage sane on a free/low-cost tier.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.75;

export async function compressImage(file: File): Promise<File> {
  // Non-image files (shouldn't happen given the file input's accept
  // filter, but defensive) pass through unchanged.
  if (!file.type.startsWith('image/')) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file; // canvas unsupported — fall back to the original rather than fail the upload

  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  );
  if (!blob) return file;

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg' });
}
