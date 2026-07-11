---
type: hardware
title: "LILYGO TTGO Meshtastic T-Beam V1.2"
description: "Placa baseada em ESP32 com rádio LoRa SX1276/78, receptor GPS NEO-6M e unidade de gerenciamento de energia AXP2101."
timestamp: 2026-07-11T18:37:00Z
tags: [hardware, esp32, lora, gps, neo-6m, meshtastic]
---

# LILYGO TTGO Meshtastic T-Beam V1.2

A LILYGO TTGO T-Beam V1.2 é uma das placas mais populares para o desenvolvimento de nós de comunicação de longo alcance descentralizados, amplamente empregada no ecossistema do firmware de rede mesh de código aberto **Meshtastic**. 

## Especificações Técnicas Centrais

*   **Microcontrolador (MCU)**: ESP32-D0WDQ6-V3 (Processador Dual-Core Xtensa® de 32 bits rodando a 240 MHz).
*   **Memória Adicional**: 4 MB Flash + 8 MB de PSRAM (RAM Pseudo-estática para lidar com grandes buffers de rede).
*   **Transceptor LoRa**: Semtech SX1276 (para bandas de 868/915/923 MHz) ou SX1278 (para 433 MHz).
*   **Módulo de Posicionamento Global (GNSS)**: u-Blox NEO-6M com antena cerâmica dedicada montada na placa (receptores NEO-M8N podem estar presentes em lotes de hardware específicos).
*   **Unidade de Gerenciamento de Energia (PMU)**: **AXP2101** (substitui o chip AXP192 das versões V1.0/V1.1, otimizando o consumo dinâmico e o controle de carga da bateria).
*   **Conectividade**: Wi-Fi 802.11 b/g/n, Bluetooth v4.2 / BLE.
*   **Conversor USB-Serial**: Chip CH9102.
*   **Display de Informações**: Suporte nativo e furação para telas OLED SSD1306 de 0.96 polegadas (128x64 pixels).
*   **Alimentação Física**: Suporte onboard traseiro para uma bateria de íons de Lítio formato **18650**. Conector micro-USB para recarga e comunicação.
*   **Botões Físicos**: 
    1.  Botão de Power (controlado diretamente pelo PMU AXP2101).
    2.  Botão de Reset.
    3.  Botão de função do usuário conectado ao pino GPIO 38.

---

## Mapeamento de Pinos Fixo (Onboard)

Devido às conexões pré-estabelecidas no circuito impresso (PCB) da T-Beam, os pinos internos do ESP32 estão roteados de forma fixa para os periféricos principais:

### Conexão do Rádio LoRa (Semtech SX127x)
O chip LoRa se comunica via barramento SPI interno:

| Função | GPIO Pin | Descrição |
| :--- | :---: | :--- |
| **SPI SCK** | GPIO 5 | Clock SPI compartilhado |
| **SPI MOSI** | GPIO 27 | MOSI SPI compartilhado |
| **SPI MISO** | GPIO 19 | MISO SPI compartilhado |
| **CS / SS** | GPIO 18 | Chip Select do LoRa |
| **Reset (RST)** | GPIO 23 | Reset do chip de rádio |
| **DIO0** | GPIO 26 | Linha de Interrupção LoRa Rx/Tx |
| **DIO1** | GPIO 33 | Usado para controle de estado LoRa |
| **DIO2** | GPIO 32 | Linha auxiliar de dados de rádio |

### Conexão do GPS (u-Blox NEO-6M / M8N)
O receptor GPS se comunica com o ESP32 por meio de uma interface serial UART secundária:

| Função | GPIO Pin | Descrição |
| :--- | :---: | :--- |
| **GPS TXD** | GPIO 34 | Conectado ao pino RX do ESP32 (somente entrada) |
| **GPS RXD** | GPIO 12 | Conectado ao pino TX do ESP32 (saída de comandos) |
| **PPS** | GPIO 37 | Pulso por segundo do GPS (usado para sincronismo de relógio de precisão) |

### Conexão do PMU (AXP2101 - I2C)
O gerenciador de energia é controlado pelo ESP32 via barramento I2C compartilhado:

| Função | GPIO Pin | Descrição |
| :--- | :---: | :--- |
| **SDA (PMU/OLED)**| GPIO 21 | Linha de Dados I2C |
| **SCL (PMU/OLED)**| GPIO 22 | Linha de Clock I2C |
| **PMU IRQ** | GPIO 35 | Interrupção do PMU (indica queda de energia, bateria fraca, etc.) |

---

## Nota de Compatibilidade de Código (AXP2101)

> [!IMPORTANT]
> **Diferença de PMU (AXP192 vs AXP2101)**: Versões anteriores da T-Beam (V1.0 e V1.1) utilizavam o chip de energia AXP192. A T-Beam V1.2 utiliza o **AXP2101**. 
> Se você compilar códigos antigos que chamam rotinas da biblioteca `axp192.h` ou declaram endereços I2C do AXP192, a placa não ativará as saídas de tensão para o GPS e para o rádio LoRa, resultando em falhas de comunicação. Certifique-se de atualizar o firmware (ex: Meshtastic v2.x+) ou usar bibliotecas compatíveis como `XPowersLib`.
