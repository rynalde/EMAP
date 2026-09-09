---
type: software
title: "Implementação de Referência — periplus"
description: "MVP funcional com firmware das placas, backend Supabase e bridge serial; mapeia a arquitetura teórica ao código em apps/periplus."
timestamp: 2026-09-09T00:00:00Z
tags: [software, firmware, backend, supabase, lora, ble, cellular, implementation]
---

# Implementação de Referência — `periplus`

Enquanto [`system_architecture.md`](system_architecture.md) descreve a arquitetura
**projetada** do sistema, este documento aponta para a implementação **em
funcionamento**, versionada em [`apps/periplus/`](../apps/periplus/README.md).

O `periplus` é o MVP que comprova o caminho de dados ponta a ponta: um
dispositivo relata onde está (ou a que distância está) por qualquer um de três
rádios, e o dado chega ao backend por um único caminho de escrita.

## Os três enlaces, um backend

| | **Tag LoRa** (T-Beam) | **Tag CS** (XIAO nRF54L15) | **Tag Celular** (T-SIM7000G) |
| :--- | :--- | :--- | :--- |
| Sabe a própria posição | Sim, por GNSS | **Não** — apenas é medida | Sim, por GNSS do modem |
| Reporta | Posição (`lat`/`lng`) | Distância (`distance_m`) | Posição (`lat`/`lng`) |
| Precisa de gateway | Sim (T-Echo) | Sim (XIAO gateway) | Não — fala direto com o backend |
| Transporte até o backend | Serial USB → bridge | Serial USB → bridge | HTTPS sobre LTE CAT-M / NB-IoT |

Os três escrevem pela mesma RPC nas mesmas duas tabelas. *Como* o dado chegou à
rede é um atributo, não um schema separado.

## Modelo de dados

| Objeto | Papel |
| :--- | :--- |
| `devices` | toda tag **e** todo gateway, uma linha cada. `kind` = o que é (`tag`/`gateway`), `link` = como fala (`lora`/`ble_cs`/`cellular`) |
| `readings` | uma linha por observação. `reported_by` é nulo em auto-relato e nomeia o gateway quando o relato é retransmitido |
| `latest_positions` | a view que todo cliente lê: leitura mais recente por dispositivo |
| `ingest(key, payload)` | o único caminho de escrita |
| `register_device(...)` | emite a chave de ingestão. Retorna uma vez; apenas o hash é armazenado |

## Mapa do código

| Componente | Tecnologia | Diretório |
| :--- | :--- | :--- |
| Firmware tag LoRa | Arduino / ESP32 / RadioLib / TinyGPSPlus / U8g2 | [`firmware/tbeam-tag`](../apps/periplus/firmware/tbeam-tag/README.md) |
| Firmware gateway LoRa | Arduino / nRF52 / RadioLib / GxEPD2 | [`firmware/techo-gateway`](../apps/periplus/firmware/techo-gateway/README.md) |
| Firmware tag CS | Zephyr / nRF Connect SDK | [`firmware/xiao-cs-tag`](../apps/periplus/firmware/xiao-cs-tag/README.md) |
| Firmware gateway CS | Zephyr / nRF Connect SDK | [`firmware/xiao-cs-gateway`](../apps/periplus/firmware/xiao-cs-gateway/README.md) |
| Firmware tag celular | Arduino / ESP32 / TinyGSM | [`firmware/tsim7000g-tag`](../apps/periplus/firmware/tsim7000g-tag/README.md) |
| Autoteste de hardware | Arduino / ESP32 — diagnóstico de bring-up | [`firmware/tbeam-selftest`](../apps/periplus/firmware/tbeam-selftest/README.md) |
| Bridge serial → backend | TypeScript + zod + serialport (Node) | [`bridge`](../apps/periplus/bridge/README.md) |
| Backend | Supabase (Postgres) — migrations e seed | [`supabase`](../apps/periplus/supabase/README.md) |
| Mapa | Next.js + React Leaflet | [`web`](../apps/periplus/web/README.md) |
| Tabelas | React + Vite | [`dashboard`](../apps/periplus/dashboard/README.md) |

## Documentação técnica

| Documento | Conteúdo |
| :--- | :--- |
| [`architecture.md`](../apps/periplus/docs/architecture.md) | Fluxo de dados, modelo de duas tabelas, caminho único de escrita |
| [`hardware.md`](../apps/periplus/docs/hardware.md) | Valores **medidos** nas unidades reais, não lidos de datasheet |
| [`pinout.md`](../apps/periplus/docs/pinout.md) | Pinagens confirmadas nas placas físicas durante o bring-up |
| [`packet-format.md`](../apps/periplus/docs/packet-format.md) | Formato do pacote: uma forma para todo dispositivo |
| [`setup-supabase.md`](../apps/periplus/docs/setup-supabase.md) | Aplicação das migrations e configuração do backend |
| [`setup-bridge.md`](../apps/periplus/docs/setup-bridge.md) | Bridge serial (exige Node 20+; Bun não carrega `serialport`) |
| [`setup-arduino.md`](../apps/periplus/docs/setup-arduino.md) | Build e gravação dos sketches ESP32 / nRF52 |
| [`setup-cs-firmware.md`](../apps/periplus/docs/setup-cs-firmware.md) | Build Zephyr / NCS das duas placas XIAO |
| [`testing-checklist.md`](../apps/periplus/docs/testing-checklist.md) | Checklist de validação, de segurança de antena ao dado no banco |
| [`troubleshooting.md`](../apps/periplus/docs/troubleshooting.md) | Falhas reais encontradas no bring-up e suas causas |

## Estado de validação

Medido ponta a ponta com duas tags LoRa a 3 s de intervalo:
**59 enviados / 59 recebidos / 0 erros de CRC**.

| Placa | Papel | Bring-up verificado |
| :--- | :--- | :--- |
| LILYGO T-Beam V1.2 (AXP2101) ×2 | tag GPS, LoRa SX1276 @923 MHz | **Sim** |
| LILYGO T-Echo | gateway LoRa, SX1262 @923 MHz | **Sim** |
| Seeed XIAO nRF54L15 ×2 | tag e gateway BLE Channel Sounding | Ainda não |
| LILYGO T-SIM7000G | tag celular LTE CAT-M / NB-IoT | Ainda não |

> ⚠️ **Segurança de antena:** nunca transmita LoRa sem a antena conectada.
> Conecte a antena **antes** de energizar a placa, sob risco de danificar o
> rádio. O T-SIM7000G exige **duas** antenas — LTE e GNSS.

## Convenções de segredos

Chaves reais nunca são versionadas. Cada firmware traz um `config.example.h`
para ser copiado como `config.h` (ignorado pelo git), e os serviços usam
`.env.example` como modelo. Consulte [`setup-supabase.md`](../apps/periplus/docs/setup-supabase.md).

## Relação com o hardware documentado

As placas usadas aqui são as mesmas especificadas em
[`hardware/index.md`](../hardware/index.md) — este documento descreve o que
efetivamente roda nelas.
