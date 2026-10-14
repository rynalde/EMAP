-- Aprovação de cadastros e painel /admin do itaqui-digital
-- Servidor: Supabase self-hosted em https://emap.rynalde.com (GoTrue v2.196, Postgres 17)
--
-- Todo cadastro novo ganha um profile 'pendente' e só entra no app depois que
-- um admin aprova. O app usa apenas a chave publicável, então toda escrita
-- administrativa passa pelas funções security definer abaixo, que conferem se
-- quem chama é admin. Os clientes só leem (RLS); não há policy de escrita.
--
-- O primeiro admin é promovido à mão, depois do cadastro:
--   update public.profiles set role = 'admin', status = 'aprovado' where email = '<e-mail>';
--
-- Idempotente. Não mexe no schema do periplus.

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
-- create type não tem "if not exists".
do $$
begin
  create type public.app_role as enum ('admin', 'gestor', 'operador', 'visualizador');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.account_status as enum ('pendente', 'aprovado', 'rejeitado', 'bloqueado');
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'visualizador',
  status public.account_status not null default 'pendente',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

-- Linha única: a chave booleana com check (id) impede uma segunda linha.
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  signup_enabled boolean not null default true,
  approval_required boolean not null default true,
  default_role public.app_role not null default 'visualizador',
  -- Minúsculas e sem "@" (ex.: 'emap.ma.gov.br'); admin_update_settings normaliza.
  auto_approve_domains text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- is_admin / signup_open
-- ---------------------------------------------------------------------------
-- security definer: lê profiles sem passar pelo RLS, o que evita recursão
-- quando a própria policy de profiles chama esta função.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.status = 'aprovado'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- A tela de cadastro pergunta antes de chamar o signUp; app_settings em si não
-- é legível por anon.
create or replace function public.signup_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select s.signup_enabled from public.app_settings s where s.id;
$$;

revoke execute on function public.signup_open() from public;
grant execute on function public.signup_open() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profile automático para cada usuário novo
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.app_settings;
begin
  select * into v_settings from public.app_settings s where s.id;

  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    -- email só é nulo em login por telefone ou anônimo, ambos desligados.
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'full_name',
    v_settings.default_role,
    case
      when not v_settings.approval_required
        or lower(split_part(new.email, '@', -1)) = any (v_settings.auto_approve_domains)
        then 'aprovado'::public.account_status
      else 'pendente'::public.account_status
    end
  );

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- "create or replace" em vez de drop + create: drop trigger exige ser dono de
-- auth.users (supabase_auth_admin), e o postgres só tem o privilégio TRIGGER.
create or replace trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Usuários criados antes desta migration entram como pendentes.
insert into public.profiles (id, email, full_name)
select u.id, coalesce(u.email, ''), u.raw_user_meta_data ->> 'full_name'
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Hook before-user-created do GoTrue: cadastro aberto/fechado
-- ---------------------------------------------------------------------------
-- Ligado no servidor por GOTRUE_HOOK_BEFORE_USER_CREATED_URI=
-- pg-functions://postgres/public/hook_before_user_created. Assim o "cadastro
-- fechado" do /admin vale também para quem chama a API do Auth direto.
--
-- O GoTrue chama o hook antes de criar qualquer usuário novo: /signup,
-- convites (/invite e generate_link), OAuth/SSO e login anônimo. O evento
-- ({metadata: {uuid, time, name, ip_address}, user: {...}}) é igual para
-- cadastro e convite, então não há como liberar só convites: com o cadastro
-- fechado, convidar pelo Studio também falha. "Add user > Create new user" do
-- Studio (POST /admin/users) não passa pelo hook e continua funcionando.
--
-- Erro no formato dos hooks: {"error": {"http_code", "message"}}; o GoTrue
-- devolve esse status e essa mensagem ao cliente. security definer, então
-- supabase_auth_admin só precisa de execute (nada em app_settings).
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select s.signup_enabled from public.app_settings s where s.id) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Os cadastros estão fechados no momento.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant usage on schema public to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Funções do painel /admin
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  status public.account_status,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewer_email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Colunas sempre qualificadas: os nomes do "returns table" viram variáveis.
  return query
  select
    p.id,
    p.email,
    p.full_name,
    p.role,
    p.status,
    p.created_at,
    p.reviewed_at,
    r.email::text,
    u.email_confirmed_at,
    u.last_sign_in_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join auth.users r on r.id = p.reviewed_by
  order by p.status = 'pendente' desc, p.created_at desc;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_update_user(
  target uuid,
  new_status public.account_status default null,
  new_role public.app_role default null
)
returns table (
  email text,
  full_name text,
  previous_status public.account_status,
  status public.account_status,
  role public.app_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.account_status;
begin
  -- Serializa as alterações: dois admins rebaixando um ao outro ao mesmo tempo
  -- não podem zerar os administradores. is_admin() é conferido depois da
  -- trava, já com o que a outra transação gravou.
  perform pg_advisory_xact_lock(hashtext('public.admin_update_user'));

  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.status into v_previous from public.profiles p where p.id = target;
  if not found then
    raise exception 'Usuário não encontrado.' using errcode = 'P0001';
  end if;

  update public.profiles as p
  set status = coalesce(new_status, p.status),
      role = coalesce(new_role, p.role),
      reviewed_at = case when new_status <> p.status then now() else p.reviewed_at end,
      reviewed_by = case when new_status <> p.status then auth.uid() else p.reviewed_by end
  where p.id = target;

  -- Conferido depois do update para que o último admin, mesmo mirando a si
  -- próprio, receba esta mensagem e não a de baixo.
  if not exists (
    select 1 from public.profiles p where p.role = 'admin' and p.status = 'aprovado'
  ) then
    raise exception 'Não é possível remover o último administrador.' using errcode = 'P0001';
  end if;

  if target = auth.uid() then
    raise exception 'Você não pode alterar a sua própria conta.' using errcode = 'P0001';
  end if;

  -- Derruba as sessões; os refresh tokens caem em cascata
  -- (auth.refresh_tokens.session_id references auth.sessions on delete cascade).
  -- O access token já emitido vale até expirar, mas o app confere o status no
  -- banco a cada requisição.
  if new_status in ('rejeitado', 'bloqueado') then
    delete from auth.sessions s where s.user_id = target;
  end if;

  return query
  select p.email, p.full_name, v_previous, p.status, p.role
  from public.profiles p
  where p.id = target;
end;
$$;

revoke execute on function public.admin_update_user(uuid, public.account_status, public.app_role) from public, anon;
grant execute on function public.admin_update_user(uuid, public.account_status, public.app_role) to authenticated;

create or replace function public.admin_update_settings(
  p_signup_enabled boolean,
  p_approval_required boolean,
  p_default_role public.app_role,
  p_auto_approve_domains text[]
)
returns public.app_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domains text[];
  v_invalid text;
  v_settings public.app_settings;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Com auto-aprovação ou domínio listado, um cadastro novo viraria admin aprovado.
  if p_default_role = 'admin' then
    raise exception 'O papel padrão não pode ser Administrador.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct n.domain order by n.domain), '{}')
  into v_domains
  from (
    select lower(ltrim(btrim(raw), '@')) as domain
    from unnest(p_auto_approve_domains) as raw
  ) n
  where n.domain <> '';

  select d into v_invalid
  from unnest(v_domains) as d
  where d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  limit 1;

  if v_invalid is not null then
    raise exception 'Domínio inválido: %', v_invalid using errcode = 'P0001';
  end if;

  update public.app_settings as s
  set signup_enabled = p_signup_enabled,
      approval_required = p_approval_required,
      default_role = p_default_role,
      auto_approve_domains = v_domains,
      updated_at = now(),
      updated_by = auth.uid()
  where s.id
  returning * into v_settings;

  return v_settings;
end;
$$;

revoke execute on function public.admin_update_settings(boolean, boolean, public.app_role, text[]) from public, anon;
grant execute on function public.admin_update_settings(boolean, boolean, public.app_role, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Exposição
-- ---------------------------------------------------------------------------
-- Os default privileges do Supabase dão ALL em toda tabela nova de public para
-- anon e authenticated; aqui fica só a leitura, filtrada pelo RLS.
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;

-- "(select ...)" faz o Postgres avaliar uma vez por consulta, não por linha.
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "app_settings_select_admin" on public.app_settings;
create policy "app_settings_select_admin" on public.app_settings
for select to authenticated
using ((select public.is_admin()));

-- Recarrega o cache do PostgREST para as RPCs novas aparecerem já (sem efeito se ele já recarregou).
notify pgrst, 'reload schema';
