# Arquitetura de Software e Algoritmos

Este diretório documenta a estrutura lógica do sistema, abrangendo desde a modelagem do banco de dados até a lógica dos algoritmos de roteamento e os painéis de KPIs (OEE).

## Conteúdos

*   **[Arquitetura do Sistema](file:///Users/rynalde/Documents/GitHub/EMAP/EMAP/software/system_architecture.md)**: Visão geral da comunicação entre Tags, Gateways, Servidor de Banco de Dados e Interfaces de Usuário.
*   **[Implementação de Referência — periplus](implementation.md)**: MVP funcional em [`apps/periplus/`](../apps/periplus/README.md) — firmware das placas (LoRa, BLE Channel Sounding, celular), backend Supabase, bridge serial e documentação técnica de bring-up.
*   **[Roadmap — Tags no Mapa 3D](roadmap_tags_mapa_3d.md)**: fases, decisões e riscos para levar as posições das tags do `periplus`, via Supabase self-hosted, à vista 3D (e ao mapa 2D) do [`itaqui-digital`](../apps/itaqui-digital/README.md).
