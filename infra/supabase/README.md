# Supabase self-hosted do EMAP

Servidor Supabase próprio do projeto, rodando no iMac `omarchy` (Omarchy Linux, acessível pela tailnet) e publicado em **https://emap.rynalde.com** por um Cloudflare Tunnel. É o backend de autenticação do [`itaqui-digital`](../../apps/itaqui-digital/README.md#autenticação) e já carrega o schema do [`periplus`](../../apps/periplus/supabase/README.md).

| Endereço                                                                                       | O que responde                                              |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `https://emap.rynalde.com/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1`, `/functions/v1` | APIs do Supabase (exigem a chave publicável)                |
| `https://emap.rynalde.com/`                                                                    | Supabase Studio, protegido por usuário e senha (basic auth) |
| `http://omarchy:8000`                                                                          | O mesmo gateway, direto pela tailnet                        |

## Como está montado

```
navegador / Vercel ──HTTPS──▶ Cloudflare ──túnel "emap"──▶ cloudflared (systemd, omarchy)
                                                              │
                                                              ▼ http://localhost:8000
                                                   Envoy ─▶ auth · rest · realtime · storage · studio …
                                                              (docker compose, /opt/emap/supabase)
```

- **Stack**: o `docker-compose.yml` oficial do Supabase, release `self-hosted/v0.8.2`, instalado com `setup.sh -y --skip-deps --project-dir supabase` em `/opt/emap`. Este diretório guarda só o que o EMAP acrescenta.
- **`docker-compose.emap.yml`**: camada do EMAP, ligada por `sh run.sh config add emap`. Assuntos e modelos dos e-mails em português, links válidos por 1 h, senha mínima de 8 caracteres, o hook `before-user-created` (`public.hook_before_user_created`, criado pela migration do `itaqui-digital`; veja [Schema](#schema)), e um nginx interno (`mail-templates`) que serve os modelos ao GoTrue, que só os lê por HTTP.
- **`mail-templates/`**: confirmação de cadastro, redefinição de senha e convite. Os links apontam para `{{ .RedirectTo }}?token_hash=…&type=…&next=…`, tratado pela rota `/auth/confirm` do `itaqui-digital`. No servidor ficam em `/opt/emap/supabase/volumes/mail-templates/`.
- **`cloudflared.yml`**: cópia de `/etc/cloudflared/config.yml`. O túnel `emap` e o CNAME `emap.rynalde.com` foram criados com `cloudflared tunnel create` / `tunnel route dns`. O serviço `cloudflared.service` e o `docker.service` sobem no boot, e os contêineres têm `restart: unless-stopped`.
- **E-mail**: SMTP do Resend (`smtp.resend.com:587`), remetente `Itaqui Digital <no-reply@rynalde.com>`, com uma chave restrita a envio e ao domínio `rynalde.com` (`emap-supabase-auth-smtp`).
- **Autenticação**: confirmação de e-mail obrigatória, cadastro aberto ou fechado em `/admin` (`app_settings`), sem login por telefone. `ENABLE_PHONE_AUTOCONFIRM=false` também no `.env`: com qualquer autoconfirmação ligada, o GoTrue responde `user_already_exists` a um novo cadastro com e-mail já existente, e isso revela quais contas existem. `SITE_URL` é `https://itaqui-digital.vercel.app`. Redirecionamentos permitidos (`ADDITIONAL_REDIRECT_URLS` no `.env`, que vira `GOTRUE_URI_ALLOW_LIST`): só `http://localhost:3000/**` e `https://itaqui-digital.vercel.app/**`. As prévias da Vercel ficam de fora de propósito: qualquer pessoa registra um projeto `itaqui-digital-<algo>.vercel.app` (até com o slug do time no nome), e o link do e-mail entregaria o `token_hash` a ela. Os links pedidos numa prévia caem no `SITE_URL`, e o proxy do app os leva para `/auth/confirm`.

## Segredos

Nada sensível está no Git. Todos os segredos ficam no iMac, legíveis só pelo root:

| Arquivo                                                     | Conteúdo                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/opt/emap/supabase/.env`                                   | senha do Postgres, JWT e chaves (publicável, secreta, ES256), senha do Studio (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`), chave SMTP do Resend (`SMTP_PASS`) |
| `/etc/cloudflared/<id>.json`, `/root/.cloudflared/cert.pem` | credenciais do túnel e da conta Cloudflare                                                                                                                    |

Para ver as chaves e a senha do Studio: `sudo sh /opt/emap/supabase/run.sh secrets`.

A chave **publicável** (`sb_publishable_…`) é pública por definição e vai para o front-end. A chave **secreta** (`sb_secret_…`) e a `SERVICE_ROLE_KEY` ignoram o RLS. Nunca use nenhuma das duas em código de cliente.

## Operação

Tudo como root no omarchy (`tailscale ssh root@omarchy`), dentro de `/opt/emap/supabase`:

```bash
sh run.sh status            # estado dos contêineres
sh run.sh logs auth         # logs do GoTrue (envio de e-mail, erros de login)
sh run.sh restart auth      # depois de mudar o .env ou o docker-compose.emap.yml
systemctl status cloudflared
```

Para mudar a camada do EMAP, edite os arquivos deste diretório e copie-os para o servidor:

```bash
scp docker-compose.emap.yml root@omarchy:/opt/emap/supabase/
scp mail-templates/*.html root@omarchy:/opt/emap/supabase/volumes/mail-templates/
ssh root@omarchy 'cd /opt/emap/supabase && docker compose up -d auth'
scp cloudflared.yml root@omarchy:/etc/cloudflared/config.yml && ssh root@omarchy systemctl restart cloudflared
```

### Schema

As migrations do periplus foram aplicadas em ordem, pelo `psql` do contêiner `supabase-db`, como manda o [README do periplus](../../apps/periplus/supabase/README.md#apply-the-migrations). Assim surgem `devices`, `readings`, `latest_positions` e as RPCs `ingest` e `register_device`. As migrations de LoRa e de Channel Sounding deixam registrados dois gateways de desenvolvimento, `dev-t-echo-gateway-001` e `dev-cs-gateway-001`. Para emitir as chaves de verdade, rode `register_device` de novo.

O hook `before-user-created` ligado no `docker-compose.emap.yml` exige a migration do `itaqui-digital`; sem ela o `/signup` falha. Aplique `apps/itaqui-digital/supabase/migrations/20261014180000_user_approval_admin.sql` pelo mesmo `psql` do `supabase-db` e confira com `apps/itaqui-digital/supabase/tests/user_approval_admin.sql`.

## Limitações conhecidas

- **Sem backup automático.** O banco vive no volume `volumes/db/data` do iMac. Antes de atualizar (`sh update.sh`), faça um `pg_dump`.
- **Portas abertas na rede local e na tailnet**: `8000` (gateway), `5432` e `6543` (Supavisor). O Postgres é protegido pela senha do `.env`, mas não há firewall no iMac.
- **Limites por IP do GoTrue**: as telas do `itaqui-digital` chamam o Auth a partir do servidor (Vercel), então todos os usuários dividem os limites de login, cadastro e verificação de um mesmo IP de saída. É suficiente para o piloto, mas uma base grande de usuários pediria ajustar `GOTRUE_RATE_LIMIT_*`.
- **Disponibilidade** depende do iMac ligado e com internet.
- **Enumeração de contas pela API do GoTrue.** `POST /auth/v1/otp` com `create_user: false` responde 422 para e-mail inexistente e 200 (com link mágico) para conta existente. O app nunca usa login por OTP, então o túnel responde 404 a qualquer caminho com um segmento `otp` ou `magiclink` (primeira regra de `cloudflared.yml`). A regra não tem âncora de propósito: o Envoy e o GoTrue normalizam `//`, `/./`, `/x/../` e `%2e` para `/auth/v1/otp`, e uma regra ancorada em `^/auth/v1/` deixava essas variantes passarem. Com o cadastro fechado, `POST /auth/v1/signup` também diferencia: 200 para e-mail existente e 403 para novo, porque o hook `before-user-created` só roda para usuários novos.
