---
type: hardware
title: "Seeed Studio XIAO nRF54L15"
description: "Placa ultra compacta baseada no SoC Nordic nRF54L15 com arquitetura Arm Cortex-M33 + coprocessador RISC-V."
timestamp: 2026-07-11T18:37:00Z
tags: [hardware, xiao, nrf54l15, bluetooth6, matter, nordic]
---

# Seeed Studio XIAO nRF54L15

A Seeed Studio XIAO nRF54L15 (e sua variante Sense) é uma placa de desenvolvimento em formato ultra-reduzido projetada para aplicações de IoT industrial, rastreamento de ativos e dispositivos vestíveis que exigem o máximo de eficiência energética e segurança física avançada.

## Especificações Técnicas Centrais

*   **SoC (System on Chip)**: Nordic Semiconductor nRF54L15.
*   **Processador Principal**: Arm® Cortex®-M33 rodando a 128 MHz (com suporte a TrustZone® para isolamento de software seguro).
*   **Coprocessador Auxiliar**: Coprocessador RISC-V integrado de 128 MHz (gerenciamento eficiente de periféricos inteligentes e interface de RF de baixo nível).
*   **Memória**:
    *   1.5 MB de Memória Não Volátil (RRAM - Resistive RAM) para armazenamento de firmware.
    *   256 KB de RAM de alto desempenho.
*   **Protocolos de Rádio Suportados**:
    *   Bluetooth® Low Energy (BLE) 6.0 (incluindo tecnologia de medição de distância por **Channel Sounding**).
    *   IEEE 802.15.4: Compatível com redes mesh Thread, Zigbee e o padrão Matter.
    *   Protocolos proprietários de 2.4 GHz de alta velocidade (taxas de transferência de dados de até 4 Mbps).
*   **Segurança Física**: PSA Certified Nível 3. Oferece mecanismos integrados contra ataques físicos e lógicos, incluindo criptografia acelerada por hardware, raízes de confiança (Root of Trust) e proteção contra canais laterais.
*   **Gerenciamento de Energia**:
    *   Entrada USB Tipo-C.
    *   PMIC (Power Management IC) interno integrado para carregamento e controle inteligente de baterias de Lítio de célula única.
    *   Eficiência energética aprimorada que possibilita anos de operação a partir de baterias tipo moeda ou pequenas Li-Po em modo sleep.
*   **Interfaces de E/S**:
    *   16 pinos GPIO externos nos barramentos padrão XIAO.
    *   ADC de 14 bits integrado.
    *   Canais de comunicação serial em alta velocidade (SPI, I2C/TWI, UART).
*   **Sensores Onboard (Apenas Variante "Sense")**:
    *   Sensor de Movimento (IMU) LSM6DS3TR-C de 6 eixos (acelerômetro e giroscópio).
    *   Microfone digital MSM261DGT006 para processamento de comandos de voz ou análise acústica.

---

## Mapeamento de Pinos da XIAO nRF54L15

A placa preserva a compatibilidade física com os shields e acessórios da linha Seeed Studio XIAO. O barramento físico padrão de 14 pinos expõe as seguintes conexões lógicas:

| Pino XIAO | Nome no SoC nRF54L15 | Funções Alternativas / Analógicas |
| :--- | :---: | :--- |
| **D0** | P1.09 | GPIO, UART TX, A0 (ADC 14-bit) |
| **D1** | P1.08 | GPIO, UART RX, A1 (ADC) |
| **D2** | P2.00 | GPIO, A2 (ADC) |
| **D3** | P1.05 | GPIO, A3 (ADC) |
| **D4** | P1.04 | GPIO, SDA (I2C), A4 (ADC) |
| **D5** | P1.03 | GPIO, SCL (I2C), A5 (ADC) |
| **D6** | P2.02 | GPIO, TXD (Serial) |
| **D7** | P2.01 | GPIO, RXD (Serial) |
| **D8** | P1.02 | GPIO, SCK (SPI) |
| **D9** | P1.01 | GPIO, MISO (SPI) |
| **D10** | P1.00 | GPIO, MOSI (SPI) |
| **3V3** | - | Saída regulada de 3.3V (fornecida pelo PMIC) |
| **GND** | - | Referência de Terra |
| **5V** | - | Entrada/Saída de Tensão USB (5V) |

---

## Principais Recursos de Rastreamento (Channel Sounding)

Uma das maiores vantagens da XIAO nRF54L15 para o rastreamento em áreas portuárias é o suporte nativo ao **Bluetooth 6.0 Channel Sounding**. 
Essa tecnologia permite determinar a distância exata entre dois dispositivos Bluetooth com precisão de centímetros através de medições de fase de fase (PBR) e tempo de voo (RTT), oferecendo uma alternativa econômica ao GPS para rastreamento indoor e delimitado (como depósitos de carga e oficinas de manutenção do porto).
