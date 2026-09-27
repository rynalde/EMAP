# Itaqui Digital

Mapa interativo **2D** do Porto do Itaqui, em São Luís (MA), com Next.js, React e MapLibre GL JS, e uma **vista 3D low-poly** do porto em three.js. Interface em português, adaptada para desktop e celular.

## Executar

Requer Node.js 22 ou superior e conexão com a internet.

```bash
npm ci
npm run dev
```

Abra [localhost:3000](http://localhost:3000). Para produção, execute `npm run build` e `npm start`.

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

Arraste para girar, use o botão direito ou dois dedos para deslocar e role para aproximar. Os atalhos na base aproximam cada berço, o TEGRAM e o parque de tancagem; clique em um navio para ver nome, carga e data do registro EMAP.

O código fica em `src/lib/port3d/`: `geo.ts` (projeção local em metros), `layout.ts` (costa, berços e posição dos navios), `terrain.ts` (relevo e cores a partir do WorldCover), `reference.ts` (estruturas posicionadas pela imagem), `kit.ts` (peças com cor por vértice fundidas em poucas malhas), `models.ts` (modelos procedurais) e `scene.ts` (montagem, câmera e interação).

## Ativar posições AIS

Crie uma chave em [AISStream](https://aisstream.io/), copie `.env.example` para `.env.local` e preencha:

```dotenv
AISSTREAM_API_KEY=sua_chave_privada
```

Reinicie o servidor e consulte o estado em **Fontes e dados**. O navegador consulta as posições a cada 5 segundos quando a integração está configurada. Posições com mais de 15 minutos são removidas.

Sem a chave, o mapa mostra somente posições aproximadas dos berços de navios da programação EMAP com registros recentes. Não são inventadas posições para navios fundeados ou esperados. A recepção de posições AIS reais depende da chave e da cobertura do provedor; ainda não foi validada com credenciais.

A conexão WebSocket AIS requer um processo Node.js persistente. Para múltiplas instâncias ou hospedagem serverless, use um coletor persistente e armazenamento compartilhado. Reiniciar o processo limpa o cache e aguarda novas mensagens.

## Publicar na Vercel

O diretório raiz do projeto na Vercel é `apps/itaqui-digital`. O arquivo `vercel.json` já define o framework, a região `gru1` (São Paulo), o limite de 20 segundos para as rotas em `src/app/api` — acima dos 12 segundos de espera pelas fontes externas — e ignora o build dos commits que não tocam este diretório.

Nenhuma variável de ambiente é obrigatória. Mapa, clima, marés e programação EMAP funcionam somente com as fontes públicas.

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
# Com o servidor iniciado e Google Chrome instalado:
npm run test:browser
```

Os testes cobrem extração da programação, validade das posições e mensagens AIS, além da projeção e do alinhamento dos berços da vista 3D. A verificação no navegador cobre APIs, navegação 2D, camadas, busca, filtros de navios, detalhes, ajuda, falha do clima, a vista 3D e layouts desktop e mobile. Capturas são gravadas em `test-results/`.

Para testar outra instância: `TEST_BASE_URL=http://localhost:3001 npm run test:browser`.
