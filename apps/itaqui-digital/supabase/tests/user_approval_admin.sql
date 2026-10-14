-- Testes da migration 20261014180000_user_approval_admin.sql
--
-- Supõe a migration já aplicada. Roda tudo numa transação desfeita no fim,
-- então não deixa rastro, nem no servidor de produção:
--   psql "$DATABASE_URL" -f supabase/tests/user_approval_admin.sql
-- Qualquer falha para o script com "FALHOU: ..."; no fim: "OK: todos os testes passaram".
--
-- Usuários de teste (uuid fixo, e-mails em .invalid/.example):
--   ...a001 admin1    ...a002 admin2
--   ...b001 pendente  ...b002 subdomínio (não auto-aprovado)
--   ...b003 domínio auto-aprovado      ...b004 aprovado sem exigência, papel padrão operador

\set ON_ERROR_STOP on

begin;

-- Estado conhecido. Admins reais são rebaixados só dentro desta transação, para
-- o teste do último admin.
update public.app_settings
set signup_enabled = true, approval_required = true, default_role = 'visualizador', auto_approve_domains = '{}'
where id;
update public.profiles set role = 'visualizador' where role = 'admin';

-- ---------------------------------------------------------------------------
-- Trigger: pendente, domínio, approval_required, default_role
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at)
values ('00000000-0000-4000-8000-00000000b001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'pendente@itaqui-teste.invalid', '{"full_name":"Pessoa Pendente"}', null);

do $$
declare r public.profiles;
begin
  select * into r from public.profiles where id = '00000000-0000-4000-8000-00000000b001';
  if not found then raise exception 'FALHOU: trigger não criou o profile'; end if;
  if r.status <> 'pendente' or r.role <> 'visualizador'
     or r.email <> 'pendente@itaqui-teste.invalid' or r.full_name is distinct from 'Pessoa Pendente' then
    raise exception 'FALHOU: profile novo veio errado: %', row_to_json(r);
  end if;
end $$;

update public.app_settings set auto_approve_domains = '{porto-teste.example}' where id;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at)
values
  ('00000000-0000-4000-8000-00000000b002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'joao@sub.porto-teste.example', '{"full_name":"João Subdomínio"}', now()),
  ('00000000-0000-4000-8000-00000000b003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'Maria@Porto-Teste.EXAMPLE', '{"full_name":"Maria Domínio"}', now());

do $$
begin
  if (select status from public.profiles where id = '00000000-0000-4000-8000-00000000b003') <> 'aprovado' then
    raise exception 'FALHOU: domínio em auto_approve_domains não foi aprovado automaticamente';
  end if;
  if (select status from public.profiles where id = '00000000-0000-4000-8000-00000000b002') <> 'pendente' then
    raise exception 'FALHOU: subdomínio foi aprovado automaticamente (só o domínio exato deveria)';
  end if;
end $$;

update public.app_settings
set approval_required = false, default_role = 'operador', auto_approve_domains = '{}'
where id;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at)
values ('00000000-0000-4000-8000-00000000b004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'operador@itaqui-teste.invalid', '{"full_name":"Operador Livre"}', now());

do $$
declare r public.profiles;
begin
  select * into r from public.profiles where id = '00000000-0000-4000-8000-00000000b004';
  if r.status <> 'aprovado' then raise exception 'FALHOU: approval_required = false não aprovou'; end if;
  if r.role <> 'operador' then raise exception 'FALHOU: default_role não foi aplicado (veio %)', r.role; end if;
end $$;

update public.app_settings set approval_required = true, default_role = 'visualizador' where id;

-- Admins (promovidos como o README manda) e datas fixas para testar a ordem.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at)
values
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin1@itaqui-teste.invalid', '{"full_name":"Admin Um"}', now()),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin2@itaqui-teste.invalid', '{"full_name":"Admin Dois"}', now());

update public.profiles set role = 'admin', status = 'aprovado'
where id in ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000a002');

update public.profiles p
set created_at = now() - t.age
from (values
  ('00000000-0000-4000-8000-00000000a001'::uuid, interval '10 days'),
  ('00000000-0000-4000-8000-00000000a002'::uuid, interval '9 days'),
  ('00000000-0000-4000-8000-00000000b001'::uuid, interval '5 days'),
  ('00000000-0000-4000-8000-00000000b002'::uuid, interval '1 day'),
  ('00000000-0000-4000-8000-00000000b003'::uuid, interval '4 days'),
  ('00000000-0000-4000-8000-00000000b004'::uuid, interval '3 days')
) as t(id, age)
where p.id = t.id;

-- ---------------------------------------------------------------------------
-- Usuário comum (operador aprovado): só a própria linha, sem app_settings
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b004","role":"authenticated"}';

do $$
declare st text; msg text;
begin
  if (select count(*) from public.profiles) <> 1
     or (select id from public.profiles) <> '00000000-0000-4000-8000-00000000b004' then
    raise exception 'FALHOU: usuário comum vê linhas de profiles além da própria';
  end if;
  if (select count(*) from public.app_settings) <> 0 then
    raise exception 'FALHOU: usuário comum lê app_settings';
  end if;
  if public.is_admin() then
    raise exception 'FALHOU: is_admin() verdadeiro para usuário comum';
  end if;

  st := null;
  begin
    perform public.admin_list_users();
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from '42501' then
    raise exception 'FALHOU: usuário comum chamou admin_list_users (sqlstate %: %)', st, msg;
  end if;

  st := null;
  begin
    perform public.admin_update_user('00000000-0000-4000-8000-00000000b001', 'aprovado');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from '42501' then
    raise exception 'FALHOU: usuário comum chamou admin_update_user (sqlstate %: %)', st, msg;
  end if;

  st := null;
  begin
    perform public.admin_update_settings(false, false, 'admin', '{}');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from '42501' then
    raise exception 'FALHOU: usuário comum chamou admin_update_settings (sqlstate %: %)', st, msg;
  end if;
end $$;

-- Pendente: vê a si mesmo (para a tela de aguardando aprovação) e não se aprova.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b001","role":"authenticated"}';

do $$
declare st text; msg text;
begin
  if (select count(*) from public.profiles) <> 1
     or (select status from public.profiles) <> 'pendente' then
    raise exception 'FALHOU: usuário pendente não vê só o próprio profile';
  end if;

  begin
    update public.profiles set status = 'aprovado', role = 'admin'
    where id = '00000000-0000-4000-8000-00000000b001';
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from '42501' then
    raise exception 'FALHOU: usuário conseguiu escrever em profiles (sqlstate %: %)', st, msg;
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Admin: lista, aprova, não altera a si mesmo, último admin, bloqueio
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}';

do $$
declare
  v_order uuid[];
  v_pend record;
begin
  -- Filtra os usuários de teste: o banco pode ter usuários reais intercalados.
  select array_agg(l.id order by l.n) into v_order
  from public.admin_list_users() with ordinality
    as l(id, email, full_name, role, status, created_at, reviewed_at, reviewer_email, email_confirmed_at, last_sign_in_at, n)
  where l.id::text ~ '^00000000-0000-4000-8000-00000000[ab]00[1-4]$';

  if v_order is distinct from array[
    '00000000-0000-4000-8000-00000000b002', -- pendente, 1 dia
    '00000000-0000-4000-8000-00000000b001', -- pendente, 5 dias
    '00000000-0000-4000-8000-00000000b004', -- 3 dias
    '00000000-0000-4000-8000-00000000b003', -- 4 dias
    '00000000-0000-4000-8000-00000000a002', -- 9 dias
    '00000000-0000-4000-8000-00000000a001'  -- 10 dias
  ]::uuid[] then
    raise exception 'FALHOU: admin_list_users fora de ordem: %', v_order;
  end if;

  select * into v_pend from public.admin_list_users() l where l.id = '00000000-0000-4000-8000-00000000b001';
  if v_pend.email_confirmed_at is not null or v_pend.full_name <> 'Pessoa Pendente' then
    raise exception 'FALHOU: admin_list_users trouxe dados errados do pendente: %', row_to_json(v_pend);
  end if;
end $$;

do $$
declare r record;
begin
  select * into r from public.admin_update_user('00000000-0000-4000-8000-00000000b001', 'aprovado');
  if r.previous_status is distinct from 'pendente' or r.status <> 'aprovado'
     or r.email <> 'pendente@itaqui-teste.invalid' or r.full_name <> 'Pessoa Pendente' or r.role <> 'visualizador' then
    raise exception 'FALHOU: retorno da aprovação errado: %', row_to_json(r);
  end if;

  select * into r from public.admin_list_users() l where l.id = '00000000-0000-4000-8000-00000000b001';
  if r.reviewed_at is null or r.reviewer_email is distinct from 'admin1@itaqui-teste.invalid' then
    raise exception 'FALHOU: aprovação não gravou reviewed_at/reviewer: %', row_to_json(r);
  end if;

  -- Só papel: status igual, revisão não muda.
  select * into r from public.admin_update_user('00000000-0000-4000-8000-00000000b002', new_role => 'gestor');
  if r.previous_status <> 'pendente' or r.status <> 'pendente' or r.role <> 'gestor' then
    raise exception 'FALHOU: troca de papel errada: %', row_to_json(r);
  end if;
end $$;

reset role;

do $$
begin
  if (select reviewed_by from public.profiles where id = '00000000-0000-4000-8000-00000000b001')
     is distinct from '00000000-0000-4000-8000-00000000a001' then
    raise exception 'FALHOU: reviewed_by não é o admin que aprovou';
  end if;
  if (select reviewed_at from public.profiles where id = '00000000-0000-4000-8000-00000000b002') is not null then
    raise exception 'FALHOU: trocar só o papel gravou reviewed_at';
  end if;
end $$;

-- Sessões do operador, para o bloqueio derrubar.
insert into auth.sessions (id, user_id, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000b004', now(), now()),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000b004', now(), now());
insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at)
values ('itaqui-teste-refresh-token', '00000000-0000-4000-8000-00000000b004', '00000000-0000-4000-8000-00000000c001', false, now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}';

do $$
declare st text; msg text; r record;
begin
  -- Com dois admins: mexer em si mesmo cai na regra da própria conta.
  begin
    perform public.admin_update_user('00000000-0000-4000-8000-00000000a001', new_role => 'gestor');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from 'P0001' or msg not like '%própria conta%' then
    raise exception 'FALHOU: admin alterou a si mesmo (sqlstate %: %)', st, msg;
  end if;

  select * into r from public.admin_update_user('00000000-0000-4000-8000-00000000b004', 'bloqueado');
  if r.previous_status <> 'aprovado' or r.status <> 'bloqueado' then
    raise exception 'FALHOU: bloqueio retornou %', row_to_json(r);
  end if;

  -- Rebaixar o outro admin é permitido; depois disso o admin1 é o último.
  select * into r from public.admin_update_user('00000000-0000-4000-8000-00000000a002', new_role => 'visualizador');
  if r.role <> 'visualizador' then
    raise exception 'FALHOU: não rebaixou o segundo admin: %', row_to_json(r);
  end if;

  st := null;
  begin
    perform public.admin_update_user('00000000-0000-4000-8000-00000000a001', 'bloqueado');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from 'P0001' or msg not like '%último administrador%' then
    raise exception 'FALHOU: foi possível remover o último admin (sqlstate %: %)', st, msg;
  end if;

  st := null;
  begin
    perform public.admin_update_user('00000000-0000-0000-0000-00000000dead', 'aprovado');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from 'P0001' then
    raise exception 'FALHOU: alvo inexistente não deu erro (sqlstate %: %)', st, msg;
  end if;
end $$;

reset role;

do $$
begin
  if exists (select 1 from auth.sessions where user_id = '00000000-0000-4000-8000-00000000b004') then
    raise exception 'FALHOU: bloquear não apagou as sessões';
  end if;
  if exists (select 1 from auth.refresh_tokens where token = 'itaqui-teste-refresh-token') then
    raise exception 'FALHOU: refresh token sobreviveu ao bloqueio';
  end if;
  if (select role from public.profiles where id = '00000000-0000-4000-8000-00000000a001') <> 'admin'
     or (select status from public.profiles where id = '00000000-0000-4000-8000-00000000a001') <> 'aprovado' then
    raise exception 'FALHOU: o último admin perdeu o acesso';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- admin_update_settings: normaliza, valida, grava autoria
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}';

do $$
declare s public.app_settings; st text; msg text;
begin
  s := public.admin_update_settings(
    true, true, 'gestor',
    array[' @EMAP.ma.gov.br ', 'emap.ma.gov.br', '', '  ', 'Rynalde.COM', '@@porto-teste.example']
  );
  if s.auto_approve_domains is distinct from array['emap.ma.gov.br', 'porto-teste.example', 'rynalde.com'] then
    raise exception 'FALHOU: domínios não normalizados: %', s.auto_approve_domains;
  end if;
  if s.default_role <> 'gestor' or s.updated_by is distinct from '00000000-0000-4000-8000-00000000a001'
     or s.updated_at is null then
    raise exception 'FALHOU: configurações gravadas erradas: %', row_to_json(s);
  end if;

  s := public.admin_update_settings(true, true, 'visualizador', null);
  if s.auto_approve_domains is distinct from '{}'::text[] then
    raise exception 'FALHOU: lista nula de domínios não virou vazia: %', s.auto_approve_domains;
  end if;

  begin
    perform public.admin_update_settings(true, true, 'visualizador', array['emap.ma.gov.br', 'emap..br']);
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from 'P0001' or msg not like '%emap..br%' then
    raise exception 'FALHOU: domínio inválido aceito (sqlstate %: %)', st, msg;
  end if;

  st := null;
  begin
    perform public.admin_update_settings(true, true, 'visualizador', array['localhost']);
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from 'P0001' then
    raise exception 'FALHOU: domínio sem ponto aceito (sqlstate %: %)', st, msg;
  end if;

  st := null;
  begin
    perform public.admin_update_settings(true, false, 'admin', '{}');
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from 'P0001' or msg not like '%Administrador%' then
    raise exception 'FALHOU: papel padrão admin aceito (sqlstate %: %)', st, msg;
  end if;

  if (select count(*) from public.app_settings) <> 1 then
    raise exception 'FALHOU: admin não lê app_settings';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- signup_open e hook before-user-created
-- ---------------------------------------------------------------------------
set local role anon;
do $$
begin
  if public.signup_open() is distinct from true then
    raise exception 'FALHOU: signup_open() deveria ser true';
  end if;
end $$;
reset role;

update public.app_settings set signup_enabled = false where id;

set local role anon;
do $$
begin
  if public.signup_open() is distinct from false then
    raise exception 'FALHOU: signup_open() deveria ser false';
  end if;
end $$;
reset role;

-- Evento no formato que o GoTrue v2.196 envia.
do $$
declare
  v_event jsonb := '{
    "metadata": {"uuid": "8b0e1d1c-5c1e-4e0a-9d1e-2f3a4b5c6d7e", "time": "2026-10-14T18:00:00Z",
                 "name": "before-user-created", "ip_address": "203.0.113.10"},
    "user": {"id": "8b0e1d1c-5c1e-4e0a-9d1e-2f3a4b5c6d7f", "aud": "authenticated", "role": "",
             "email": "novo@itaqui-teste.invalid", "phone": "",
             "app_metadata": {"provider": "email", "providers": ["email"]},
             "user_metadata": {"full_name": "Novo"}, "identities": [],
             "created_at": "0001-01-01T00:00:00Z", "updated_at": "0001-01-01T00:00:00Z",
             "is_anonymous": false}
  }';
begin
  if public.hook_before_user_created(v_event) is distinct from
     '{"error": {"http_code": 403, "message": "Os cadastros estão fechados no momento."}}'::jsonb then
    raise exception 'FALHOU: hook com cadastro fechado retornou %', public.hook_before_user_created(v_event);
  end if;

  update public.app_settings set signup_enabled = true where id;

  if public.hook_before_user_created(v_event) is distinct from '{}'::jsonb then
    raise exception 'FALHOU: hook com cadastro aberto retornou %', public.hook_before_user_created(v_event);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privilégios: anon só executa signup_open; ninguém do app chama o hook
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.is_admin()',
    'public.admin_list_users()',
    'public.admin_update_user(uuid, public.account_status, public.app_role)',
    'public.admin_update_settings(boolean, boolean, public.app_role, text[])',
    'public.hook_before_user_created(jsonb)',
    'public.handle_new_user()'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'FALHOU: anon pode executar %', f;
    end if;
  end loop;

  foreach f in array array['public.hook_before_user_created(jsonb)', 'public.handle_new_user()'] loop
    if has_function_privilege('authenticated', f, 'execute') then
      raise exception 'FALHOU: authenticated pode executar %', f;
    end if;
  end loop;

  if not has_function_privilege('anon', 'public.signup_open()', 'execute') then
    raise exception 'FALHOU: anon não executa signup_open()';
  end if;
  if not has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute') then
    raise exception 'FALHOU: supabase_auth_admin não executa o hook';
  end if;

  if has_table_privilege('anon', 'public.profiles', 'select')
     or has_table_privilege('anon', 'public.app_settings', 'select') then
    raise exception 'FALHOU: anon lê profiles ou app_settings';
  end if;
  if has_table_privilege('authenticated', 'public.profiles', 'insert, update, delete')
     or has_table_privilege('authenticated', 'public.app_settings', 'insert, update, delete') then
    raise exception 'FALHOU: authenticated tem escrita direta em profiles ou app_settings';
  end if;
end $$;

set local role anon;
do $$
declare st text; msg text;
begin
  begin
    perform public.is_admin();
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from '42501' then
    raise exception 'FALHOU: anon executou is_admin() (sqlstate %: %)', st, msg;
  end if;

  st := null;
  begin
    perform 1 from public.profiles;
  exception when others then get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  if st is distinct from '42501' then
    raise exception 'FALHOU: anon leu profiles (sqlstate %: %)', st, msg;
  end if;
end $$;
reset role;

do $$ begin raise notice 'OK: todos os testes passaram'; end $$;

rollback;
