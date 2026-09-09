# Itaqui Digital

Mapa interativo **2D** do Porto do Itaqui, em São Luís (MA), com Next.js, React e MapLibre GL JS. Interface em português, adaptada para desktop e celular.

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

## Ativar posições AIS

Crie uma chave em [AISStream](https://aisstream.io/), copie `.env.example` para `.env.local` e preencha:

```dotenv
AISSTREAM_API_KEY=sua_chave_privada
```

Reinicie o servidor e consulte o estado em **Fontes e dados**. O navegador consulta as posições a cada 5 segundos quando a integração está configurada. Posições com mais de 15 minutos são removidas.

Sem a chave, o mapa mostra somente posições aproximadas dos berços de navios da programação EMAP com registros recentes. Não são inventadas posições para navios fundeados ou esperados. A recepção de posições AIS reais depende da chave e da cobertura do provedor; ainda não foi validada com credenciais.

A conexão WebSocket AIS requer um processo Node.js persistente. Para múltiplas instâncias ou hospedagem serverless, use um coletor persistente e armazenamento compartilhado. Reiniciar o processo limpa o cache e aguarda novas mensagens.

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

Os testes cobrem extração da programação, validade das posições e mensagens AIS. A verificação no navegador cobre APIs, navegação 2D, camadas, busca, filtros de navios, detalhes, ajuda, falha do clima e layouts desktop e mobile. Capturas são gravadas em `test-results/`.

Para testar outra instância: `TEST_BASE_URL=http://localhost:3001 npm run test:browser`.
