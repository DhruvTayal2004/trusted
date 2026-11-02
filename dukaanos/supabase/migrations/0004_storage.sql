-- Storage buckets: notebook page photos, expense receipts, purchase invoices.
-- Private buckets; objects live under <shop_id>/... and are readable only by members of that shop.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('notebook-pages', 'notebook-pages', false, 15728640, array['image/jpeg','image/png','image/webp']),
  ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('invoices', 'invoices', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "shop members read own shop objects" on storage.objects for select
  using (bucket_id in ('notebook-pages','receipts','invoices') and (storage.foldername(name))[1] = current_shop_id()::text);

create policy "shop members upload to own shop folder" on storage.objects for insert
  with check (bucket_id in ('notebook-pages','receipts','invoices') and (storage.foldername(name))[1] = current_shop_id()::text);

-- No update/delete: page images are evidence and must be preserved.
