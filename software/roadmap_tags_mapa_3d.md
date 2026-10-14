---
type: software
title: "Roadmap — Tags do periplus no Mapa 3D do itaqui-digital"
description: "Fases, decisões e riscos para levar as posições das tags do periplus, via Supabase self-hosted, à vista 3D (e ao mapa 2D) do itaqui-digital."
timestamp: 2026-10-14T00:00:00Z
tags: [software, roadmap, periplus, itaqui-digital, mapa-3d, supabase, lora, tags]
---

# Roadmap — Tags do `periplus` no mapa 3D do `itaqui-digital`

Proposta de 2026-10-14, ainda **sem responsável nem aprovação da coordenação**. Nada
deste documento foi implementado. Números marcados como *proposta* são metas sugeridas
aqui, não documentadas em outro lugar do repositório.

## Resumo

- **Marco M1 — 06/11/2026:** uma tag T-Beam real, carregada a pé, se move na vista
  `/3d` com até ~10 s de atraso, para um usuário logado. Só usa o enlace LoRa, que é o
  único validado em bancada.
- O caminho até o M1 tem três partes: a bridge passa a gravar no `emap.rynalde.com`
  (só configuração), uma rota `GET /api/tags` lida a cada 5 s e uma camada `setTags()`
  na cena.
- **Portão antes de qualquer ativo da EMAP (20/11/2026):** leitura só para usuários
  autorizados, `ingest` à prova de relay forjado, consulta barata e backup.
- Primeira tag real no cais: alvo no 1º trimestre de 2027, condicionado à visita técnica
  (1.1) e à autorização da EMAP. Channel Sounding e tag celular entram por último e sob
  condição.

## Estado atual (2026-10-14)

| Peça | Estado |
| :--- | :--- |
| Enlaces | **LoRa** (T-Beam → T-Echo) validado: 59/59 pacotes, 0 erros de CRC, 2 tags a 3 s. **CS** (XIAO nRF54L15) não validado. **Celular** (T-SIM7000G) bloqueado: a operadora redirecionava ao portal de recarga (chip sem crédito), nenhum POST da placa com 200 registrado, GNSS sem fix. Ver [`implementation.md`](implementation.md) e o [experimento celular](../experiments/backhaul_celular_lte.md). |
| Supabase self-hosted | [`https://emap.rynalde.com`](../infra/supabase/README.md), no iMac `omarchy`, via Cloudflare Tunnel, **sem backup**. Schema do periplus aplicado, mas **sem nenhuma tag nem leitura** (conferido em 14/10 com a chave publicável: `readings` vazia). Os dois gateways `dev-*-gateway-001` têm `device_id` = UUID do backfill (o nome é só o label) e as chaves deles foram impressas uma única vez, na aplicação da migration. Nenhuma tabela na publicação `supabase_realtime`. Cadastro aberto com confirmação de e-mail e **aprovação por um administrador** no painel `/admin` do itaqui-digital (`public.profiles`, papéis admin/gestor/operador/visualizador, domínios aprovados automaticamente, cadastro aberto/fechado). HTTP na porta 80 recebe `301` para HTTPS (medido em 14/10). |
| Quem grava onde | Bridge, firmwares e os clientes do periplus (`web`, `dashboard`) ainda apontam para o projeto hospedado `lvvulorcvuxuyrnumfay`, compartilhado com outro app GPS. |
| Contrato de leitura | View `public.latest_positions` (`security_invoker`): uma linha por dispositivo com `kind`, `link`, `status`, `recorded_at`, `lat`/`lng`, `hdop`, `sats`, `battery_mv`, `origin_lat`/`origin_lng`/`radius_m` (círculo das tags CS). Não tem corte de idade e faz `DISTINCT ON` sobre `readings` inteira, então o custo cresce com o histórico. |
| RLS | `SELECT` em `devices` e `readings` para `anon` **e** `authenticated`. A chave publicável está no bundle da Vercel e em `apps/itaqui-digital/.env.example`: as posições ficam legíveis sem passar pelo login do itaqui (conferido em 14/10: `/rest/v1/devices` devolve os gateways só com essa chave). `ingest` é `security definer`, com `EXECUTE` para `anon`: os dispositivos o chamam como `anon` e ele grava com os privilégios do dono. |
| `itaqui-digital` | Vista 3D em `/3d` (three.js, `src/lib/port3d/`), em metros locais com origem em `PORT_CENTER`; `project([lon,lat])` já existe. Nada na cena é posicionado por lon/lat vindos de dados ao vivo (navios vão para o berço, veículos são cenografia): as tags seriam os primeiros ativos móveis reais. **Autenticação em andamento, não commitada** (`src/proxy.ts`, `src/app/(app)/`): toda rota `/api/*` nova já nasce protegida (401 sem sessão). Só há clientes Supabase de servidor (`src/lib/supabase/server.ts` e `proxy.ts`), e o cookie de sessão é `httpOnly`. Ver [README](../apps/itaqui-digital/README.md#autenticação). |
| Limites da cena 3D | Cartografia no bbox `[-44.375,-2.586,-44.359,-2.566]` (~1,8 × 2,2 km); alvo da câmera preso a ±2600 m do centro; cais a 3 m, água a 0 m, dossel do entorno até ~10 m. Uma bancada fora do porto cai fora da cena. |

## Fluxo de dados (alvo)

```
 T-Beam (LoRa + GNSS, 3 s + jitter)      XIAO tag CS (só distância)    T-SIM7000G (LTE + GNSS, >= 30 s)
        | LoRa 923 MHz                          | Channel Sounding             | HTTPS 443 [Fase 5b, se o reteste passar]
        v                                       v                              |
 T-Echo gateway "GW001"            XIAO gateway CS (sem GNSS;                  |
        | USB serial                 âncora = devices.last_lat) [Fase 5a]      |
        +-------------------+-------------------+                              |
                            v                                                  |
                  bridge TypeScript (Node >= 22.6)                             |
                            | HTTPS POST /rest/v1/rpc/ingest (chave por dispositivo)
                            +------------------------------+-------------------+
                                                           v
            Cloudflare (HTTP -> 301 HTTPS) -> Tunnel -> Envoy :8000 (iMac "omarchy")
                                                           v
            Postgres 17: ingest() security definer
              |-- upsert public.devices (last_lat/last_lng por coalesce)
              '-- insert public.readings
                                                           v
            view public.latest_positions  [Fase 2: LATERAL, O(nº de dispositivos); SELECT só authenticated]
                                                           |
                            select de colunas explícitas com a sessão do usuário
                                                           v
 itaqui-digital (Vercel gru1): proxy.ts -> GET /api/tags (server.ts createClient) -> { agora, tags, gateways }
                                                           | SWR, refreshInterval 5 s
                     +-------------------------------------+------------------------------+
                     v                                                                    v
   port-3d-view.tsx -> tagPoses() -> scene.setTags()            port-dashboard.tsx -> port-map.tsx
   pino + rótulo .port3d-label.tag [Fase 1]; anel CS [5a]       Marker DOM; polígono do círculo CS [Fases 3 e 5a]
```

## Fases

| Fase | Período | Marco | Esforço |
| :--- | :--- | :--- | :--- |
| 0. Dados reais no self-hosted | 14/10 – 23/10/2026 | Tag LoRa gravando em `emap.rynalde.com` | P |
| 1. M1: tag se movendo no `/3d` | 26/10 – 06/11/2026 | **M1** | M |
| 2. Portão de segurança e custo | 09/11 – 20/11/2026 | Leitura fechada, view barata, backup | M |
| 3. Usar o mapa: seleção, foco, 2D | 23/11 – 11/12/2026 | Paridade 2D/3D | M |
| 4. Piloto no Porto do Itaqui | alvo fev – mar/2027 | Primeira tag real dentro da cena | P (código), G (logística) |
| 5. Outros enlaces (condicional) | 2027, sem data | Anel CS; tag celular | M cada |

As datas supõem uma pessoa no software, em sequência. A Fase 1 só começa depois do
merge da autenticação; se o merge atrasar, a Fase 2 troca de lugar com ela (ela não toca
o itaqui).

### Fase 0 — Dados reais chegando ao self-hosted

**Objetivo.** Leituras de uma tag T-Beam chegando a `https://emap.rynalde.com` pela
bridge. Quase tudo é configuração.

**Entregas**

1. Inventário: `select device_id, label, kind, link from devices` via psql no contêiner
   `supabase-db`.
2. Registro do gateway pelo mesmo psql (usuário `postgres`; `register_device` não é
   executável por `anon` nem `authenticated`), com `device_id` **igual** ao `GATEWAY_ID`
   gravado no T-Echo (padrão `GW001`):
   `select public.register_device('GW001', 'gateway', 'lora');`
   ([supabase/README](../apps/periplus/supabase/README.md)). A chave fica fora do
   repositório. Os `dev-*-gateway-001` (UUID) ficam sem uso; apagar se tiverem 0 leituras.
3. `.env` da bridge (modelo em [`apps/periplus/.env.example`](../apps/periplus/.env.example)):
   `SUPABASE_URL=https://emap.rynalde.com`, `SUPABASE_ANON_KEY=<chave publicável>`,
   `GATEWAY_KEY=<chave nova>`. Bridge rodando em Node com o T-Echo plugado
   (`node --experimental-strip-types --env-file=.env src/index.ts`): o Bun não carrega o
   módulo nativo `serialport`, e o `--experimental-strip-types` exige Node ≥ 22.6,
   embora a documentação do bridge diga "Node 20+".
4. `LORA_FREQUENCY 923.0` conferido no `config.h` do T-Beam e do T-Echo. O
   `config.example.h` traz 915.0: se um dos lados for recriado a partir do exemplo, o
   gateway não ouve nada e não acusa erro.
5. Registro em [`infra/supabase/README.md`](../infra/supabase/README.md): `device_id`s
   ativos, onde ficam as chaves e o destino dos gateways UUID.
6. **Em paralelo, sem bloquear nada:** a coordenação pede à EMAP a visita técnica (1.1) e
   a autorização para um piloto com 1 gateway e 2 tags; o dono do experimento celular
   recarrega o chip e refaz o teste na porta 80 (por *quick tunnel*, como no experimento:
   `emap.rynalde.com` responde `301` em HTTP) e depois na 443.

**Critério de aceite**

- `curl -H "apikey: <publicável>" "https://emap.rynalde.com/rest/v1/latest_positions?select=device_id,kind,status,recorded_at,lat,lng,hdop&kind=eq.tag"`
  devolve a tag (12 hex, por exemplo `D447A9BBBC2C`) com `status=fix` e `recorded_at`
  avançando a cada ~3 s. (Funciona só até a Fase 2, que fecha a leitura para `anon`.)
- `GW001` aparece com `kind='gateway'` e as leituras dele têm `reported_by` nulo
  (auto-relato); nenhum `device_id` novo surge além das tags T-Beam.
- Fica anotado se `hdop`/`snr` chegam como string ou como number pelo PostgREST v14.

**Dependências.** Acesso ao `omarchy`, T-Beam e T-Echo em mãos, uma máquina para a
bridge. Não toca em arquivos do itaqui: corre em paralelo com a autenticação.

**Riscos.** `GATEWAY_ID` divergente cria uma tag fantasma; o periplus `web`/`dashboard`
deixam de receber dados novos desta bridge (aceito, ver D3).

### Fase 1 — M1: uma tag se movendo no `/3d`

**Objetivo.** Pino da tag na cena 3D, atualizado por polling, só para quem está logado.

**Pré-requisito.** Merge da autenticação: `port-3d-view.tsx`, `port-dashboard.tsx`,
`proxy.ts` e `src/app/(app)/` estão em movimento. Ler `node_modules/next/dist/docs`
antes de escrever a rota, como pede o `AGENTS.md` do app.

**Entregas**

- `src/app/api/tags/route.ts`: GET com `createClient()` de `src/lib/supabase/server.ts`;
  `select` de colunas explícitas de `latest_positions` (tags e gateways), **sem
  `payload`**, que traz o IMEI da tag celular; `Number()` em `hdop`/`snr`; resposta
  `{ agora, tags, gateways }`, com `agora` do servidor para calcular idades sem depender
  do relógio do cliente; erros em pt-BR no padrão de `/api/port`. Com `TAGS_DEMO_ORIGIN`
  definida (D5), desloca as posições e marca `demo: true`.
- `src/lib/types.ts`: tipo `Tag` e o subconjunto de `isLocated`, `isRanged`, `statusOf` e
  cores copiado de `apps/periplus/web/lib/types.ts`, com rótulos em pt-BR (D6).
- `src/lib/port3d/layout.ts`: função pura `tagPoses(tags, land, agora)`. Usa
  `project([lng,lat])`; `y = GROUND` se `pointInPolygon(land)`, senão 0; só tags
  `isLocated` (as CS ficam para a Fase 5a); conta à parte as que caem fora do bbox da
  cartografia; aplica a regra de estados (seção própria abaixo).
- `src/lib/port3d/scene.ts`: `setTags(poses)` no contrato do controlador, com grupo
  `tags` próprio; um `Mesh` por `device_id` com geometria e material compartilhados,
  atualizado no lugar (D7); haste mais alta que o dossel (~10 m); rótulo CSS2D
  `.port3d-label.tag` via `makeLabel`, fora do grupo `labels`; liberação em `dispose()`.
- `src/components/port-3d-view.tsx`: `useSWR('/api/tags', …, { refreshInterval: 5000 })`
  num `useEffect` **separado** do de `setVessels` (que faz `setSelection(null)` e
  fecharia o cartão a cada poll); avisos "N tags fora da área 3D" e "demonstração:
  posição deslocada"; com 401, "Sessão expirada" com link para `/login`, em vez de o
  mapa congelar em silêncio. Com qualquer outro erro (iMac, túnel ou PostgREST fora),
  aviso "Rastreamento indisponível desde HH:MM" e pinos esmaecidos: o SWR mantém o
  último `data`, e com `agora` congelado a tag continuaria parecendo ao vivo.
- Testes: `tagPoses` em `tests/port3d.test.ts` (terra, água, fora da área, ranging
  excluído, estados); contagem de `.port3d-label.tag` em `tests/browser.mjs` quando
  houver `TEST_EMAIL` e dados.

**Critério de aceite**

- Num deploy de Preview com `TAGS_DEMO_ORIGIN` e usuário logado em `/3d`, a tag carregada
  a pé move o pino em **≤ 10 s** (*proposta*: 3 s da tag + 5 s de poll + rede).
- Com a tag desligada, o pino esmaece após ~10 s.
- Sem sessão, `GET /api/tags` → 401; com a sessão expirada, o aviso aparece.
- Com o `emap.rynalde.com` inacessível, o aviso de indisponibilidade aparece e nenhum
  pino segue verde.
- O cartão de um navio aberto continua aberto durante os polls.
- Em Produção, sem `TAGS_DEMO_ORIGIN`, a posição de bancada **não** é desenhada e o
  aviso mostra "1 tag fora da área 3D".
- `npm test` passa.

**Dependências.** Fase 0 e merge da autenticação.

**Riscos.** A posição deslocada pode ser lida como real (mitigação em D5). Cada poll
custa uma invocação na Vercel, um `getClaims` no proxy e um `DISTINCT ON` no iMac;
aceitável com poucos usuários até a Fase 2.

### Fase 2 — Portão de segurança e custo

**Objetivo.** Nenhuma posição legível sem login controlado, nenhuma posição forjável por
chave de tag, consulta da posição atual com custo O(nº de dispositivos) e cópia dos dados
fora do iMac. **Nenhuma tag em ativo da EMAP antes desta fase.**

**Entregas**

- Uma migration nova e idempotente em `apps/periplus/supabase/migrations/`, posterior a
  `20260908120000_unify_device_schema.sql`, que:
  - recria `mvp_read_devices` e `mvp_read_readings` só para `authenticated` e revoga o
    `SELECT` de `anon` (colunas de `devices` e `readings`), **mantendo** o `EXECUTE` de
    `ingest` para `anon`;
  - faz o `ingest` recusar relay quando a chave não é de um dispositivo `kind='gateway'`;
  - reescreve `latest_positions` como `devices CROSS JOIN LATERAL (… where device_id =
    d.device_id order by recorded_at desc, id desc limit 1)`, com as mesmas colunas e
    `security_invoker`. Só acrescentar `id` ao índice não basta: o Postgres 17 não faz
    loose index scan para `DISTINCT ON`.
- Policies de `devices` e `readings` exigindo conta **aprovada** (`profiles.status =
  'aprovado'`), não só `authenticated`: uma conta pendente já tem sessão válida. O
  cadastro controlado em si (aprovação pelo admin, papéis, domínios automáticos) já
  existe desde 14/10.
- Backup mínimo: `pg_dump` diário guardado fora do iMac e 1 restore testado.
- Portas `5432`/`6543` do iMac fechadas para a rede local (ficam `localhost` e tailnet).
- Docs do periplus (`.env.example`, README, `supabase/README`) apontando para o
  self-hosted, com o aviso de que reaplicar a migration `unify` recria as policies com
  `anon`.

**Critério de aceite**

- `curl` só com a chave publicável em `/rest/v1/latest_positions`, `/rest/v1/devices` e
  `/rest/v1/readings` recebe erro de permissão ou lista vazia.
- `/api/tags` com sessão continua funcionando, e a bridge continua recebendo 200.
- Um `ingest` com chave de tag e `device_id` alheio é recusado.
- `EXPLAIN ANALYZE` da view, com pelo menos um dia de leituras, não mostra `Seq Scan`
  em `readings` (com poucas linhas o planner pode preferir o scan, e o teste não diz
  nada).
- Uma conta pendente, rejeitada ou bloqueada não lê posições, nem direto em `/rest/v1`.
- O restore devolve a mesma contagem de `readings`.

**Dependências.** Fase 0. **Riscos.** O
periplus `web`/`dashboard` deixariam de ler este servidor (hoje leem o hospedado, então
nada quebra). A migration nova fica na mesma pasta das que valem para o projeto
hospedado: aplicada lá por engano, fecharia a leitura `anon` de que o `web`/`dashboard`
dependem. Aplicar só no self-hosted e dizer isso no cabeçalho do arquivo.

### Fase 3 — Usar o mapa: seleção, foco e paridade 2D

**Objetivo.** Clicar numa tag, ir até ela e ver a mesma camada no mapa 2D.

**Entregas**

- 3D: variante `{type:'tag'}` em `SceneSelection` e ramo em `SelectionDetails` (nome,
  estado, "atualizado há", `hdop`, `sats`, `battery_mv`, gateway que reportou); clique no
  rótulo seleciona; `focus()` aceita um ponto; botão "Tags" em `p3d-controls` (D14).
- Lista "Ativos rastreados" com "ir até", que reúne também as tags fora da área 3D, as
  sem posição e o estado de cada gateway (se o gateway cai, todas as tags ficam sem
  sinal, e o supervisor precisa ver que a causa é a infraestrutura).
- 2D: chave `tags` em `Layers`, switch no popover "Camadas do mapa" de
  `port-dashboard.tsx`, `maplibregl.Marker` no padrão `vessel-marker` em `port-map.tsx`,
  variante `tag` em `MapSelection` e `selection-card.tsx`.
- Nome do ativo em `devices.label` (D10).
- Seção "Tags" no [README do itaqui-digital](../apps/itaqui-digital/README.md): fonte,
  estados e limiares.

**Critério de aceite.** O cartão da tag abre pelo rótulo e não fecha nos polls; "ir até"
centraliza a câmera; o switch liga e desliga a camada no 2D e no 3D; um label editado à
mão persiste após novas leituras.

**Dependências.** Fase 1. **Riscos.** `port-dashboard.tsx` e `port-map.tsx` concentram
muito estado; a mudança toca quatro arquivos.

### Fase 4 — Piloto no Porto do Itaqui

**Objetivo.** Ativos reais dentro da cena 3D, sem deslocamento, com números de campo.

**Entregas**

- Antes de ir ao cais: T-Beam parado 30 min em bancada; dispersão p95 e `hdop` médio
  registrados.
- Gateway T-Echo e bridge num ponto com energia e conectividade (1.4); 2 tags LoRa em
  ativos reais, com `label` = nome do ativo.
- Bridge como serviço com reinício automático (ela desiste de uma leitura após 3
  tentativas e não guarda fila) e uma verificação externa de disponibilidade do
  `emap.rynalde.com` que avise alguém: o iMac é ponto único e hoje ninguém é avisado
  quando ele cai.
- Remoção de `TAGS_DEMO_ORIGIN` (código e env).
- Registro novo em `experiments/` com: atraso servidor → tela (`agora − recorded_at`; o
  atraso rádio → servidor não é mensurável porque `device_time` é sempre null), perda
  pelas lacunas de `seq`, distância entre o pino e um ponto de referência conhecido, e o
  comportamento dos limiares de "sem sinal".

**Critério de aceite.** As tags aparecem dentro do bbox da cartografia, sobre via ou
pátio; um supervisor da EMAP responde só pelo mapa "onde está o ativo X e desde quando";
o relatório propõe as metas de campo (idade máxima, perda e erro visual aceitáveis). As
metas da [maquete indoor](../experiments/indoor_positioning.md) (< 5 cm, ≤ 1 s, < 2%) não
se aplicam a GNSS no porto.

**Dependências.** Fase 2; tarefas 1.1, 1.3 (ativos que recebem tag), 1.4 e 3.5;
autorização da EMAP. **Riscos.** Alcance LoRa no porto não medido; prazo e autorização
fora do controle da equipe. É um ensaio antecipado da 5.1 (A2T3), não a substitui.

### Fase 5 — Outros enlaces (condicional)

**5a. Channel Sounding** — só depois do bring-up de bancada do XIAO.

- Registrar o gateway CS com `device_id` igual a `CONFIG_CS_GATEWAY_ID` (hoje o heartbeat
  `CSGW01` vira uma tag e é recusado pelo CHECK, erro 23514); corrigir o help do
  `Kconfig` (que ainda chama o id de "label only") e a divergência `CSGW01`/`GWCS01` na
  documentação. Uma segunda instância da bridge para ele: cada processo lê um só
  `SERIAL_PORT` com um só `GATEWAY_KEY`.
- Gravar a posição medida do gateway com `UPDATE devices SET last_lat, last_lng` (D9).
- `tagPoses` trata `isRanged` (`radius_m != null` e `origin_* != null`); anel
  (`RingGeometry`/`LineLoop`) de raio `radius_m` em volta de
  `project([origin_lng, origin_lat])` no 3D e polígono GeoJSON aproximado no 2D, **sem
  pino central**; cartão com "distância ao gateway, não posição".
- **Aceite:** o raio do anel acompanha `distance_m` quando a tag se afasta.

**5b. Tag celular** — nenhum código de mapa: chega como `lat`/`lng`, com limiar de 5 min.
Depende do backhaul (D13) e de apontar a placa para o servidor novo: `register_device`
com o IMEI no self-hosted e `SUPABASE_HOST`, `SUPABASE_ANON_KEY` e `INGEST_KEY` no
`config.h` (o exemplo ainda aponta para `lvvulorcvuxuyrnumfay.supabase.co`). **Aceite:** ≥ 20 POSTs seguidos com 200 do IMEI registrado
e a tag visível no mapa.

## Decisões técnicas

| # | Decisão | Recomendação | Alternativa descartada |
| :--- | :--- | :--- | :--- |
| D1 | Frescor | **Polling de 5 s** via SWR, o padrão de `/api/vessels`. A tag LoRa reporta a cada ~3 s, a celular a cada ≥ 30 s. | Realtime: a view não pode ser assinada; exigiria `readings` na publicação, `createBrowserClient` com acesso ao token (hoje o cookie de sessão é `httpOnly`), WSS pelo túnel e limites de eventos do tenant (os dois últimos não verificados). |
| D2 | Caminho de leitura | **Rota de servidor** `/api/tags` com a sessão do usuário, já protegida pelo `proxy.ts`. | Navegador lendo direto de `emap.rynalde.com`: só compensa junto com Realtime ou se o custo de invocações incomodar. |
| D3 | Migração | **Corte:** a bridge grava só no self-hosted; o periplus `web`/`dashboard` ficam no hospedado, como ferramentas de bancada. | Gravar nos dois projetos: código novo na bridge sem ganho, e o hospedado é compartilhado. |
| D4 | Identidade do gateway | `register_device` com `device_id` = `GATEWAY_ID` do firmware (`GW001`). | Gravar o UUID do backfill no firmware: exige reflash sem ganho, e a chave impressa na migration não está guardada em nenhum lugar documentado (teria de ser rotacionada de qualquer forma). |
| D5 | Bancada fora da cena | **Deslocamento de demonstração** no servidor (`TAGS_DEMO_ORIGIN="lon,lat"`): `lng' = lng − ref_lng + PORT_CENTER[0]`, idem para lat. Só em Preview e dev, com selo "demonstração: posição deslocada" em cada pino; o movimento é real, o lugar não. Removido na Fase 4. Requer aceite da coordenação. | Só dados reais: correto pela regra do app de não inventar posições, mas deixa o 3D sem nada a mostrar até o piloto (2027). Ampliar a cena: custo alto para posições de bancada. |
| D6 | Tipos e regras | **Copiar** ~30 linhas de `apps/periplus/web/lib/types.ts`, em pt-BR. | Pacote compartilhado: não há workspace entre os apps. |
| D7 | Marcador 3D | **Um `Mesh` por `device_id`**, geometria e material compartilhados, posição atualizada no lugar. | `Batch.build()` de `kit.ts`, como em `setVessels`: descarta e recria a geometria a cada chamada; serve para conteúdo que muda a cada 5 min, não a cada 5 s. |
| D8 | Tag CS | **Anel** de raio `radius_m` em volta do gateway. | Pino no centro: sugere uma posição que o CS não mede. |
| D9 | Âncora do gateway CS | **`UPDATE devices.last_lat/last_lng`** com a posição medida; o `coalesce` do `ingest` a preserva, porque o gateway sempre manda `lat` null. Convenção documentada. | Colunas `fixed_lat`/`fixed_lng`: migration, grant e view novos; só se a convenção falhar. |
| D10 | Tag → ativo | **`devices.label`** = nome do ativo, editado via SQL; o `ingest` nunca o sobrescreve. Marcador genérico. | Tabela de ativos ou modelo 3D por tipo antes do inventário (1.3). |
| D11 | Quem lê posições | **Só contas aprovadas** (`profiles.status = 'aprovado'`), antes de qualquer dado da EMAP. | `service_role` na rota da Vercel: chave que ignora o RLS num ambiente serverless. Manter `anon`: a chave é pública. |
| D12 | Tag sem sinal | **Esmaece** acima do limiar do enlace; após 15 min sai da cena (regra do AIS no itaqui) mas **continua na lista** com "sem sinal há X". | Esconder ao primeiro atraso, como os navios `stale`: a tag piscaria e se perderia o "onde vi por último". |
| D13 | Backhaul celular | **Retestar com saldo, 80 e depois 443.** Se a 443 falhar: chip M2M. HTTP só em último caso, por hostname dedicado com a ingress do `cloudflared` limitada a `^/rest/v1/rpc/ingest$` e uma exceção ao redirecionamento para HTTPS só nesse hostname (hoje o HTTP recebe `301`; como fazer a exceção na Cloudflare está por confirmar). | Desligar "Always Use HTTPS" na zona: vale para todos os hosts e exporia `/auth/v1/token` e o Studio em claro. |
| D14 | Controles 3D | Rótulo de tag em grupo próprio, sempre visível no M1; botão "Tags" na Fase 3. | Grupo `labels`: o botão "Rótulos" esconderia a única forma de identificar e clicar a tag. |

## Estados de uma tag no mapa

Uma regra só, em `tagPoses`, usada pelo 3D e pelo 2D e reaproveitável pelo OEE (4.4) e
pelas notificações (4.6). Limiares *propostos*, a calibrar no piloto: tag LoRa 10 s,
gateway T-Echo 45 s (3 × 15 s), CS 90 s (3 × 30 s), celular 5 min. A idade é
`agora − recorded_at`, com `agora` vindo do servidor.

| Estado | Condição | Desenho |
| :--- | :--- | :--- |
| Ao vivo | `fix`/`ok` e idade ≤ limiar | verde |
| Posição antiga | `stale`/`poor` (a idade do fix não é transmitida) | âmbar, "idade do fix desconhecida" |
| Sem posição | `acquiring`/`no_gps`/`unknown` (`lat` null) | sem pino; só na lista |
| Falha de medida | `failed` (CS) | vermelho |
| Sem sinal | idade acima do limiar do enlace | esmaecido com "há X"; sai da cena após 15 min |

## Riscos e mitigação

| Risco | Efeito | Mitigação |
| :--- | :--- | :--- |
| Posições legíveis por `anon` e por contas não aprovadas | Qualquer um lê a posição dos ativos direto em `/rest/v1` | Fase 2 antes de qualquer ativo da EMAP (D11) |
| `ingest` aceita relay de qualquer chave | Uma chave de tag move qualquer outra tag no mapa | Recusa de relay sem chave de gateway (Fase 2). Replay (`seq` não validado) continua aberto, declarado |
| `GATEWAY_ID` diferente do dono da chave | Tag fantasma `GW001` na posição do gateway; no CS, heartbeat recusado (23514) | `device_id` = id do firmware (D4); critério de aceite da Fase 0 |
| `latest_positions` O(histórico) | ~22 a 29 mil linhas/dia por tag LoRa; cada poll varre tudo | View com LATERAL (Fase 2) |
| iMac único, sem backup nem alerta | Mapa e `ingest` param juntos; histórico do OEE se perde; com o SWR guardando a última resposta, o mapa pareceria ao vivo | Aviso de indisponibilidade (Fase 1); `pg_dump` diário fora do iMac (Fase 2); verificação externa de disponibilidade (Fase 4); migração para infraestrutura institucional fica como pendência |
| Postgres (`5432`/`6543`) aberto na rede local e na tailnet, sem firewall no iMac ([infra](../infra/supabase/README.md#limitações-conhecidas)) | Quem alcança a rede tenta a senha do Postgres e lê as posições sem passar pelo RLS | Restringir as portas a `localhost`/tailnet antes do piloto (Fase 2) |
| Conflito com a autenticação em andamento | Merge quebrado nos mesmos arquivos | Fase 1 só após o merge; Fase 2 pode vir antes |
| Bancada fora da cena 3D | M1 sem nada a mostrar | Deslocamento de demonstração restrito a Preview, com selo (D5) |
| Erro do GNSS somado aos 5 a 10 m da cena | Ativo desenhado dentro de prédio ou na água; perda de confiança da gerência | Medir no piloto e decidir sobre halo de incerteza; o estado não depende do desenho |
| CS e celular não validados | Marcos de "três tipos de tag" atrasam | Fora do caminho crítico (Fase 5, com portão) |
| `LORA_FREQUENCY` 915 no exemplo | Gateway surdo, sem erro | Conferência na Fase 0 |
| `hdop`/`snr` como string | `toFixed()` quebra a renderização | `Number()` na rota |
| Sessão expirada | Camada congela em silêncio | Aviso com link para `/login` (Fase 1) |
| Sem responsável de software | Fases sem dono, datas fictícias | P1 abaixo |

## Encaixe no cronograma (proposta para `organization/schedule.md`)

Não há data oficial de início do Ano 1, então as datas são absolutas a partir de
2026-10-14 e o trimestre relativo fica para a coordenação confirmar. Pelo conteúdo, as
Fases 0 a 3 pertencem à Fase 4 do [cronograma](../organization/schedule.md) (Software,
A1T3–A2T2) e a Fase 4 deste roadmap ensaia a Validação (A2T3).

- **Nova tarefa 4.9** — "Visualização de posições das tags no itaqui-digital (2D/3D)",
  dependente de 4.3. Ela **não** depende de 4.7 (KPIs), que espera OEE e rota. Alimenta a
  4.8.
- Atualizar status com "Início/Fim Real": 4.1 e 4.2 concluídas no MVP de 2026-09-09; 4.3
  em andamento (migra para o self-hosted na Fase 0); 3.3, 3.4 e 3.5 parciais (só LoRa).
- Preencher "Responsável" de 4.9 e das Fases 0 a 2.

## Fora de escopo

- Trilhas, histórico, replay, "parado há N min" e retenção ou particionamento de
  `readings`. São o passo seguinte natural (entrada de 4.4 e 4.6) e reutilizam a regra de
  estados acima.
- Realtime, Broadcast e `createBrowserClient`.
- Última posição conhecida de tags em `acquiring`/`no_gps` (exigiria `last_fix_at` e
  colunas novas na view).
- Interpolação suave entre polls, modelos 3D e ícones por tipo de ativo, altitude (os
  firmwares descartam `alt`).
- Multilateração CS (exige 3 gateways).
- OEE, rota ótima, notificações e KPIs (4.4 a 4.7).
- Coordenadas da maquete ultrassônica na vista 3D.
- Migrar o periplus `web`/`dashboard` para o self-hosted.
- Licença não comercial do LocateAnything frente à tarefa 5.5.

## Perguntas em aberto

1. **(todas)** Quem é o responsável pelas entregas de software? Nenhum dos autores dos
   commits consta em [`team.md`](../organization/team.md). A coordenação aprova este
   roadmap?
2. **(Fase 0)** Onde rodam a bridge e a bancada? Isso define o `TAGS_DEMO_ORIGIN`.
3. **(Fase 1)** A coordenação aceita o deslocamento de demonstração em Preview (D5), ou o
   3D espera o piloto?
4. **(Fase 2)** Quem vê posições já está definido: só contas aprovadas por um admin. Falta
   decidir se os papéis (gestor, operador, visualizador) veem coisas diferentes.
5. **(Fase 4)** Quando acontece a visita técnica (1.1)? Quais ativos recebem as tags? A
   EMAP autoriza?
6. **(Fases 1 e 4)** Há uma data de demonstração (reunião T.3 com a EMAP, CIDESPORT) que
   deva virar prazo do M1 ou do piloto?
7. **(Fase 5)** O Channel Sounding entra em 2027? Quem mede a posição do gateway CS? O
   chip celular já tem saldo para o reteste?
8. **(geral)** Qual frescor o mapa exige? Este roadmap assume ≤ 10 s.

## Hipóteses e itens não verificados

- O tipo de `hdop`/`snr` no PostgREST v14.
- Se o Realtime atravessa o túnel (WSS) e quais são os limites de eventos do tenant
  self-hosted; só importa se D1 for revista.
- A bancada cair fora do recorte 3D e do `maxBounds` do 2D: depende de onde ela fica.
- Estado do Browser Integrity Check na zona `rynalde.com`, relevante só para a Fase 5b
  (o firmware celular não envia User-Agent).
- A meta de ≤ 10 s, os limiares de idade e os 15 min são propostas; nenhum documento do
  projeto define metas de campo para GNSS.
- As datas supõem uma pessoa dedicada; não há capacidade da equipe documentada.

Conferidos em 14/10/2026 contra o servidor, só com a chave publicável e sem gravar nada:
o Envoy aceita `Authorization: Bearer sb_publishable_…` (um `ingest` com chave inválida
chega à função e volta `28000`), `anon` lê `devices`, `readings` está vazia e HTTP na
porta 80 recebe `301` para HTTPS.
