begin;

create schema pong84_private;
revoke all on schema pong84_private from public, anon, authenticated;

create table pong84_private.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  player_id text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  name text not null,
  last_device_id text,
  constraint profile_name_valid check (char_length(name) between 1 and 16 and name !~ '[[:cntrl:]]')
);
create unique index profiles_unique_name on pong84_private.profiles (lower(normalize(name, NFKC)));

create table pong84_private.scores (
  user_id uuid primary key references pong84_private.profiles (user_id) on delete cascade,
  hell21_wins integer not null default 0,
  hard21_wins integer not null default 0,
  hell21_points integer not null default 0,
  hard21_points integer not null default 0,
  timer_30_wins integer not null default 0,
  timer_60_wins integer not null default 0,
  timer_120_wins integer not null default 0,
  timer_30_score bigint not null default 0,
  timer_60_score bigint not null default 0,
  timer_120_score bigint not null default 0,
  play_ms bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  check (least(hell21_wins, hard21_wins, hell21_points, hard21_points,
               timer_30_wins, timer_60_wins, timer_120_wins,
               timer_30_score, timer_60_score, timer_120_score, play_ms) >= 0)
);

create table pong84_private.matches (
  user_id uuid primary key references pong84_private.profiles (user_id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  mode text not null check (mode in ('hell21', 'hard21', 'timer30', 'timer60', 'timer120')),
  multiplier integer not null check (multiplier in (1, 3)),
  device_id text not null,
  started_at timestamptz not null default clock_timestamp(),
  finished boolean not null default false
);

create table pong84_private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table pong84_private.bans (
  kind text not null check (kind in ('account', 'device', 'ip')),
  key text not null,
  reason text not null,
  expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (kind, key)
);

alter table pong84_private.profiles enable row level security;
alter table pong84_private.scores enable row level security;
alter table pong84_private.matches enable row level security;
alter table pong84_private.admins enable row level security;
alter table pong84_private.bans enable row level security;
revoke all on all tables in schema pong84_private from public, anon, authenticated;

-- Legacy rows stay in their original table. Copy moderation restrictions before retiring the old API.
do $$
begin
  if to_regclass('public.bans') is not null then
    execute $import$
      insert into pong84_private.bans(kind, key, reason, expires_at, created_at)
      select distinct on (kind, key) kind, key, reason, expires_at, created_at
      from (
        select targets.kind, targets.key, coalesce(b.row->>'reason', '违规行为') as reason,
               (b.row->>'expires_at')::timestamptz as expires_at,
               coalesce((b.row->>'created_at')::timestamptz, clock_timestamp()) as created_at
        from (select to_jsonb(old) as row from public.bans old) b
        cross join lateral (values ('device', b.row->>'device_id'), ('ip', b.row->>'ip_address')) targets(kind, key)
        where nullif(targets.key, '') is not null
      ) records order by kind, key, created_at desc
    $import$;
  end if;
end
$$;

create function pong84_private.is_banned(p_player text, p_device text)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from pong84_private.bans b
    where ((b.kind = 'account' and b.key = p_player) or (b.kind = 'device' and b.key = p_device))
      and (b.expires_at is null or b.expires_at > statement_timestamp())
  );
$$;

create function public.pong84_save_nickname(p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean text := btrim(normalize(p_name, NFKC));
  profile pong84_private.profiles;
begin
  if uid is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'login_required' using errcode = '42501';
  end if;
  if clean is null or char_length(clean) not between 1 and 16 or clean = '匿名'
     or clean ~ '[[:cntrl:]]' or translate(clean, U&'\061C\200B\200C\200D\200E\200F\202A\202B\202C\202D\202E\2066\2067\2068\2069\FEFF', '') <> clean then
    raise exception 'invalid_nickname' using errcode = '22023';
  end if;
  insert into pong84_private.profiles (user_id, name) values (uid, clean)
  on conflict (user_id) do update set name = excluded.name
  returning * into profile;
  return jsonb_build_object('player_id', profile.player_id, 'name', profile.name);
end;
$$;

create function public.pong84_begin_match(p_mode text, p_control text, p_device_id text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  profile pong84_private.profiles;
  match_id uuid;
begin
  if uid is null then raise exception 'login_required' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('hell21', 'hard21', 'timer30', 'timer60', 'timer120')
     or p_control is null or p_control not in ('buttons', 'follow')
     or p_device_id is null or p_device_id !~ '^D[0-9A-F]{14,15}$' then
    raise exception 'invalid_match' using errcode = '22023';
  end if;
  select * into profile from pong84_private.profiles where user_id = uid for update;
  if not found then raise exception 'nickname_required' using errcode = '42501'; end if;
  if pong84_private.is_banned(profile.player_id, p_device_id) or
     pong84_private.is_banned(profile.player_id, profile.last_device_id) then
    raise exception 'ranked_banned' using errcode = '42501';
  end if;
  insert into pong84_private.matches (user_id, mode, multiplier, device_id)
  values (uid, p_mode, case p_control when 'buttons' then 3 else 1 end, p_device_id)
  on conflict (user_id) do update set id = excluded.id, mode = excluded.mode,
    multiplier = excluded.multiplier, device_id = excluded.device_id,
    started_at = excluded.started_at, finished = false
  where matches.started_at <= clock_timestamp() - interval '2 seconds'
  returning id into match_id;
  if match_id is null then raise exception 'match_start_rate_limited' using errcode = '22023'; end if;
  update pong84_private.profiles set last_device_id = p_device_id where user_id = uid;
  return match_id;
end;
$$;

create function public.pong84_finish_match(p_match_id uuid, p_player integer, p_opponent integer, p_active_ms integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  profile pong84_private.profiles;
  match pong84_private.matches;
  elapsed_ms bigint;
  seconds integer;
  won integer;
  highest integer;
begin
  if uid is null then raise exception 'login_required' using errcode = '42501'; end if;
  select * into profile from pong84_private.profiles where user_id = uid for update;
  select * into match from pong84_private.matches where user_id = uid and id = p_match_id for update;
  if not found then raise exception 'match_unavailable' using errcode = '22023'; end if;
  if match.finished then return; end if;
  if pong84_private.is_banned(profile.player_id, match.device_id) then
    raise exception 'ranked_banned' using errcode = '42501';
  end if;
  elapsed_ms := extract(epoch from (clock_timestamp() - match.started_at)) * 1000;
  if elapsed_ms > 14400000 or p_active_ms is null or p_active_ms not between 1 and 1200000 or p_active_ms > elapsed_ms + 1500
     or p_player is null or p_opponent is null or least(p_player, p_opponent) < 0 then
    raise exception 'invalid_match_result' using errcode = '22023';
  end if;

  highest := greatest(p_player, p_opponent);
  won := (p_player > p_opponent)::integer;
  if match.mode in ('hell21', 'hard21') then
    if highest not between 21 and 25 or p_player = p_opponent
       or (highest < 25 and abs(p_player - p_opponent) < 2)
       or p_active_ms < (p_player + p_opponent) * 800 then
      raise exception 'invalid_match_result' using errcode = '22023';
    end if;
  else
    seconds := substr(match.mode, 6)::integer;
    if elapsed_ms < seconds * 1000 or p_active_ms not between seconds * 750 and seconds * 1050
       or highest > seconds * 4 / 3 then
      raise exception 'invalid_match_result' using errcode = '22023';
    end if;
  end if;

  insert into pong84_private.scores (user_id, play_ms,
      hell21_wins, hard21_wins, hell21_points, hard21_points,
      timer_30_wins, timer_60_wins, timer_120_wins, timer_30_score, timer_60_score, timer_120_score)
  values (uid, p_active_ms,
      case when match.mode = 'hell21' then won else 0 end,
      case when match.mode = 'hard21' then won else 0 end,
      case when match.mode = 'hell21' then won * 3 * match.multiplier else 0 end,
      case when match.mode = 'hard21' then won * 2 * match.multiplier else 0 end,
      case when seconds = 30 then won else 0 end,
      case when seconds = 60 then won else 0 end,
      case when seconds = 120 then won else 0 end,
      case when seconds = 30 then p_player * match.multiplier * won else 0 end,
      case when seconds = 60 then p_player * match.multiplier * won else 0 end,
      case when seconds = 120 then p_player * match.multiplier * won else 0 end)
  on conflict (user_id) do update set
    play_ms = scores.play_ms + excluded.play_ms,
    hell21_wins = scores.hell21_wins + excluded.hell21_wins,
    hard21_wins = scores.hard21_wins + excluded.hard21_wins,
    hell21_points = scores.hell21_points + excluded.hell21_points,
    hard21_points = scores.hard21_points + excluded.hard21_points,
    timer_30_wins = scores.timer_30_wins + excluded.timer_30_wins,
    timer_60_wins = scores.timer_60_wins + excluded.timer_60_wins,
    timer_120_wins = scores.timer_120_wins + excluded.timer_120_wins,
    timer_30_score = scores.timer_30_score + excluded.timer_30_score,
    timer_60_score = scores.timer_60_score + excluded.timer_60_score,
    timer_120_score = scores.timer_120_score + excluded.timer_120_score,
    updated_at = clock_timestamp();
  update pong84_private.matches set finished = true where user_id = uid;
end;
$$;

create function public.pong84_board()
returns jsonb language sql stable security definer set search_path = ''
as $$
  with visible as (
    select p.player_id, p.name, s.hell21_wins, s.hard21_wins, s.hell21_points, s.hard21_points,
           s.timer_30_score, s.timer_60_score, s.timer_120_score, s.play_ms, s.updated_at
    from pong84_private.scores s join pong84_private.profiles p using (user_id)
    where not pong84_private.is_banned(p.player_id, p.last_device_id)
  ), ranked as (
    select v.*,
      row_number() over (
        order by hell21_points::bigint + hard21_points desc,
                 timer_30_score + timer_60_score + timer_120_score desc, updated_at, player_id
      ) as win_rank,
      row_number() over (
        order by play_ms desc, hell21_points::bigint + hard21_points desc, updated_at, player_id
      ) as time_rank
    from visible v
  ), profile as (
    select p.player_id, p.name, p.last_device_id
    from pong84_private.profiles p where p.user_id = auth.uid()
  )
  select jsonb_build_object(
    'wins', coalesce((select jsonb_agg(to_jsonb(r) - array['win_rank', 'time_rank', 'updated_at'] order by win_rank)
                      from ranked r where win_rank <= 20), '[]'::jsonb),
    'time', coalesce((select jsonb_agg(to_jsonb(r) - array['win_rank', 'time_rank', 'updated_at'] order by time_rank)
                      from ranked r where time_rank <= 20), '[]'::jsonb),
    'count', (select count(*) from ranked),
    'rank', (select win_rank from ranked join profile using (player_id)),
    'mine', (select to_jsonb(s) - array['user_id', 'updated_at'] from pong84_private.scores s where s.user_id = auth.uid()),
    'profile', (select to_jsonb(p) - 'last_device_id' from profile p),
    'banned', coalesce((select pong84_private.is_banned(p.player_id, p.last_device_id) from profile p), false)
  );
$$;

create function public.pong84_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb := '{}'::jsonb;
  legacy jsonb := '[]'::jsonb;
  ban_kind text := p_args->>'kind';
  reason text := left(coalesce(nullif(btrim(p_args->>'reason'), ''), '数据异常'), 200);
  expiration timestamptz;
  restriction jsonb;
  targets text[];
  player text := p_args->>'player_id';
  uid uuid;
  nickname text := btrim(normalize(p_args->>'name', NFKC));
begin
  if not exists (select 1 from pong84_private.admins a where a.user_id = auth.uid()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  case p_action
    when 'check' then
      return '{}'::jsonb;
    when 'snapshot' then
      if to_regclass('public.leaderboard') is not null then
        execute $sql$
          select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('legacy', true)), '[]'::jsonb)
          from public.leaderboard l
          where not exists (select 1 from pong84_private.profiles p where p.player_id = l.player_id::text)
        $sql$ into legacy;
      end if;
      select jsonb_build_object(
        'players', legacy || coalesce((
          select jsonb_agg((to_jsonb(s) - 'user_id') || jsonb_build_object(
              'player_id', p.player_id, 'name', p.name, 'device_id', p.last_device_id))
          from pong84_private.scores s join pong84_private.profiles p using (user_id)
        ), '[]'::jsonb),
        'bans', coalesce((select jsonb_agg(to_jsonb(b)) from pong84_private.bans b), '[]'::jsonb)
      ) into result;
    when 'moderate', 'bulk_ban', 'bulk_unban' then
      if jsonb_typeof(p_args->'restrictions') is distinct from 'array'
         or jsonb_array_length(p_args->'restrictions') > 10000 then
        raise exception 'invalid_targets' using errcode = '22023';
      end if;
      for restriction in select value from jsonb_array_elements(p_args->'restrictions') loop
        perform public.pong84_admin(
          case p_action when 'bulk_unban' then 'unban' else 'ban' end,
          case when restriction ? 'keys' then restriction
               else restriction || jsonb_build_object('keys', jsonb_build_array(restriction->>'key')) end
        );
      end loop;
      if p_action = 'moderate' then
        perform public.pong84_admin('delete', p_args);
      end if;
    when 'ban', 'unban', 'delete' then
      select array_agg(value) into targets from jsonb_array_elements_text(p_args->'keys');
      if coalesce(cardinality(targets), 0) = 0 or cardinality(targets) > 10000
         or exists (select 1 from unnest(targets) item where item is null or char_length(item) not between 1 and 100) then
        raise exception 'invalid_targets' using errcode = '22023';
      end if;
      if p_action = 'delete' then
        perform 1 from pong84_private.profiles p where p.player_id = any(targets) order by p.user_id for update;
        delete from pong84_private.matches m using pong84_private.profiles p
        where m.user_id = p.user_id and p.player_id = any(targets);
        delete from pong84_private.scores s using pong84_private.profiles p
        where s.user_id = p.user_id and p.player_id = any(targets);
        if to_regclass('public.leaderboard') is not null then
          execute 'delete from public.leaderboard where player_id::text = any($1)' using targets;
        end if;
      elsif ban_kind is null or ban_kind not in ('account', 'device', 'ip') then
        raise exception 'invalid_ban_kind' using errcode = '22023';
      elsif p_action = 'ban' then
        expiration := (p_args->>'expires_at')::timestamptz;
        insert into pong84_private.bans as b (kind, key, reason, expires_at)
        select distinct ban_kind, target, reason, expiration from unnest(targets) as target
        on conflict on constraint bans_pkey do update set
          reason = excluded.reason, expires_at = excluded.expires_at, created_at = excluded.created_at;
      else
        delete from pong84_private.bans b where b.kind = (p_args->>'kind') and b.key = any(targets);
      end if;
    when 'clear' then
      perform 1 from pong84_private.profiles p order by p.user_id for update;
      delete from pong84_private.matches;
      delete from pong84_private.scores;
      if to_regclass('public.leaderboard') is not null then
        execute 'delete from public.leaderboard';
      end if;
    when 'save' then
      if player is null or player !~ '^[A-Z0-9]{12}$' then
        raise exception 'invalid_player_id' using errcode = '22023';
      end if;
      select p.user_id into uid from pong84_private.profiles p where p.player_id = player for update;
      if found then
        update pong84_private.profiles set name = nickname where user_id = uid;
        insert into pong84_private.scores as s (
          user_id, hell21_wins, hard21_wins, hell21_points, hard21_points,
          timer_30_wins, timer_60_wins, timer_120_wins, timer_30_score, timer_60_score, timer_120_score, play_ms
        )
        select uid, fields.hell21_wins, fields.hard21_wins, fields.hell21_points, fields.hard21_points,
          fields.timer_30_wins, fields.timer_60_wins, fields.timer_120_wins, fields.timer_30_score,
          fields.timer_60_score, fields.timer_120_score, fields.play_ms
        from jsonb_populate_record(null::pong84_private.scores, p_args) fields
        on conflict (user_id) do update set
          hell21_wins = excluded.hell21_wins, hard21_wins = excluded.hard21_wins,
          hell21_points = excluded.hell21_points, hard21_points = excluded.hard21_points,
          timer_30_wins = excluded.timer_30_wins, timer_60_wins = excluded.timer_60_wins,
          timer_120_wins = excluded.timer_120_wins, timer_30_score = excluded.timer_30_score,
          timer_60_score = excluded.timer_60_score, timer_120_score = excluded.timer_120_score,
          play_ms = excluded.play_ms, updated_at = clock_timestamp();
      elsif to_regclass('public.leaderboard') is not null then
        execute $sql$
          insert into public.leaderboard (
            player_id, name, device_id, ip_address, hell21_wins, hard21_wins, hell21_points, hard21_points,
            timer_30_wins, timer_60_wins, timer_120_wins, timer_30_score, timer_60_score, timer_120_score,
            play_ms, updated_at
          )
          select f.player_id, f.name, f.device_id, f.ip_address, f.hell21_wins, f.hard21_wins,
            f.hell21_points, f.hard21_points, f.timer_30_wins, f.timer_60_wins, f.timer_120_wins,
            f.timer_30_score, f.timer_60_score, f.timer_120_score, f.play_ms, clock_timestamp()
          from jsonb_populate_record(null::public.leaderboard, $1) f
          on conflict (player_id) do update set
            name = excluded.name, device_id = excluded.device_id, ip_address = excluded.ip_address,
            hell21_wins = excluded.hell21_wins, hard21_wins = excluded.hard21_wins,
            hell21_points = excluded.hell21_points, hard21_points = excluded.hard21_points,
            timer_30_wins = excluded.timer_30_wins, timer_60_wins = excluded.timer_60_wins,
            timer_120_wins = excluded.timer_120_wins, timer_30_score = excluded.timer_30_score,
            timer_60_score = excluded.timer_60_score, timer_120_score = excluded.timer_120_score,
            play_ms = excluded.play_ms, updated_at = excluded.updated_at
        $sql$ using p_args;
      else
        raise exception 'player_unavailable' using errcode = '22023';
      end if;
    else
      raise exception 'invalid_admin_action' using errcode = '22023';
  end case;
  return result;
end;
$$;

-- Revoke both the table grants and any column grants inherited from the old Data API setup.
do $$
declare
  target regclass;
  columns text;
  fn regprocedure;
begin
  for target in select unnest(array[to_regclass('public.leaderboard'), to_regclass('public.bans')]) loop
    if target is null then continue; end if;
    execute format('alter table %s enable row level security', target);
    execute format('revoke all on table %s from public, anon, authenticated', target);
    select string_agg(format('%I', attname), ', ') into columns from pg_attribute
      where attrelid = target and attnum > 0 and not attisdropped;
    execute format('revoke all (%s) on table %s from public, anon, authenticated', columns, target);
  end loop;
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'submit_score', 'admin_check', 'admin_get_bans', 'admin_ban_device', 'admin_ban_ip', 'admin_unban',
      'admin_batch_ban_devices', 'admin_batch_ban_ips', 'admin_batch_unban',
      'admin_delete_player', 'admin_batch_delete_players', 'admin_clear_leaderboard', 'admin_upsert_player'
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;

revoke all on function pong84_private.is_banned(text, text) from public, anon, authenticated;
revoke all on function public.pong84_board() from public, anon, authenticated;
revoke all on function public.pong84_save_nickname(text) from public, anon, authenticated;
revoke all on function public.pong84_begin_match(text, text, text) from public, anon, authenticated;
revoke all on function public.pong84_finish_match(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.pong84_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.pong84_board() to anon, authenticated;
grant execute on function public.pong84_save_nickname(text) to authenticated;
grant execute on function public.pong84_begin_match(text, text, text) to authenticated;
grant execute on function public.pong84_finish_match(uuid, integer, integer, integer) to authenticated;
grant execute on function public.pong84_admin(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
