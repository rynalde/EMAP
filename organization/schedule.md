---
type: schedule
title: "Cronograma Operacional — Acompanhamento de Tarefas"
description: "Template vivo para montar e acompanhar o cronograma do projeto de forma gradativa. Cada tarefa tem status, responsável, datas e dependências."
timestamp: 2026-07-11T19:40:00Z
tags: [schedule, tracking, tasks, emap]
---

# Cronograma Operacional do Projeto

> Este documento é o **cronograma vivo** do projeto. Diferente do [cronograma geral por trimestres](file:///Users/rynalde/Documents/GitHub/EMAP/EMAP/organization/timeline.md), aqui cada atividade é quebrada em **tarefas rastreáveis** com status, responsável e datas concretas.
>
> **Como usar:** Preencha gradativamente à medida que as atividades forem planejadas. Atualize o status conforme o progresso.

---

## Legenda de Status

| Ícone | Status | Descrição |
| :---: | :--- | :--- |
| ⬜ | `PENDENTE` | Ainda não iniciada, aguardando planejamento ou pré-requisitos |
| 🔵 | `PLANEJADA` | Planejada com datas definidas, pronta para iniciar |
| 🟡 | `EM ANDAMENTO` | Trabalho em execução ativa |
| 🟢 | `CONCLUÍDA` | Finalizada e validada |
| 🔴 | `BLOQUEADA` | Impedida por dependência, recurso ou decisão pendente |
| ⏸️ | `PAUSADA` | Temporariamente suspensa |

---

## Fase 1 — Planejamento e Levantamento (Ano 1, T1–T2)

> **Objetivo**: Mapear a área portuária, levantar equipamentos existentes e definir requisitos do sistema.

| # | Tarefa | Status | Responsável | Início Previsto | Fim Previsto | Início Real | Fim Real | Dependências | Observações |
| :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| 1.1 | Visita técnica inicial ao Porto do Itaqui | ⬜ | — | — | — | — | — | — | — |
| 1.2 | Mapeamento da planta física e vias de tráfego | ⬜ | — | — | — | — | — | 1.1 | — |
| 1.3 | Inventário dos equipamentos portuários móveis (guindastes, empilhadeiras, etc.) | ⬜ | — | — | — | — | — | 1.1 | — |
| 1.4 | Levantamento de pontos de energia e conectividade no porto | ⬜ | — | — | — | — | — | 1.1 | — |
| 1.5 | Definição dos requisitos funcionais do sistema | ⬜ | — | — | — | — | — | 1.2, 1.3 | — |
| 1.6 | Definição dos KPIs operacionais a monitorar | ⬜ | — | — | — | — | — | 1.3 | — |

---

## Fase 2 — Infraestrutura e Aquisições (Ano 1, T2–T3)

> **Objetivo**: Adquirir hardware, servidores e licenças de software necessários.

| # | Tarefa | Status | Responsável | Início Previsto | Fim Previsto | Início Real | Fim Real | Dependências | Observações |
| :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| 2.1 | Especificação técnica de sensores LoRa/BLE/GNSS | ⬜ | — | — | — | — | — | 1.5 | — |
| 2.2 | Especificação e compra de notebook e servidor | ⬜ | — | — | — | — | — | — | — |
| 2.3 | Especificação e compra de sensores, gateways e impressora 3D | ⬜ | — | — | — | — | — | 2.1 | — |
| 2.4 | Aquisição de licenças de software (se aplicável) | ⬜ | — | — | — | — | — | — | — |
| 2.5 | Configuração do ambiente de desenvolvimento (servidor, rede) | ⬜ | — | — | — | — | — | 2.2 | — |

---

## Fase 3 — Desenvolvimento Físico e Protótipos (Ano 1, T3 – Ano 2, T2)

> **Objetivo**: Construir maquete 3D, montar sistema de sensoriamento e realizar testes em ambiente controlado.

| # | Tarefa | Status | Responsável | Início Previsto | Fim Previsto | Início Real | Fim Real | Dependências | Observações |
| :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| 3.1 | Projeto CAD da maquete do porto | ⬜ | — | — | — | — | — | 1.2 | — |
| 3.2 | Impressão 3D da maquete e equipamentos em escala | ⬜ | — | — | — | — | — | 3.1, 2.3 | — |
| 3.3 | Montagem dos tags de rastreamento (LoRa + BLE + GNSS) | ⬜ | — | — | — | — | — | 2.3 | — |
| 3.4 | Montagem e configuração dos gateways LoRa | ⬜ | — | — | — | — | — | 2.3 | — |
| 3.5 | Teste de alcance e comunicação LoRa em ambiente indoor | ⬜ | — | — | — | — | — | 3.3, 3.4 | — |
| 3.6 | Teste de posicionamento com sensores ultrassônicos | ⬜ | — | — | — | — | — | 3.2 | — |
| 3.7 | Documentação dos resultados dos testes de protótipo | ⬜ | — | — | — | — | — | 3.5, 3.6 | — |

---

## Fase 4 — Desenvolvimento de Software (Ano 1, T3 – Ano 2, T2)

> **Objetivo**: Modelar banco de dados, implementar algoritmos de OEE e roteamento, e desenvolver dashboards.

| # | Tarefa | Status | Responsável | Início Previsto | Fim Previsto | Início Real | Fim Real | Dependências | Observações |
| :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| 4.1 | Modelagem do schema do banco de dados | ⬜ | — | — | — | — | — | 1.5, 1.6 | — |
| 4.2 | Implementação do banco de dados (criação, migrations) | ⬜ | — | — | — | — | — | 4.1, 2.5 | — |
| 4.3 | Desenvolvimento do backend de coleta de telemetria | ⬜ | — | — | — | — | — | 4.2 | Recebe dados dos gateways |
| 4.4 | Implementação do algoritmo de cálculo de OEE | ⬜ | — | — | — | — | — | 4.2, 1.6 | — |
| 4.5 | Implementação do algoritmo de rota ótima | ⬜ | — | — | — | — | — | 4.2, 1.2 | — |
| 4.6 | Desenvolvimento do sistema de notificações (alertas em massa) | ⬜ | — | — | — | — | — | 4.3 | — |
| 4.7 | Desenvolvimento dos dashboards interativos de KPIs | ⬜ | — | — | — | — | — | 4.4, 4.5 | — |
| 4.8 | Integração end-to-end: sensores → backend → dashboard | ⬜ | — | — | — | — | — | 4.3, 4.7, 3.5 | — |

---

## Fase 5 — Validação e Implantação (Ano 2, T3)

> **Objetivo**: Validar o sistema completo em campo, treinar equipes e documentar procedimentos operacionais.

| # | Tarefa | Status | Responsável | Início Previsto | Fim Previsto | Início Real | Fim Real | Dependências | Observações |
| :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| 5.1 | Testes de validação integrados no Porto do Itaqui | ⬜ | — | — | — | — | — | 4.8 | — |
| 5.2 | Correções e ajustes pós-teste de campo | ⬜ | — | — | — | — | — | 5.1 | — |
| 5.3 | Elaboração de procedimentos operacionais padronizados (POPs) | ⬜ | — | — | — | — | — | 5.1 | — |
| 5.4 | Treinamento das equipes operacionais do porto | ⬜ | — | — | — | — | — | 5.3 | — |
| 5.5 | Entrega do sistema em produção | ⬜ | — | — | — | — | — | 5.2, 5.4 | — |

---

## Atividades Transversais (contínuas)

> Atividades que ocorrem ao longo de todo o projeto, sem fase fixa.

| # | Tarefa | Status | Responsável | Início Previsto | Fim Previsto | Início Real | Fim Real | Observações |
| :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| T.1 | Participação em congressos nacionais/internacionais | ⬜ | — | — | — | — | — | — |
| T.2 | Elaboração e submissão de artigos científicos | ⬜ | — | — | — | — | — | — |
| T.3 | Reuniões de acompanhamento com a EMAP | ⬜ | — | — | — | — | — | — |
| T.4 | Atualização da documentação do projeto (este repositório) | ⬜ | — | — | — | — | — | — |

---

## Resumo de Progresso

> Atualize este bloco periodicamente para ter uma visão macro rápida.

| Fase | Total de Tarefas | Concluídas | Em Andamento | Bloqueadas | % Progresso |
| :--- | :---: | :---: | :---: | :---: | :---: |
| 1 — Planejamento | 6 | 0 | 0 | 0 | 0% |
| 2 — Infraestrutura | 5 | 0 | 0 | 0 | 0% |
| 3 — Protótipos | 7 | 0 | 0 | 0 | 0% |
| 4 — Software | 8 | 0 | 0 | 0 | 0% |
| 5 — Validação | 5 | 0 | 0 | 0 | 0% |
| Transversais | 4 | 0 | 0 | 0 | 0% |
| **TOTAL** | **35** | **0** | **0** | **0** | **0%** |

---

## Notas de Atualização

> Registre aqui as mudanças significativas no cronograma (replanejamentos, novos marcos, etc.)

| Data | Descrição da Alteração |
| :--- | :--- |
| 2026-07-11 | Criação do template do cronograma operacional |
