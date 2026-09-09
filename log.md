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
