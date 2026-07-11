---
type: hardware
title: "LILYGO TTGO LoRa32 V2.1 & T3 V1.6.1"
description: "Placa de desenvolvimento baseada em ESP32 com rádio LoRa SX1276, display OLED e suporte a bateria Li-Po."
timestamp: 2026-07-11T18:37:00Z
tags: [hardware, esp32, lora, sx1276, lilygo]
---

# LILYGO TTGO LoRa32 V2.1 & T3 V1.6.1

A placa LILYGO TTGO LoRa32 V2.1 (também catalogada como T3 V1.6.1 nas revisões de hardware mais recentes) combina o microcontrolador ESP32 com um rádio LoRa da Semtech para fornecer conectividade sem fio de longo alcance em redes ponto a ponto ou LoRaWAN.

## Especificações Técnicas Centrais

*   **Microcontrolador**: ESP32-D0WDQ6 (Dual-core Xtensa® LX6 de 32 bits rodando até 240 MHz).
*   **Transceptor LoRa**: Semtech SX1276 (ou SX1278 para bandas de 433 MHz).
*   **Frequências Suportadas**: 433 MHz, 868 MHz ou 915 MHz (dependendo da variante de hardware adquirida).
*   **Memória Flash**: 4 MB SPI Flash.
*   **Conectividade Adicional**: Wi-Fi 802.11 b/g/n, Bluetooth v4.2 / BLE (Bluetooth Low Energy).
*   **Display Integrado**: Display OLED SSD1306 de 0.96 polegadas (Resolução de 128x64 pixels) via barramento I2C.
*   **Armazenamento Externo**: Slot integrado para cartão TF/MicroSD.
*   **Conversor USB-Serial**: Chip CP2104 ou CH9102F (usado para programação e depuração USB).
*   **Gerenciamento de Energia**: Circuito de carregamento de bateria Li-Po integrado baseado no chip TP4054 (conector JST-GH de 2 pinos, espaçamento de 1.25mm) com suporte a alimentação dual (USB ou Bateria 3.7V).
*   **Conexão de Antena**: Conector SMA fêmea para a antena LoRa.

---

## Mapeamento de Pinos (Pinout)

Para programar esta placa no ecossistema Arduino, Zephyr ou PlatformIO, as seguintes atribuições de pinos GPIO internas do ESP32 devem ser observadas:

### Rádio LoRa (Semtech SX1276)
O rádio LoRa se comunica via barramento SPI dedicado no ESP32:

| Função | GPIO Pin | Descrição |
| :--- | :---: | :--- |
| **SPI SCK** | GPIO 5 | Sinal de Clock da interface SPI |
| **SPI MOSI** | GPIO 27 | Saída de Dados SPI (Master Out Slave In) |
| **SPI MISO** | GPIO 19 | Entrada de Dados SPI (Master In Slave Out) |
| **CS / SS** | GPIO 18 | Chip Select (Ativo em nível baixo) |
| **Reset (RST)** | GPIO 23 | Reset Físico do chip SX1276 |
| **DIO0** | GPIO 26 | Interrupção principal (RxDone, TxDone) |
| **DIO1** | GPIO 33 | Usado em implementações completas de LoRaWAN (opcional) |
| **DIO2** | GPIO 32 | Interrupção auxiliar |

### Display OLED (SSD1306 - I2C)

| Função | GPIO Pin | Descrição |
| :--- | :---: | :--- |
| **SDA** | GPIO 21 | Linha de Dados I2C |
| **SCL** | GPIO 22 | Linha de Clock I2C |
| **RST (OLED)** | GPIO 16 | Reset Físico do display (necessário inicializar em nível alto no código) |

### Slot de Cartão MicroSD (SPI)

| Função | GPIO Pin | Descrição |
| :--- | :---: | :--- |
| **SD_CS** | GPIO 13 | Chip Select do cartão SD |
| **SD_MOSI** | GPIO 15 | MOSI compartilhado ou dedicado |
| **SD_MISO** | GPIO 2 | MISO compartilhado ou dedicado |
| **SD_SCK** | GPIO 14 | Clock compartilhado ou dedicado |

### Outros Periféricos Onboard

| Função | GPIO Pin | Descrição |
| :--- | :---: | :--- |
| **Battery ADC** | GPIO 35 | Leitura analógica da tensão da bateria (divisor resistivo integrado) |
| **LED Onboard** | GPIO 25 | LED de uso geral do usuário (geralmente verde) |
| **User Button** | GPIO 0 | Botão físico do usuário (ativo em nível baixo) |

---

## Recomendações e Cuidados Físicos

> [!WARNING]
> **Risco de Queima do Hardware**: Nunca ligue ou coloque a placa para transmitir dados LoRa sem a antena SMA estar devidamente conectada. Transmitir sem carga (antena) pode danificar permanentemente o amplificador de potência do transceptor SX1276.

*   **Leitura de Tensão da Bateria**: O pino GPIO 35 está conectado a um divisor de tensão de 100kΩ/100kΩ para monitorar o status da bateria Li-Po de 3.7V. Como a tensão máxima da bateria carregada é de 4.2V, o divisor reduz a leitura pela metade (2.1V), faixa aceitável pelo conversor analógico-digital (ADC) do ESP32.
