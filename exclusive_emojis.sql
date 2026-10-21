-- MADA exclusive emoji: whitelist + post_emojis + server-side validation (idempotent)

-- 1) Whitelist of valid exclusive emoji ids (read-only for clients)
create table if not exists public.mada_exclusive_emojis (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,28}$'),
  active boolean not null default true
);
alter table public.mada_exclusive_emojis enable row level security;
revoke all on public.mada_exclusive_emojis from anon, authenticated;
grant select on public.mada_exclusive_emojis to authenticated;
drop policy if exists mx_whitelist_read on public.mada_exclusive_emojis;
create policy mx_whitelist_read on public.mada_exclusive_emojis for select to authenticated using (true);
insert into public.mada_exclusive_emojis (id) values
  ('logo_01'),
  ('logo_02'),
  ('ny_02'),
  ('cd_01'),
  ('fire_02'),
  ('rocket_02'),
  ('heart_02'),
  ('star_02'),
  ('trophy_02'),
  ('crown_02'),
  ('gem_02'),
  ('party_02'),
  ('pop_02'),
  ('ny_03'),
  ('zap_01'),
  ('ram_02'),
  ('bell_02'),
  ('cup_02'),
  ('beat_02'),
  ('game_02'),
  ('gold_02'),
  ('idea_01'),
  ('morning_02'),
  ('morning_03'),
  ('ph_tut_01'),
  ('ph_pyr_01'),
  ('ph_ankh_01'),
  ('ph_eye_01'),
  ('ph_scar_01'),
  ('ph_obel_01'),
  ('ph_cart_01'),
  ('ph_sun_01'),
  ('laugh_01'),
  ('love_01'),
  ('sad_01'),
  ('angry_01'),
  ('shock_01'),
  ('shy_01'),
  ('sleep_01'),
  ('think_01'),
  ('pop_01'),
  ('clap_01'),
  ('fire_01'),
  ('heart_01'),
  ('thanks_01'),
  ('hello_01'),
  ('bravo_01'),
  ('love_02'),
  ('chime_01'),
  ('morning_01'),
  ('party_01'),
  ('wink_01'),
  ('win_01'),
  ('lose_01'),
  ('rage_01'),
  ('beat_01'),
  ('game_01'),
  ('cool_01'),
  ('trophy_01'),
  ('crown_01'),
  ('star_01'),
  ('gem_01'),
  ('rocket_01'),
  ('gold_01'),
  ('bell_01'),
  ('ram_01'),
  ('cup_01'),
  ('snow_01'),
  ('ny_01')
on conflict (id) do nothing;

-- 2) Ledger of emoji granted per content item (post_id = id of the post / comment / message)
create table if not exists public.post_emojis (
  post_id uuid not null,
  kind text not null default 'post' check (kind in ('post','comment','message')),
  emoji_id text not null references public.mada_exclusive_emojis(id),
  granted_at timestamptz not null default now(),
  primary key (kind, post_id, emoji_id)
);
alter table public.post_emojis enable row level security;
revoke all on public.post_emojis from anon, authenticated;
grant select on public.post_emojis to authenticated;
drop policy if exists post_emojis_read on public.post_emojis;
create policy post_emojis_read on public.post_emojis for select to authenticated using (kind in ('post','comment'));

-- 3) Server-authoritative emoji ids on (E2E encrypted) messages
alter table public.messages add column if not exists mx_ids text[] not null default '{}';
alter table public.messages drop constraint if exists messages_mx_ids_max;
alter table public.messages add constraint messages_mx_ids_max check (cardinality(mx_ids) <= 40);

-- 4) Helpers / triggers
create or replace function public.mada_mx_is_verified(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_uid
    and (coalesce(p.verified_badge,false) or coalesce(p.official_badge,false) or coalesce(p.is_official,false) or p.verification_type is not null));
$$;

-- posts / comments: unverified (or invalid id) -> plain text ":id:"; already-granted ids survive edits
create or replace function public.mada_mx_sanitize() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text := tg_argv[0]; v_ok boolean; v_id text; v_keep boolean;
begin
  if new.body is null or position('{{mx:' in new.body) = 0 then return new; end if;
  v_ok := public.mada_mx_is_verified((to_jsonb(new)->>tg_argv[1])::uuid);
  for v_id in select distinct m[1] from regexp_matches(new.body, '\{\{mx:([^}]{0,60})\}\}', 'g') m loop
    v_keep := false;
    if v_id ~ '^[a-z][a-z0-9_]{1,28}$'
       and exists (select 1 from public.mada_exclusive_emojis e where e.id = v_id and e.active) then
      if v_ok then v_keep := true;
      elsif tg_op = 'UPDATE' and exists (select 1 from public.post_emojis pe where pe.kind = v_kind and pe.post_id = new.id and pe.emoji_id = v_id) then v_keep := true;
      end if;
    end if;
    if not v_keep then new.body := replace(new.body, '{{mx:' || v_id || '}}', ':' || v_id || ':'); end if;
  end loop;
  return new;
end $$;

-- messages: body is ciphertext, so the sender declares ids in mx_ids and the server validates them
create or replace function public.mada_mx_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.mx_ids := old.mx_ids; return new; end if;
  new.mx_ids := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(new.mx_ids, '{}')) x), '{}');
  if cardinality(new.mx_ids) = 0 then return new; end if;
  if cardinality(new.mx_ids) > 40 then raise exception 'mx_too_many' using errcode = '22023'; end if;
  if not public.mada_mx_is_verified(new.sender_id) then
    raise exception 'premium_emoji_requires_verification' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(new.mx_ids) x where not exists (select 1 from public.mada_exclusive_emojis e where e.id = x and e.active)) then
    raise exception 'mx_invalid_id' using errcode = '22023';
  end if;
  return new;
end $$;

-- record what was granted (only this function writes post_emojis)
create or replace function public.mada_mx_record() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_argv[0] = 'message' then
    insert into public.post_emojis (post_id, kind, emoji_id)
      select new.id, 'message', x from unnest(new.mx_ids) x on conflict do nothing;
  elsif new.body is not null and position('{{mx:' in new.body) > 0 then
    insert into public.post_emojis (post_id, kind, emoji_id)
      select distinct new.id, tg_argv[0], m[1]
      from regexp_matches(new.body, '\{\{mx:([a-z][a-z0-9_]{1,28})\}\}', 'g') m
      join public.mada_exclusive_emojis e on e.id = m[1] and e.active
      on conflict do nothing;
  end if;
  return null;
end $$;

create or replace function public.mada_mx_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.post_emojis where kind = tg_argv[0] and post_id = old.id;
  return null;
end $$;

revoke all on function public.mada_mx_is_verified(uuid), public.mada_mx_sanitize(), public.mada_mx_messages(),
  public.mada_mx_record(), public.mada_mx_cleanup() from public, anon, authenticated;

drop trigger if exists mada_mx_sanitize_posts on public.posts;
create trigger mada_mx_sanitize_posts before insert or update of body on public.posts
  for each row execute function public.mada_mx_sanitize('post','author_id');
drop trigger if exists mada_mx_sanitize_comments on public.comments;
create trigger mada_mx_sanitize_comments before insert or update of body on public.comments
  for each row execute function public.mada_mx_sanitize('comment','author_id');
drop trigger if exists mada_mx_messages_trg on public.messages;
create trigger mada_mx_messages_trg before insert or update of mx_ids on public.messages
  for each row execute function public.mada_mx_messages();

drop trigger if exists mada_mx_record_posts on public.posts;
create trigger mada_mx_record_posts after insert or update of body on public.posts
  for each row execute function public.mada_mx_record('post');
drop trigger if exists mada_mx_record_comments on public.comments;
create trigger mada_mx_record_comments after insert or update of body on public.comments
  for each row execute function public.mada_mx_record('comment');
drop trigger if exists mada_mx_record_messages on public.messages;
create trigger mada_mx_record_messages after insert on public.messages
  for each row execute function public.mada_mx_record('message');

drop trigger if exists mada_mx_cleanup_posts on public.posts;
create trigger mada_mx_cleanup_posts after delete on public.posts for each row execute function public.mada_mx_cleanup('post');
drop trigger if exists mada_mx_cleanup_comments on public.comments;
create trigger mada_mx_cleanup_comments after delete on public.comments for each row execute function public.mada_mx_cleanup('comment');
drop trigger if exists mada_mx_cleanup_messages on public.messages;
create trigger mada_mx_cleanup_messages after delete on public.messages for each row execute function public.mada_mx_cleanup('message');
