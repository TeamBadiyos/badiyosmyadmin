import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const SERVICE_IMAGE_BUCKET = "service-images";

/** Renders a private-bucket service image via a short-lived signed URL. */
export function ServiceImage({
  path,
  className = "",
  alt,
}: {
  path: string | null;
  className?: string;
  alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!path) return;
    supabase.storage
      .from(SERVICE_IMAGE_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path || !url) {
    return (
      <div
        className={`bg-muted flex items-center justify-center text-muted-foreground ${className}`}
        aria-hidden
      >
        <ImageIcon size={16} />
      </div>
    );
  }
  return <img src={url} alt={alt} className={`object-cover ${className}`} loading="lazy" />;
}

/** Uploads a squarish, compressed copy of the file and returns the storage path. */
export async function uploadServiceImage(serviceId: string, file: File): Promise<string> {
  const blob = await squareCompress(file);
  const path = `${serviceId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(SERVICE_IMAGE_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

async function squareCompress(file: File, size = 600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  return await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.82),
  );
}

/** Uploads a compressed square image for a catalogue item (price option). */
export async function uploadItemImage(optionId: string, file: File): Promise<string> {
  const blob = await squareCompress(file);
  const path = `items/${optionId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await supabase.storage
    .from(SERVICE_IMAGE_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

/** Uploads a short item video as-is and returns the storage path. */
export async function uploadItemVideo(optionId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
  const path = `items/${optionId}/video-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(SERVICE_IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type || "video/mp4", upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

/** Renders a private-bucket item video via a short-lived signed URL. */
export function ServiceVideo({ path, className = "" }: { path: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!path) return;
    supabase.storage
      .from(SERVICE_IMAGE_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!path || !url) return null;
  return <video src={url} controls className={className} />;
}
