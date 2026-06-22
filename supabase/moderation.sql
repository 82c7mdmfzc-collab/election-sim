-- Moderation: server-side username profanity guard (Apple Guideline 1.2).
--
-- claim_display_name already lives in the live DB and isn't redefined here, so
-- instead of rewriting it we enforce the same blocklist as src/utils/profanity.ts
-- with an additive BEFORE trigger on profiles.display_name. This catches any path
-- that sets a display name (RPC, direct write) — defense-in-depth behind the
-- client filter. Idempotent: safe to re-apply. Keep ROOTS in sync with the client.

create or replace function public.is_profane_name(p_name text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  norm text;
  root text;
  roots text[] := array[
    'nigger','nigga','faggot','retard','chink','spic','kike','wetback',
    'tranny','coon','dyke','paki','gook',
    'rape','rapist','molest','pedophile','pedo','incest','nazi','hitler',
    'cunt','fuck','shit','bitch','whore','slut','wank','bastard',
    'cock','dick','pussy','penis','vagina','boner','cum','jizz',
    'anus','asshole','dildo','porn','pornhub','sex','tits','titties',
    'bollocks','twat','arsehole'
  ];
begin
  if p_name is null then
    return false;
  end if;
  -- lowercase, fold common leetspeak to letters, strip non-letters
  norm := regexp_replace(
            translate(lower(p_name), '01345789@$!|', 'oieastbgasii'),
            '[^a-z]', '', 'g');
  if norm = '' then
    return false;
  end if;
  foreach root in array roots loop
    if position(root in norm) > 0 then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.reject_profane_display_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.display_name is not null and public.is_profane_name(new.display_name) then
    raise exception 'display_name not allowed'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_profane_display_name on public.profiles;
create trigger trg_reject_profane_display_name
  before insert or update of display_name on public.profiles
  for each row
  execute function public.reject_profane_display_name();
