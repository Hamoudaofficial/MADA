-- MADA exclusive emoji: server-side enforcement. Assumes uuid ids and profiles.verified_badge/official_badge/is_official/verification_type.

-- whitelist
create or replace function public.mx_emoji_ids() returns text[]
language sql immutable as $$ select array[
    'laugh_01','love_01','sad_01','angry_01','shock_01','shy_01',
    'sleep_01','think_01','like_01','clap_01','fire_01','heart_01',
    'thanks_01','hello_01','bravo_01','tislam_01','mashallah_01','morning_01',
    'congrats_01','wink_01','win_01','lose_01','rage_01','headset_01',
    'gamepad_01','pro_01','cup_01','crown_01','glowstar_01','diamond_01',
    'rocket_01','golden_01','eid_01','ramadan_01','worldcup_01','winter_01',
    'newyear_01','logo_01','logodark_01','party2027_01','gold2027_01','fire_02',
    'rocket_02','heart_02','star_01','trophy_01','crown_02','gem_01',
    'gift_01','balloon_01','fireworks_01','bolt_01','crescent_01','lantern_01',
    'football_01','headphones_01','gamepad_02','coin_01','idea_01','flower_01',
    'sun_01','tut_01','pyramid_01','ankh_01','horus_01','scarab_01',
    'obelisk_01','cartouche_01','wingedsun_01'
]::text[] $$;

-- single source of truth for "verified" (edit here if expiry uses another column, e.g. verified_until)
create or replace function public.mx_is_verified(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(verified_badge,false) or coalesce(official_badge,false) or coalesce(is_official,false) or coalesce(verification_type::text,'') <> ''
                   from public.profiles where id = p_user), false)
$$;

-- grants table (content id = post / comment / message id)
create table if not exists public.post_emojis (
  post_id    uuid        not null,
  emoji_id   text        not null check (emoji_id = any (public.mx_emoji_ids())),
  granted_at timestamptz not null default now(),
  primary key (post_id, emoji_id)
);
alter table public.post_emojis enable row level security;
drop policy if exists post_emojis_read on public.post_emojis;
create policy post_emojis_read on public.post_emojis for select to anon, authenticated using (true);
revoke all on public.post_emojis from anon, authenticated;
grant select on public.post_emojis to anon, authenticated;

-- messages are E2E encrypted: client declares used ids, trigger validates and clears the column
alter table public.messages add column if not exists emoji_ids text[];

-- posts / comments: validate tokens in plain text
create or replace function public.mx_filter_text(p_body text, p_id uuid, p_author uuid) returns text
language plpgsql security definer set search_path = public as $$
declare ok boolean; m text[]; eid text; keep text[]; res text := p_body;
begin
  if p_body is null or position('{{mx:' in p_body) = 0 then return p_body; end if;
  ok := public.mx_is_verified(p_author);
  select coalesce(array_agg(emoji_id), '{}') into keep from public.post_emojis where post_id = p_id;
  for m in select regexp_matches(p_body, '\{\{mx:([a-z][a-z0-9_]{2,23})\}\}', 'g') loop
    eid := m[1];
    if eid = any (public.mx_emoji_ids()) and (ok or eid = any (keep)) then
      insert into public.post_emojis (post_id, emoji_id) values (p_id, eid) on conflict do nothing;
    else
      res := replace(res, '{{mx:' || eid || '}}', ':' || eid || ':');
    end if;
  end loop;
  return res;
end $$;

create or replace function public.mx_trg_posts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.id is null then NEW.id := gen_random_uuid(); end if;
  NEW.body := public.mx_filter_text(NEW.body, NEW.id, coalesce(auth.uid(), NEW.author_id));
  return NEW;
end $$;

create or replace function public.mx_trg_comments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.id is null then NEW.id := gen_random_uuid(); end if;
  NEW.body := public.mx_filter_text(NEW.body, NEW.id, coalesce(auth.uid(), NEW.author_id));
  return NEW;
end $$;

create or replace function public.mx_trg_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare eid text;
begin
  if NEW.id is null then NEW.id := gen_random_uuid(); end if;
  if NEW.emoji_ids is not null then
    if public.mx_is_verified(coalesce(auth.uid(), NEW.sender_id)) then
      for eid in select distinct x from unnest(NEW.emoji_ids) as x limit 20 loop
        if eid = any (public.mx_emoji_ids()) then
          insert into public.post_emojis (post_id, emoji_id) values (NEW.id, eid) on conflict do nothing;
        end if;
      end loop;
    end if;
    NEW.emoji_ids := null;
  end if;
  return NEW;
end $$;

-- rate limit (per user, last 60s)
create or replace function public.mx_trg_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; lim int;
begin
  if auth.uid() is null then return NEW; end if;
  if TG_TABLE_NAME = 'posts' then
    select count(*) into n from public.posts where author_id = NEW.author_id and created_at > now() - interval '1 minute'; lim := 10;
  elsif TG_TABLE_NAME = 'comments' then
    select count(*) into n from public.comments where author_id = NEW.author_id and created_at > now() - interval '1 minute'; lim := 20;
  else
    select count(*) into n from public.messages where sender_id = NEW.sender_id and created_at > now() - interval '1 minute'; lim := 30;
  end if;
  if n >= lim then raise exception 'rate_limited'; end if;
  return NEW;
end $$;

revoke all on function public.mx_filter_text(text, uuid, uuid), public.mx_is_verified(uuid),
  public.mx_trg_posts(), public.mx_trg_comments(), public.mx_trg_messages(), public.mx_trg_rate()
  from public, anon, authenticated;

drop trigger if exists mx_1_rate on public.posts;
create trigger mx_1_rate before insert on public.posts for each row execute function public.mx_trg_rate();
drop trigger if exists mx_2_filter on public.posts;
create trigger mx_2_filter before insert or update of body on public.posts for each row execute function public.mx_trg_posts();

drop trigger if exists mx_1_rate on public.comments;
create trigger mx_1_rate before insert on public.comments for each row execute function public.mx_trg_rate();
drop trigger if exists mx_2_filter on public.comments;
create trigger mx_2_filter before insert or update of body on public.comments for each row execute function public.mx_trg_comments();

drop trigger if exists mx_1_rate on public.messages;
create trigger mx_1_rate before insert on public.messages for each row execute function public.mx_trg_rate();
drop trigger if exists mx_2_filter on public.messages;
create trigger mx_2_filter before insert on public.messages for each row execute function public.mx_trg_messages();
