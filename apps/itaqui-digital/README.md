# Itaqui Digital

Mapa interativo **2D** do Porto do Itaqui, em São Luís (MA), com Next.js, React e MapLibre GL JS, e uma **vista 3D low-poly** do porto em three.js. Interface em português, adaptada para desktop e celular.

## Executar

Requer Node.js 22 ou superior e conexão com a internet.

```bash
npm ci
npm run dev
```

Antes, copie `.env.example` para `.env.local` (contém as variáveis do Supabase; veja [Autenticação](#autenticação)). Abra [localhost:3000](http://localhost:3000) e entre com sua conta. Para produção, execute `npm run build` e `npm start`.

## Recursos

- Mapa de satélite ou cartográfico, com deslocamento, zoom, centralização e tela cheia.
- Nove berços selecionáveis, terminais e pontos de acesso, com busca e painel de detalhes.
- Camadas de edifícios, vias, ferrovias e áreas limitadas ao polígono do Porto do Itaqui no OpenStreetMap; edifícios externos excluídos e vias recortadas no perímetro.
- Modelos de embarcações ilustrativos, com assets Kenney CC0 e navio-tanque do projeto. Navios AIS dos arredores permanecem disponíveis na vista da baía.
- Marés, correntes e temperatura da água via Open-Meteo Marine, com gráfico de 48 horas e referência MSL.
- Clima atual e previsão horária Open-Meteo, atualizados a cada 10 minutos.
- Programação pública EMAP, consultada a cada 5 minutos, com navios atracados, fundeados e esperados.
- Documentos e páginas oficiais do porto acessíveis pelo painel de fontes.
- Integração AISStream preparada no servidor, sem expor a chave ao navegador.

## Vista 3D

Abra [localhost:3000/3d](http://localhost:3000/3d) ou use o botão **3D** no cabeçalho do mapa. A cena segue o estilo low-poly de pacotes portuários comerciais (cores chapadas, cais de concreto, guindastes amarelos, azuis e verdes), mas todos os modelos são gerados em código, sem assets de terceiros.

| Elemento                                                                             | Origem                                                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Linha de costa, perímetro, vias e ferrovias                                          | OpenStreetMap (os mesmos arquivos de `public/data`)                                                       |
| Vegetação, manguezais, solo exposto e áreas construídas do entorno                   | [ESA WorldCover](https://esa-worldcover.org/) 10 m (2021), em `public/data/port-landcover.png`            |
| Tanques, armazéns do TEGRAM e demais galpões, correias e píeres dos berços 106 e 108 | Posicionados sobre imagem de satélite de 06/05/2023 (ver abaixo), em `src/lib/port3d/reference-data.json` |
| Berços                                                                               | Referências EMAP; a face do cais é alinhada à linha de costa do OSM                                       |
| Navios atracados                                                                     | Programação EMAP, com a mesma regra do mapa 2D: só berço conhecido e registro de até 7 dias               |
| Guindastes, veículos, trens e modelos dos navios                                     | Ilustrativos                                                                                              |

O tipo de cada navio é inferido da carga e não reproduz a aparência real da embarcação. O botão de navio preenche os berços livres com navios **ilustrativos**, identificados como tal no rótulo e nos detalhes. O fechamento do continente a leste, fora do recorte do OSM, é aproximado.

### Estruturas posicionadas por imagem de satélite

A referência é a imagem Esri World Imagery do porto (Vantor WorldView-3, 31 cm, capturada em 06/05/2023), a mesma camada de satélite do mapa 2D. Os tanques foram detectados com o modelo [NVIDIA LocateAnything-3B](https://huggingface.co/nvidia/LocateAnything-3B) (licença NVIDIA para pesquisa acadêmica, sem uso comercial), rodado localmente sobre recortes da imagem, e conferidos visualmente; reservatórios escuros e tanques não detectados foram marcados à mão. Armazéns, correias e píeres foram lidos sobre a imagem com grade de coordenadas. As posições têm erro de 5 a 10 m e as alturas são estimadas; não são levantamento topográfico nem cadastro oficial. Estruturas construídas depois de maio de 2023 não aparecem.

A cobertura do solo do ESA WorldCover (CC BY 4.0) define as manchas de mata e manguezal, desenhadas como dossel facetado, e a cor do chão no entorno. Dentro do perímetro do porto, o que não é vegetação é desenhado como pavimento.

Atribuições: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium; imagem de referência Esri, Vantor; © contribuidores do OpenStreetMap.

### Navegação e código

Arraste para girar, use o botão direito ou dois dedos para deslocar e role para aproximar. Os atalhos na base aproximam cada berço, o TEGRAM e o parque de tancagem; clique em um navio para ver nome, carga e data do registro EMAP. O botão de avião faz um sobrevoo guiado de um minuto pelo cais, píeres, TEGRAM e tancagem; arrastar a cena ou escolher um atalho o interrompe.

Vias e ferrovias do OSM são suavizadas (Chaikin) sem mover cruzamentos e emendas, e desenhadas como faixas contínuas com juntas em meia-esquadria; caminhões, trens e a portaria seguem as mesmas linhas suavizadas.

O código fica em `src/lib/port3d/`: `geo.ts` (projeção local em metros), `layout.ts` (costa, berços e posição dos navios), `terrain.ts` (relevo e cores a partir do WorldCover), `roads.ts` (suavização e faixas de vias e trilhos), `reference.ts` (estruturas posicionadas pela imagem), `kit.ts` (peças com cor por vértice fundidas em poucas malhas), `models.ts` (modelos procedurais) e `scene.ts` (montagem, câmera e interação).

## Ativar posições AIS

Crie uma chave em [AISStream](https://aisstream.io/), copie `.env.example` para `.env.local` e preencha:

```dotenv
AISSTREAM_API_KEY=sua_chave_privada
```

Reinicie o servidor e consulte o estado em **Fontes e dados**. O navegador consulta as posições a cada 5 segundos quando a integração está configurada. Posições com mais de 15 minutos são removidas.

Sem a chave, o mapa mostra somente posições aproximadas dos berços de navios da programação EMAP com registros recentes. Não são inventadas posições para navios fundeados ou esperados. A recepção de posições AIS reais depende da chave e da cobertura do provedor; ainda não foi validada com credenciais.

A conexão WebSocket AIS requer um processo Node.js persistente. Para múltiplas instâncias ou hospedagem serverless, use um coletor persistente e armazenamento compartilhado. Reiniciar o processo limpa o cache e aguarda novas mensagens.

## Autenticação

Todo o app exige login **e conta aprovada por um administrador**. O backend é o Supabase próprio em `https://emap.rynalde.com`, documentado em [infra/supabase](../../infra/supabase/README.md). Confirmação de e-mail é obrigatória, a senha tem no mínimo 8 caracteres e os links de e-mail valem 1 hora.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://emap.rynalde.com
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
RESEND_API_KEY=re_...   # só servidor: e-mail de conta aprovada
```

A chave publicável é pública por definição; o app não usa nem deve receber chave secreta (`service_role`). Sem as duas variáveis do Supabase, toda requisição falha com uma mensagem indicando o que falta.

| Rota               | Função                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| `/login`           | E-mail e senha; volta para `?next=` (só caminhos internos)                        |
| `/cadastro`        | Nome, e-mail e senha; envia o link de confirmação                                 |
| `/verificar-email` | Aviso de e-mail enviado e reenvio (um por minuto)                                 |
| `/esqueci-senha`   | Pede o link de redefinição, com a mesma resposta exista ou não a conta            |
| `/redefinir-senha` | Nova senha; exige sessão (link de recuperação ou convite, ou usuário logado)      |
| `/auth/confirm`    | Destino dos links de e-mail; o token só é usado ao clicar em **Continuar** (POST) |

| Rota (com sessão)       | Função                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `/aguardando-aprovacao` | Aviso para contas pendentes, rejeitadas ou bloqueadas; **Verificar novamente** e **Sair** |
| `/admin`                | Só administradores aprovados: usuários, papéis e configurações de cadastro                |

O token só é consumido no POST porque filtros de link corporativos (como o Microsoft Safe Links) abrem o GET antes do usuário. O botão **Sair** fica nos cabeçalhos do mapa e da vista 3D.

Como funciona o bloqueio:

- `src/proxy.ts` renova a sessão em cada requisição, manda páginas sem login para `/login?next=…` e responde `401 {"error":"Não autenticado"}` em `/api/*`. Ficam livres as telas de login, `/auth/*`, os internos do Next e os arquivos de `public/data` e `public/models`.
- Links de e-mail que chegam a outro caminho com `token_hash` e `type` (o GoTrue usa a raiz do `SITE_URL` quando o redirect não está liberado) são encaminhados para `/auth/confirm`.
- Para quem tem sessão, o proxy lê o `status` em `public.profiles` a cada requisição: só `aprovado` passa. Os demais vão para `/aguardando-aprovacao` e recebem `403 {"error":"Acesso pendente de aprovação"}` em `/api/*`; bloqueio e rejeição valem na requisição seguinte.
- O layout de `src/app/(app)/` verifica de novo, no servidor, sessão e aprovação antes de renderizar o mapa, a vista 3D e o `/admin`.

### Aprovação, papéis e administração

Todo cadastro novo cria uma linha em `public.profiles` (gatilho no `auth.users`) com status `pendente` e o papel padrão. Os papéis são `admin`, `gestor`, `operador` e `visualizador`; por enquanto só `admin` muda o que o app mostra (o link **Admin** com a contagem de pendentes no menu da conta). Os status são `pendente`, `aprovado`, `rejeitado` e `bloqueado`.

Em `/admin` o administrador filtra por status (`?status=`) e busca por nome ou e-mail (`?q=`), aprova ou rejeita pendentes, bloqueia aprovados, reativa rejeitados e bloqueados e troca o papel. Aprovar e Reativar só aparecem depois que a pessoa confirma o e-mail; o papel escolhido na linha vai junto com a ação. A própria conta não tem ações, e o banco recusa qualquer mudança que deixe o sistema sem administrador aprovado. Rejeitar ou bloquear encerra as sessões da pessoa. As configurações (linha única de `public.app_settings`) são:

- **Cadastro aberto**: fechado, o hook `before-user-created` do GoTrue recusa contas novas e o envio de `/cadastro` responde "Os cadastros estão fechados no momento.";
- **Aprovação obrigatória**: desligada, contas novas já entram aprovadas;
- **Papel padrão** das contas novas (nunca Administrador);
- **Domínios aprovados automaticamente** (ex.: `emap.ma.gov.br`): e-mails desses domínios dispensam a aprovação.

O app só lê e escreve por RLS e por funções SQL `security definer` que conferem se quem chama é administrador; a migration está em `supabase/migrations/20261014180000_user_approval_admin.sql` e os testes SQL em `supabase/tests/user_approval_admin.sql`.

Ao aprovar ou reativar alguém, o servidor do app envia "Sua conta no Itaqui Digital foi aprovada" pela API do Resend, com link fixo para `https://itaqui-digital.vercel.app/login` (o `SITE_URL`), qualquer que seja a origem do administrador. **Configure `RESEND_API_KEY` na Vercel** (Production e Preview, nunca com prefixo `NEXT_PUBLIC_`); sem ela, ou se o Resend falhar, a aprovação vale do mesmo jeito e a tela avisa "aprovado, mas o e-mail de aviso não foi enviado".

O primeiro administrador é promovido à mão, depois de se cadastrar e confirmar o e-mail (SQL Editor do Studio ou `psql` no servidor):

```sql
update public.profiles set role = 'admin', status = 'aprovado' where email = '<e-mail>';
```

Os links de e-mail só funcionam em origens liberadas no servidor: `http://localhost:3000` e `https://itaqui-digital.vercel.app`. As prévias da Vercel não são liberadas (qualquer pessoa registra um `itaqui-digital-*.vercel.app`): os links pedidos nelas caem no `SITE_URL` de produção, e o proxy os leva para `/auth/confirm`. Rode o desenvolvimento na porta 3000.

## Publicar na Vercel

O diretório raiz do projeto na Vercel é `apps/itaqui-digital`. O arquivo `vercel.json` já define o framework, a região `gru1` (São Paulo), o limite de 20 segundos para as rotas em `src/app/api` — acima dos 12 segundos de espera pelas fontes externas — e ignora o build dos commits que não tocam este diretório.

Configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` em Production e Preview; sem elas nenhuma página abre (veja [Autenticação](#autenticação)). Configure também `RESEND_API_KEY` para o e-mail de conta aprovada. Mapa, clima, marés e programação EMAP continuam usando somente fontes públicas.

**Não configure `AISSTREAM_API_KEY` na Vercel.** A integração AIS depende de um WebSocket persistente e de memória compartilhada entre requisições, o que não existe em funções serverless: cada instância reconecta do zero e devolve a lista vazia. Para posições AIS reais, mantenha um coletor persistente próprio, conforme [Ativar posições AIS](#ativar-posições-ais).

O `output: "standalone"` continua ativo fora da Vercel, para hospedagem própria e imagens Docker.

## Origem dos dados

| Informação                   | Fonte                                        | Observação                                  |
| ---------------------------- | -------------------------------------------- | ------------------------------------------- |
| Satélite                     | Esri World Imagery                           | Imagens históricas                          |
| Cartografia                  | OpenStreetMap                                | Cobertura variável                          |
| Berços e pontos de interesse | Referências EMAP e interpretação de satélite | Coordenadas aproximadas                     |
| Características dos berços   | Tabela EMAP de 2023                          | Consultar condições vigentes                |
| Programação de navios        | Tabela pública EMAP                          | Programação administrativa, não posição AIS |
| Clima                        | Open-Meteo                                   | Estimativa meteorológica por modelo         |
| Posições AIS                 | AISStream após configuração                  | Depende de cobertura e disponibilidade      |

A data da fonte aparece nos detalhes dos navios. Registros EMAP acima de 7 dias ficam marcados como antigos e não recebem posição no mapa. Quando a fonte está indisponível, a consulta arquivada é identificada e exibida sem posições.

## Fontes

- [EMAP — Porto Agora](https://website.portodoitaqui.com.br/home#porto-agora)
- [EMAP — Programação de navios](https://www.portodoitaqui.com.br/porto-agora/navios/atracados)
- [EMAP — Infraestrutura](https://website.portodoitaqui.com.br/porto-itaqui/infraestrutura)
- [EMAP — Características dos berços (2023)](https://www.portodoitaqui.com/img/fotos/emap/bercos/bercos-planta-2023.jpg)
- [Open-Meteo — documentação](https://open-meteo.com/en/docs)
- [AISStream — documentação](https://aisstream.io/documentation)
- [OpenStreetMap — licença](https://www.openstreetmap.org/copyright)
- [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer)

## Verificação

```bash
npm run typecheck
npm test
npm run build
# Com o servidor iniciado, Google Chrome instalado e uma conta confirmada e aprovada:
TEST_EMAIL=voce@exemplo.com TEST_PASSWORD=... npm run test:browser
```

Os testes cobrem o filtro de `?next=`, as mensagens de erro de login e de cadastro fechado, a lista de domínios, as mensagens de aprovação e o e-mail de conta aprovada, extração da programação, validade das posições e mensagens AIS, além da projeção e do alinhamento dos berços da vista 3D. A verificação no navegador entra por `/login` (sem `TEST_EMAIL` e `TEST_PASSWORD` ela é pulada) e cobre APIs, navegação 2D, camadas, busca, filtros de navios, detalhes, ajuda, falha do clima, a vista 3D e layouts desktop e mobile. Capturas são gravadas em `test-results/`.

Para testar outra instância: `TEST_BASE_URL=http://localhost:3001 npm run test:browser`.
