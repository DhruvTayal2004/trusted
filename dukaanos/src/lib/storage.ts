import { File } from 'expo-file-system';
import { supabase } from './supabase';

/** Upload a local image to a private bucket. Returns the storage path. Throws when offline. */
export async function uploadImage(bucket: 'receipts' | 'invoices' | 'notebook-pages', path: string, localUri: string): Promise<string> {
  const file = new File(localUri);
  const bytes = await file.bytes();
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (error && !error.message.toLowerCase().includes('already exists')) throw error;
  return path;
}

export async function signedImageUrl(bucket: string, path: string, seconds = 600): Promise<string | null> {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
