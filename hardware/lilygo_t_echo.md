---
type: hardware
title: "LILYGO TTGO SoftRF T-Echo"
description: "Placa ultra-eficiente baseada no SoC Nordic nRF52840 com transceptor LoRa SX1262, tela e-paper de 1.54 polegadas e GPS."
timestamp: 2026-07-11T18:37:00Z
tags: [hardware, nrf52840, lora, sx1262, e-paper, softrf]
---

# LILYGO TTGO SoftRF T-Echo

A LILYGO T-Echo é uma placa de desenvolvimento portátil de baixíssimo consumo energético, idealizada originalmente para projetos como SoftRF e Meshtastic. Ela une a excelente autonomia do microcontrolador Nordic nRF52840 com a eficiência de transmissão de rádio do chip Semtech SX1262 e uma tela e-paper que mantém a imagem exibida sem consumir energia.

## Especificações Técnicas Centrais

*   **Microcontrolador (MCU)**: Nordic Semiconductor nRF52840 (Arquitetura ARM® Cortex®-M4F de 32 bits, operando a 64 MHz).
*   **Memória**: 2 MB Flash (dependendo da revisão de mercado, o chip expõe 1 MB Flash interna e 256 KB de RAM).
*   **Transceptor LoRa**: Semtech SX1262 (altamente eficiente, consumo menor de corrente em transmissão e recepção comparado ao SX1276).
*   **Frequências Suportadas**: 433 MHz, 868 MHz ou 915 MHz.
*   **Receptor de Posicionamento Global (GNSS)**: Módulo Quectel L76K de constelação múltipla (GPS, GLONASS, BeiDou, QZSS) com antena ativa integrada.
*   **Display de Informações**: Tela E-Paper monocromática de 1.54 polegadas baseada no controlador SSD1680 (Resolução de 200x200 pixels).
*   **Conectividade**: Bluetooth 5.0 (BLE), suporte a Thread, Zigbee, ANT e protocolos de rede sem fio de 2.4 GHz.
*   **Sensores Integrados**: Opção de sensor ambiental Bosch BME280 (medição de Temperatura, Umidade relativa do ar e Pressão barométrica) conectado via barramento I2C.
*   **Bateria Incorporada**: Bateria recarregável Li-Po integrada de 850 mAh (conector MX 1.25mm) com circuito integrado de controle e recarga USB-C.
*   **Interface Física**: Porta USB Tipo-C para carregamento de bateria e transferência de firmware, botão Reset de clique duplo para ativação do bootloader DFU, e conector externo JST SH de 10 pinos para expansão.

---

## Mapeamento de Pinos Onboard

A tabela abaixo descreve as conexões lógicas internas entre o SoC nRF52840 e os periféricos onboard, facilitando a customização de firmwares no framework Arduino ou SDK nRF Connect:

| Periférico | Função de Hardware | Pino Físico do SoC (Port.Pin) | Mapeamento no Arduino |
| :--- | :--- | :---: | :---: |
| **Display E-Paper** | SPI MOSI | P1.06 | 36 |
| **Display E-Paper** | SPI MISO | P0.29 | 29 |
| **Display E-Paper** | SPI SCLK | P0.31 | 31 |
| **Display E-Paper** | Chip Select (CS) | P0.30 | 30 |
| **Display E-Paper** | Data/Command (D/C) | P0.28 | 28 |
| **Display E-Paper** | Reset (RST) | P0.02 | 2 |
| **Display E-Paper** | Monitor de Ocupado (BUSY) | P0.03 | 3 |
| **Display E-Paper** | Controle de Luz de Fundo (Backlight) | P1.11 | 43 |
| **Barramento I2C (BME280)** | I2C SDA | P0.26 | 26 |
| **Barramento I2C (BME280)** | I2C SCL | P0.27 | 27 |
| **Rádio LoRa (SX1262)** | SPI MISO | P0.23 | 23 |
| **Rádio LoRa (SX1262)** | SPI MOSI | P0.22 | 22 |
| **Rádio LoRa (SX1262)** | SPI SCLK | P0.19 | 19 |
| **Rádio LoRa (SX1262)** | Chip Select (CS) | P0.24 | 24 |
| **Rádio LoRa (SX1262)** | Reset (RST) | P0.25 | 25 |
| **Rádio LoRa (SX1262)** | Busy (Monitor de atividade RF) | P1.10 | 42 |
| **Rádio LoRa (SX1262)** | DIO1 (Interrupção de RF) | P0.20 | 20 |
| **Receptor GPS (L76K)** | GPS UART TX | P0.14 | 14 |
| **Receptor GPS (L76K)** | GPS UART RX | P0.13 | 13 |
| **Receptor GPS (L76K)** | GPS Standby / Power Control | P0.12 | 12 |

---

## Barra de Expansão Traseira (10 pinos)

A T-Echo possui um conector JST SH traseiro de 10 pinos para acoplamento de sensores externos (como sensores ultrassônicos para mapeamento de pátio):
-   Pinos 1 e 2: VDD (3.3V) e GND.
-   Pinos 3-10: Pinos de E/S de uso geral incluindo P0.06, P0.08, P1.07, P1.06 e P0.15.
