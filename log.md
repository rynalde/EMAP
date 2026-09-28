# Changelog - OKF Knowledge Catalog

Este arquivo registra o histórico de atualizações estruturais e de conteúdo realizadas nesta base de conhecimento (OKF Bundle).

## [2026-07-11] - Inicialização da Base de Conhecimento
- Criação da estrutura de diretórios seguindo o padrão Google Open Knowledge Format (OKF v0.1).
- Integração do documento de proposta do projeto (IFMA Campus Santa Inês / EMAP).
- Elaboração do escopo, justificativa, equipe e cronograma original de 2 anos.
- Documentação das especificações e mapeamento de pinagem detalhado de todas as 4 placas de desenvolvimento sob pesquisa:
  1. LILYGO TTGO LoRa32 V2.1 & T3 V1.6.1
  2. Seeed Studio XIAO nRF54L15
  3. LILYGO TTGO Meshtastic T-Beam V1.2
  4. LILYGO TTGO SoftRF T-Echo
- Criação dos índices locais e templates de experimentos e arquitetura de software.

## [2026-09-09] - Integração do MVP `periplus` (firmware, backend e documentação)
- Importação do repositório `periplus` para `apps/periplus/`, contendo a implementação funcional dos três enlaces de rastreamento (LoRa, BLE Channel Sounding e celular) sobre um backend único.
- **Firmware das placas** (`apps/periplus/firmware/`): tag T-Beam (ESP32 + SX1276 + NEO-6M), gateway T-Echo (nRF52840 + SX1262), tag e gateway XIAO nRF54L15 (Zephyr/NCS), tag celular T-SIM7000G (SIM7000G) e autoteste de bring-up do T-Beam.
- **Backend** (`apps/periplus/supabase/`): migrations e seed do schema unificado `devices` / `readings` / `latest_positions`, com escrita exclusiva pela RPC `ingest`.
- **Bridge** (`apps/periplus/bridge/`): ponte TypeScript serial → Supabase para os gateways (Node 20+).
- **Interfaces** (`apps/periplus/web/`, `apps/periplus/dashboard/`): mapa Next.js + Leaflet e tabelas React + Vite.
- **Documentação técnica** (`apps/periplus/docs/`): arquitetura, hardware medido, pinagens confirmadas, formato de pacote, guias de setup, checklist de testes e troubleshooting.
- Criação de [`software/implementation.md`](software/implementation.md) como ponte OKF entre a arquitetura projetada e o código em execução.
- Segredos preservados fora do versionamento: apenas `config.example.h` e `.env.example` foram importados.

## [2026-09-09] - Integração da Tag Celular (T-SIM7000G)
- Documentação da quinta placa de desenvolvimento sob pesquisa: LILYGO TTGO T-SIM7000G (ESP32-WROVER-B + SIMCom SIM7000G), a única do projeto que dispensa gateway intermediário.
- Registro de três comportamentos de hardware levantados em bancada que condicionam o firmware: exclusividade mútua entre GNSS e dados celulares, PWRKEY como alternador de estado (e não como liga), e picos de corrente de ~2 A na transmissão.
- Novo experimento documentando o bring-up completo do backhaul celular, com isolamento camada a camada até a causa raiz: a rede da operadora restringe a anexação deste dispositivo a portas HTTP, bloqueando toda porta capaz de TLS.
- Inclusão da tabela de códigos de resultado do comando `AT+CAOPEN`, ausente dos manuais consultados e necessária para interpretar corretamente os diagnósticos do módulo.

## [2026-09-26] - Vista 3D low-poly do Porto do Itaqui (`itaqui-digital`)
- Nova rota `/3d` no app [`apps/itaqui-digital`](apps/itaqui-digital/README.md#vista-3d), acessível pelo botão **3D** do mapa: representação low-poly do porto em three.js, no estilo de pacotes portuários comerciais, com todos os modelos gerados em código (sem assets de terceiros).
- Geometria real: linha de costa, perímetro, vias, ferrovias, edificações e tanques do OpenStreetMap; face do cais de cada berço alinhada à costa mapeada.
- Navios atracados da programação EMAP, com a mesma regra de validade do mapa 2D (berço conhecido e registro de até 7 dias); tipo do navio inferido da carga e identificado como ilustrativo.
- Guindastes, pátios de contêineres, silos do TEGRAM, tanques adicionais, correia, dutos e veículos são cenografia ilustrativa, declarada na interface e no README.

## [2026-09-27] - Vista 3D ajustada à imagem de satélite e à cobertura do solo
- A vista `/3d` do [`itaqui-digital`](apps/itaqui-digital/README.md#estruturas-posicionadas-por-imagem-de-satélite) deixa de preencher o porto com pátios aleatórios e passa a posicionar as estruturas reais vistas na imagem Esri World Imagery (Vantor WorldView-3, 06/05/2023): os quatro armazéns do TEGRAM, os galpões vizinhos, o armazém de cobertura salmão, cerca de 130 tanques nos parques de tancagem, as correias da retroárea e a ponte de acesso com plataformas e dolfins dos berços 106 e 108.
- Tanques detectados com o modelo NVIDIA LocateAnything-3B (licença para pesquisa acadêmica), executado localmente sobre recortes da imagem e revisado; demais estruturas lidas sobre a imagem com grade de coordenadas.
- Entorno desenhado a partir do ESA WorldCover 10 m (2021, CC BY 4.0): manguezais, matas e áreas construídas, com dossel facetado e água livre diante dos berços.

## [2026-09-28] - Tag celular (T-SIM7000G): bancada contra Supabase local
- Nova rodada do [experimento de backhaul celular](experiments/backhaul_celular_lte.md#atualização-280926-a-resposta-na-porta-80-é-da-operadora) contra um Supabase local exposto por túnel `cloudflared` na porta 80.
- A resposta recebida pela placa era um `302` da própria operadora para o portal de recarga (`portalrecarga.vivo.com.br`): o chip estava sem saldo. É o mesmo padrão de portas que fundamentou a conclusão anterior, que passa a exigir novo teste com saldo confirmado.
- Cinco defeitos de firmware corrigidos: reanexação à rede após `AT+CGATT=0`, requisição HTTP fragmentada em dezenas de `AT+CASEND`, pulso incondicional do PWRKEY, antena GNSS ativa sem alimentação (`AT+SGPIO`) e log `sats=0/0` que não media satélites visíveis.
- Firmware passa a aceitar HTTP na porta 80 (`SUPABASE_TLS 0`) para testes de bancada; o padrão continua HTTPS na 443.
