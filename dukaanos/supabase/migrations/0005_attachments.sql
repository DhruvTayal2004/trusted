-- Attach a receipt / invoice image to an existing expense or purchase after the fact
-- (photos taken offline are uploaded when connectivity returns). Only the path changes;
-- the financial fields stay immutable (guard triggers still apply).
create or replace function set_attachment_path(p_table text, p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m shop_members;
begin
  m := _require_member();
  if p_path is null or p_path not like m.shop_id::text || '/%' then
    raise exception 'Attachment path must be inside this shop''s folder' using errcode = 'P0001';
  end if;
  if p_table = 'expenses' then
    update expenses set receipt_image_path = p_path
    where id = p_id and shop_id = m.shop_id and (member_id = m.id or m.role in ('owner','admin'))
      and (receipt_image_path is null or receipt_image_path = 'upload_pending');
  elsif p_table = 'purchases' then
    update purchases set invoice_image_path = p_path
    where id = p_id and shop_id = m.shop_id and (member_id = m.id or m.role in ('owner','admin'))
      and (invoice_image_path is null or invoice_image_path = 'upload_pending');
  else
    raise exception 'Unsupported table %', p_table using errcode = 'P0001';
  end if;
  if not found then raise exception 'Record not found or attachment already set' using errcode = 'P0002'; end if;
end $$;
grant execute on function set_attachment_path(text, uuid, text) to authenticated;
