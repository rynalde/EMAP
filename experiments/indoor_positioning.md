---
type: experiment
title: "Mapeamento Indoor com Localização Ultrassônica"
description: "Protocolo de teste de laboratório utilizando maquetes impressas em 3D e rastreamento acústico/ultrassônico."
timestamp: 2026-07-11T18:37:00Z
tags: [experiment, indoor-positioning, ultrasonic, scale-model]
---

# Experimento: Mapeamento Indoor em Escala Reduzida

## Contexto e Motivação
Como parte da metodologia descrita na Fase 3 do projeto, antes de realizar implantações diretas na área industrial complexa do porto de Itaqui (EMAP), os testes de algoritmos de rastreamento e roteamento serão validados em laboratório. Para isso, será confeccionada uma maquete tridimensional do porto utilizando impressoras 3D, reproduzindo berços e pátios.

Devido às limitações de recepção de sinal GPS em ambientes fechados (laboratório), será utilizado um sistema de localização acústica por ultrassom para emular o posicionamento geográfico dos ativos móveis na maquete.

## Metodologia de Teste

1.  **Construção da Maquete**:
    *   Criação de maquetes dos prédios, portões de acesso, pátios de trilhos e berços do porto utilizando filamento plástico em impressora 3D.
    *   Confecção de miniaturas representativas dos equipamentos móveis monitorados (guindastes, trens, empilhadeiras).
2.  **Infraestrutura Ultrassônica**:
    *   Instalação de transceptores ultrassônicos fixos (âncoras) nos cantos da área de testes do laboratório.
    *   Acoplamento de uma tag transmissora ultrassônica móvel no topo de cada miniatura de equipamento móvel.
3.  **Algoritmo de Trilateração**:
    *   As tags móveis transmitem pulsos de ultrassom periódicos.
    *   As âncoras fixas calculam a diferença no tempo de chegada (Time of Flight - ToF) dos pulsos acústicos.
    *   Um microcontrolador central calcula a coordenada bidimensional \((x, y)\) do ativo móvel através de algoritmos de trilateração baseados em:
        \[d_i = v_{som} \cdot t_{voo}\]
4.  **Integração com Gateway**:
    *   As coordenadas calculadas são enviadas para a placa gateway (LoRa32 ou T-Beam) simulando dados reais que seriam recebidos de satélites GPS em campo.

## Critérios de Sucesso e KPIs do Teste
*   **Precisão Mínima**: Desvio padrão no posicionamento da miniatura inferior a 5 centímetros na maquete física.
*   **Latência de Atualização**: O sistema deve recalcular e transmitir as coordenadas em intervalos de no máximo 1 segundo.
*   **Estabilidade de Link**: Taxa de perda de pacotes de dados de posicionamento inferior a 2%.
