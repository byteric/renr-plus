# Plano de aplicação — ReNR+ v0.3

**Data:** 15/10/2026  
**Estado:** incremento implementado e verificado localmente, baseado na main `fc299b1`, com pacotes separados por integrante. O relatório [Verificação v0.3](../VERIFICACAO_V03.md) registra os gates executados; não representa publicação.  
**Objetivo:** entregar um workspace visualmente mais forte, com dashboards animados sobre dados reais e um fluxo demonstrável de diagnóstico → inventário → ficha preliminar rastreável.  
**Arquitetura:** preservar o monólito modular, o isolamento por organização e os contratos explícitos; evoluir a apresentação por componentes e adicionar o domínio de riscos por migração aditiva.  
**Stack:** React/TypeScript/Vite, Tailwind e componentes Radix/shadcn já utilizados, GSAP/`@gsap/react`, NestJS, Prisma/PostgreSQL e Render/Neon Free.  
**Referências de produto:** [PRD](../PRD.md), [recorte v0.2](../IMPLEMENTACAO_V02.md), [Design DNA v0.3](../DESIGN_DNA_V03.json).

## 1. Resultado esperado e limites

A demonstração deve permitir entrar, escolher a empresa, consultar um painel bem composto, navegar por um gráfico até o inventário filtrado, cadastrar um risco, registrar uma ficha preliminar e recuperar sua origem e histórico após recarregar a página.

| Prioridade deste incremento | Entrega                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0                          | Redesenho de entrada/login, shell, painel, diagnóstico e inventário; temas claro/escuro, responsividade, favicon e estados completos.                   |
| P0                          | Dashboard operacional real com KPIs, barras por unidade, anel de preenchimento de fichas e navegação até a lista filtrada.                              |
| P0                          | Inventário persistido, origem contextualizada, edição concorrente protegida, ficha preliminar append-only e histórico mínimo.                           |
| P0                          | GSAP integrado ao ciclo React, rolagem nativa, cabeçalhos/filtros sticky, modo de movimento reduzido, testes e release verificável.                     |
| P1, após P0                 | Evolução temporal de cadastros com agregação real, presets de filtros, sequência narrativa mais elaborada na entrada e refinamentos extras de gráficos. |
| P2 / outras versões         | WebGL/3D de runtime, partículas, cursor proprietário, motor extra de animação, plano de ação completo, uploads/evidências, relatórios completos e IA.   |

Prioridades acima são do incremento, não uma reclassificação dos requisitos do MVP. RF-07 terá recorte demonstrativo; RF-08 ficará parcial: registrar uma ficha preliminar não equivale a implementar classificação técnica validada.

**Restrições:** manter custo zero sem contratar recursos; usar dados fictícios; não coletar entrevistas nesta etapa; não alterar credenciais; não copiar ativos, código, marcas ou textos dos sites de referência; não escolher a licença do projeto sem decisão conjunta. A aprovação do método de avaliação compete à ReTech+/SST, não a uma animação, ao software ou ao papel ADMIN.

## 2. Design DNA das quatro referências

Inspeção realizada em navegador desktop, 1280 × 720, com estilos computados de elementos observados. Valores de tipografia/cor abaixo são amostras CSS reais, não uma medição completa de toda a página. Breakpoints, fps, bibliotecas internas e durações das referências não foram inferidos como fatos.

| Referência                                | Observado                                                                                                                                                             | Transferência proposta para ReNR+                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Resn](https://resn.co.nz/)               | Cena escura, geometria facetada, composição central, chamada click-and-hold e seis elementos Canvas. WebGL/3D é hipótese, não identificação do motor.                 | Uma entrada de marca memorável, profundidade em SVG e transições coreografadas; acesso e dados continuam imediatos.                                          |
| [Locatelli](https://locatelliadv.com.br/) | Inter no corpo, Source Serif 4 no título; título observado 67,2 px, corpo 17 px; branco, texto #141414 e CTA #1A4F63; navegação permaneceu visível na rolagem.        | Hierarquia editorial, respiro, divisórias, títulos claros e contexto persistente. Não transportar automaticamente a fonte serifada para formulários/tabelas. |
| [Bautz](https://www.bautz.com.br/)        | Poppins/Prata; corpo 15 px, título 45 px; texto #195A6E e título #B9844F; hero com imagem ampla, sobreposição e entrada de seções.                                    | Acabamento, composição assimétrica controlada, destaque visual e entradas discretas de blocos. Sem usar fotografias de joias.                                |
| [R. Yazbek](https://ryazbek.com.br/)      | Lato, corpo 16 px e título de aproximadamente 45 px; grade de catálogo e categorias, acento observado #E33237. A mídia principal do hero não renderizou nesta sessão. | Filtros por categoria, cards hierarquizados, metadados e CTAs claros. Não presumir efeito do hero nem copiar identidade imobiliária.                         |

**Tese visual:** “Da informação dispersa a uma decisão rastreável”. A entrada pode ser mais expressiva; o workspace orienta empresa → indicador → registro → origem. O movimento destaca essa ligação e dá feedback, sem ocupar o lugar do conteúdo.

### 2.1 Identidade, componentes e tipografia

Preservar petróleo `#075663`, verde da marca `#009D37`, laranja `#FF8A12`, fundo claro `#FAF9F3` e superfícies brancas. No escuro, preservar `#101F23` / `#182C30` e texto `#F0F5EF`. Refinar os tokens existentes, sem criar um segundo sistema de estilos.

Manrope Variable auto-hospedada foi uma opção de desenho. Nesta composição, usar a pilha local Segoe UI/Arial e equivalentes de sistema, sem arquivo de fonte adicional ou CDN. Qualquer futura inclusão exige licença, glifos em português e orçamento de WOFF2 conferidos. Usar numerais tabulares nos KPIs e hierarquia explícita de títulos e corpo.

Grid de 12 colunas no desktop, 8 no tablet e 4 no celular; gutters 24/16 px; workspace até 1440 px, leitura até 720 px. Reutilizar o breakpoint móvel existente de 750 px. Raios 8/12/20 px; bordas discretas e sombras reservadas a sobreposições.

**Contraste calculado:** branco sobre o verde da marca resulta em aproximadamente 3,57:1; não usar essa combinação em texto pequeno. O verde semântico proposto `#007F32` com branco resulta em 5,14:1. Petróleo `#153B40` sobre o laranja resulta em 5,14:1. Esses cálculos não substituem auditoria dos estados/temas completos.

### 2.2 Telas a entregar

| Tela/área           | Mudança concreta                                                                                                             | Comportamento verificável                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Entrada/login       | Hero compacto com SVG original do escudo e conexão das etapas; formulário destacado, tipografia nova e favicon já preparado. | Login acessível sem assistir à animação; erros e foco visíveis, inclusive com movimento reduzido.         |
| Shell               | Sidebar desktop, topbar com empresa/tema/saída, navegação móvel com Sheet; ações e filtros contextuais.                      | Trocar empresa limpa imediatamente dados antigos; menu móvel abre, fecha, devolve foco e restaura scroll. |
| Painel              | Destaque de contexto, KPIs reais, barras por unidade, anel de fichas preenchidas e pendências de registro.                   | Clique em unidade/estado leva ao inventário com filtro explícito; números conferem com o banco.           |
| Inventário          | Lista/tabela paginada, busca, filtros de unidade/setor/status e detalhe; cards equivalentes no celular.                      | Recarregar e usar voltar/avançar preserva filtros e página; estados vazio/erro/salvamento funcionam.      |
| Diagnóstico e ficha | Melhor composição dos resultados existentes, vínculo com a origem e formulário dividido em seções.                           | Preservar regras de supressão; dados insuficientes não viram gráfico “zero”; erros não apagam o rascunho. |

Esboço do painel desktop, com ordem de leitura preservada no celular:

```text
┌─────────────┬─────────────────────────────────────────────────────┐
│ ReNR+       │ Empresa ativa                    Tema · Conta · Sair │
│             ├─────────────────────────────────────────────────────┤
│ Visão geral │ Visão geral                 Atualização / contexto  │
│ Estrutura   │ [Registros] [Rascunhos] [Registrados] [Sem ficha]     │
│ Diagnóstico │                                                     │
│ Inventário  │ [ Barras: registros por unidade ] [ Com/sem ficha ] │
│             │ [ Link/lista acessível de valores e filtros ]       │
│             │                                                     │
│             │ Pendências de registro → Lista / detalhe / origem   │
└─────────────┴─────────────────────────────────────────────────────┘
```

Não exibir navegação funcional para módulos ainda não implementados.

## 3. Dashboards, motion e rolagem

### 3.1 Indicadores e regras dos gráficos

| Visualização P0             | Origem/fórmula                                                                                                            | Cuidados                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| KPIs de inventário          | Contar riscos não arquivados, separados em DRAFT/REGISTERED; sem ficha = não existe avaliação preliminar para o registro. | Estados operacionais, não nível de risco nem percentual de conformidade.                                                                   |
| Barras por unidade          | Agrupar registros não arquivados por unidade; identificar rascunho/registrado.                                            | Eixo inicia em zero; unidades inativas e “sem registros” têm regra/legenda explícita; total das barras deve conferir com o mesmo snapshot. |
| Anel de fichas              | Registros não arquivados com ficha preliminar / total de registros não arquivados.                                        | Denominador zero mostra “Sem registros”, não 100%; “preenchido” não significa avaliação técnica aprovada.                                  |
| Distribuição do diagnóstico | Consumir a consolidação já disponível para um ciclo, sem acessar respostas individuais.                                   | Preservar indisponibilidade, limiar demonstrativo e categorias suprimidas; não produzir comparação que reidentifique grupos.               |
| Resumo de estrutura         | Manter os totais reais de unidades/setores existentes.                                                                    | Resposta e contrato atuais continuam válidos; separar seu contexto/horário do novo snapshot de riscos.                                     |

Gráficos recebem SVG responsivo, legenda textual, valores acessíveis e alternativa em lista/tabela. Tooltip deve funcionar com foco e toque; nenhuma informação depende só de hover ou cor. Um gráfico sem dados reais usa estado vazio, nunca uma curva fictícia decorativa.

A série temporal P1 implementada conta **cadastros de riscos por dia**, não evolução de saúde ou redução de exposição. A API define períodos de 7/30/90 dias, fuso configurado, preenchimento dos dias sem registros e denominador histórico próprio. Os atalhos de filtros também estão incluídos.

### 3.2 Especificação do movimento

| Elemento                        | Gatilho e proposta                                                                                     | Reduced motion / limite                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Botões, foco e filtros          | Feedback 120–160 ms, sem deslocar alvos.                                                               | Estado final imediato; foco nunca removido.                                                      |
| Drawer, detalhe e troca de abas | 180–280 ms, easing desacelerado, transform/opacity.                                                    | Sem translação; não atrasar teclado nem envio.                                                   |
| Entrada de blocos/KPIs          | Após resposta válida, 320–450 ms; stagger até 40 ms com atraso total limitado.                         | Dados finais legíveis imediatamente; sem contador por frame em aria-live.                        |
| Barras e anel SVG               | Uma execução por dataset válido, a partir dos valores reais; atualização interrompe a animação antiga. | Estado final imediato; nunca usar animação para ocultar indisponibilidade.                       |
| Seções narrativas da entrada    | ScrollTrigger com revelação uma vez; conexão SVG discreta e opcional.                                  | Sem pinning obrigatório, sem conteúdo essencial inicialmente invisível e sem captura da rolagem. |

Reutilizar GSAP e `@gsap/react` já instalados. Um único dono por propriedade: GSAP controla transform/opacity dos nós animados; CSS não disputa as mesmas propriedades. Usar refs, escopo e teardown por `useGSAP`; testar StrictMode, remontagem e troca rápida de rota/empresa. Suspender animação decorativa fora da tela/aba oculta.

Não adicionar Motion, Anime.js, Remotion ou Three.js para cobrir o mesmo problema. SVG e GSAP atendem o recorte sem outra biblioteca de gráficos. Nenhum efeito pode retardar logout ou deixar dados da empresa anterior visíveis.

### 3.3 “Scroll de verdade”

Manter wheel, trackpad, toque, Space, PageDown, Home/End e barra nativos. Planejar rolagem a partir de conteúdo real: resumo → gráficos → pendências → histórico, sem espaço artificial.

Topbar e navegação de seções usam `position: sticky` com offsets consistentes. No desktop com altura suficiente, a barra compacta de atalhos de filtros também acompanha a rolagem; o formulário completo permanece no fluxo. Âncoras/erros usam margem de rolagem para não ficar sob os controles fixos. Apenas a tabela pode ter overflow horizontal controlado e identificado; a página não deve transbordar.

O drawer móvel contém sua rolagem e restaura a posição/foco do documento ao fechar. Rolagem suave é pontual para âncoras/primeiro erro e desativada em reduced motion. Não usar scroll-jacking, suavização global obrigatória, rolagem horizontal forçada ou esconder a barra via CSS.

No detalhe do risco, uma navegação de seções acompanha Resumo → Exposição → Origem → Fichas → Histórico. O item ativo acompanha a seção visível, os atalhos têm âncoras reais e o cabeçalho sticky não encobre o foco. Isso dá uma experiência de rolagem perceptível e útil sem exigir um site institucional separado.

## 4. Backend, contratos e banco

### 4.1 Fluxo e compatibilidade

```text
Cadastro de empresa/unidade/setor e diagnóstico agregado existente
                    │
                    ▼
         Inventário de riscos por organização
                    │
             ficha preliminar
                    │
       histórico imutável + auditoria segura
                    │
                    ▼
        risk-overview → gráficos → lista filtrada
```

O `organizationOverviewSchema` existente é estrito. Acrescentar campos na resposta atual quebraria clientes antigos ainda abertos. **Criar endpoint e contrato novos para o painel de riscos**, preservando `GET /organizations/:id/overview`. Esta decisão substitui a alternativa de simplesmente ampliar o payload v0.2.

Toda resposta nova é validada na fronteira React. Aplicar autorização no servidor, Origin exata nas escritas, sessão por cookie e `Cache-Control: private, no-store`. Não aceitar `organizationId` arbitrário do corpo como autoridade.

### 4.2 Modelo proposto

| Entidade       | Campos e regras do recorte                                                                                                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Risk           | UUID; organizationId; assessmentGroupId; fator (3–160 caracteres), descrição/exposição/grupo exposto/possíveis agravos/controles existentes (até 2.000 cada); sourceKind; sourceNote até 1.000; diagnosticCycleId opcional conforme origem; status DRAFT/REGISTERED/ARCHIVED; version; autor e datas.                                   |
| Origem/escopo  | Formulário recebe sectorId; servidor valida setor/unidade na organização e cria/reutiliza AssessmentGroup pela unicidade existente (organizationId, sectorId). Origem pode ser contexto de ciclo ou registro técnico manual, sem entrevista nova.                                                                                       |
| RiskEvaluation | UUID; riskId + organizationId; sequência única por risco; riskVersion e contextSnapshot dos campos/origem do risco, gerados no servidor; referência do método (3–200), versão (1–40), observação preliminar e justificativa (10–2.000 cada); autor/data; rótulo PRELIMINARY. Append-only; não sobrescrever a anterior nem seu contexto. |
| Auditoria      | Usar AuditEvent existente com autor, organização, recurso, operação e horário; sem senha, convite, resposta individual ou corpo integral sensível. O histórico mínimo vem de metadados do risco/fichas; leitor não recebe acesso genérico aos logs.                                                                                     |
| Integridade    | Relações compostas preservam organização; índice por organização/status/data e grupo; avaliação única (riskId, sequence). expectedVersion protege edição concorrente; arquivo é lógico e não remove avaliações.                                                                                                                         |

Rascunho exige fator e setor válido; pode manter campos pendentes. Para REGISTERED, exigir descrição, exposição, grupo exposto, possíveis agravos, controles e origem completos. Informar “Não identificado nesta etapa” é diferente de deixar campo vazio; o sistema não garante validade técnica dessa afirmação.

**Vocabulário do payload a congelar:** `factor` (3–160), `sectorId` (UUID), `description` e `exposureDescription` (10–2.000 cada em REGISTERED), `exposedGroupDescription` (3–2.000), `possibleHarms` e `existingControls` (5–2.000), `sourceKind` (DIAGNOSTIC_CYCLE ou TECHNICAL_RECORD), `sourceNote` (10–1.000 em REGISTERED) e `diagnosticCycleId` (UUID ou null conforme a origem). Campos textuais são trimados; no rascunho os campos opcionais vazios são normalizados para null, mantendo os máximos. Corpo strict recusa autor/empresa/snapshot fornecidos pelo cliente. `expectedVersion` é inteiro de 1 a 2.147.483.647 nos endpoints que o exigem. Autoria/datas sempre vêm da sessão e do servidor.

**Transições P0:** criar DRAFT ou REGISTERED; DRAFT → REGISTERED com ficha cadastral completa; DRAFT/REGISTERED → ARCHIVED com versão atual; ARCHIVED é somente leitura. Não há exclusão física, restauração ou REGISTERED → DRAFT neste recorte. Setor/AssessmentGroup são imutáveis após criação; tipo de origem e vínculo ao ciclo ficam congelados ao registrar. Editar conteúdo de REGISTERED mantém seus campos completos e incrementa version. As fichas antigas preservam o snapshot que receberam, mesmo se o texto do risco mudar depois.

Fonte de ciclo exige vínculo CycleGroup com o mesmo AssessmentGroup do risco, na mesma organização, ciclo encerrado e disponibilidade AVAILABLE antes de se apresentar como consolidação. Validar no servidor, sem aceitar apenas um UUID de ciclo da mesma empresa. Nunca vincular Risk a ResponseAnswer ou a uma pessoa que respondeu. Em REGISTERED, TECHNICAL_RECORD exige nota e diagnosticCycleId null; DIAGNOSTIC_CYCLE exige UUID e nota contextual. DRAFT pode manter campos opcionais pendentes, mas qualquer vínculo ao ciclo que for enviado já deve passar pelas verificações de escopo/disponibilidade. O vínculo não transforma o instrumento fictício em metodologia validada.

A ficha preliminar só pode ser adicionada a REGISTERED. Payload: `methodReference` (3–200), `methodVersion` (1–40), `observation` e `rationale` (10–2.000 cada), além de expectedVersion. Sua gravação incrementa a versão do risco e guarda riskVersion/contextSnapshot antes da mudança; dois envios com a mesma versão não geram duas fichas. Não atribui probabilidade, severidade, score, prioridade normativa ou selo de aprovação. A adoção de matriz/escala e o papel formal de SST exigem validação externa; ausência dessa decisão não bloqueia o inventário demonstrativo.

### 4.3 Contratos HTTP propostos

Prefixo comum: `/api/v1/organizations/:orgId`. Novas rotas, nomes e DTOs serão congelados na tarefa V03-01.

| Operação                    | Sucesso / contrato                                                                                            | Erros e regra                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET /risks                  | 200; lista filtrada/paginada conforme convenções atuais; page/pageSize, padrão 50 e máximo 100.               | 400 para filtro inválido; 401 sem sessão; 404 fora do escopo.                                       |
| POST /risks                 | 201; RiskDetail; criar em DRAFT ou REGISTERED com os requisitos correspondentes.                              | 400 campos; 403 READER/origem inválida; 404 escopo; não repetir POST automaticamente.               |
| GET /risks/:id              | 200; RiskDetail com origem, versão e metadados da ficha mais recente.                                         | 404 para recurso ausente/de outra organização.                                                      |
| PATCH /risks/:id            | 200; RiskDetail; expectedVersion obrigatório; permite edição/arquivo lógico autorizado.                       | 409 se versão mudou; 400 transição inválida; 403 para leitor.                                       |
| GET /risks/:id/evaluations  | 200; histórico paginado de fichas preliminares.                                                               | Mesmas regras de escopo; sem acesso a respostas individuais.                                        |
| POST /risks/:id/evaluations | 201; ficha preliminar e sequência gerada no servidor; expectedVersion do risco.                               | 409 para concorrência/estado incompatível; 400 campos; 403 leitor; somente REGISTERED recebe ficha. |
| GET /risk-overview          | 200; RiskOverview com organizationId, generatedAt, totais de status, com/sem ficha e agrupamento por unidade. | Contrato novo; snapshot consistente; sem resultados individuais; endpoint anterior permanece igual. |

Novo contrato de lista: filtros `unitId`, `sectorId`, `status`, `evaluationPresence` (WITH ou WITHOUT, ausente significa ambos), `q` (até 120 caracteres), `page`, `pageSize`; ordenação estável por data/id. **Sem status explícito, retornar somente DRAFT + REGISTERED; ARCHIVED só aparece por filtro explícito.** Validar coerência unidade/setor. Pesquisa sem interpolar SQL; tamanho e escape conforme implementação segura. O KPI “sem ficha” e o anel navegam com evaluationPresence=WITHOUT/WITH, sem converter essa condição em status do risco; o link reinicia page=1 e não herda filtros antigos que mudem o total.

No agregado, contar cada risco uma vez mesmo quando ele tem várias fichas. As barras incluem registros não arquivados de unidades ativas ou inativas, com inativas identificadas. Retornar até oito unidades com mais registros, ordenação por contagem/nome/id, e uma categoria OTHERS com a soma restante; a soma das categorias confere com o total. UNIT tem unitId e drill-down; OTHERS é uma união explícita sem unitId e oferece “Ver inventário completo”, não um filtro de unidade fictício. A lista paginada permite alcançar as unidades restantes. Unidades sem registros não precisam de barras; o estado vazio e os totais de estrutura continuam explícitos.

Todas as falhas usam o envelope existente de erro sanitizado. Falha de banco não devolve dados inventados; o filtro da aplicação trata a falha sem expor detalhes. Cliente conserva rascunho e oferece nova tentativa manual; leituras podem ser repetidas de forma limitada, sem ciclo infinito.

Duplo clique: bloquear segundo envio enquanto pendente; POST não recebe retry cego. Falha de transporte após envio tem resultado incerto, não deve ser rotulada como “não salvou”. Reconsultar antes de orientar reenvio; edição/ficha usa versão para evitar perda ou repetição silenciosa. Uma garantia completa de idempotência para criação exige contrato/armazenamento próprio e não será alegada apenas por desabilitar o botão.

### 4.4 Permissões e migração

ADMIN cadastra, edita e arquiva; READER consulta sem controles de escrita. Esses papéis não atribuem habilitação profissional de SST. Unidade/setor inativados permanecem legíveis no histórico; novos registros exigem escopo ativo. Mudança de escopo de registro já acompanhado deve ser bloqueada; não reescrever a origem histórica.

Migração aditiva, sem reset/seed local na nuvem, preservando usuários, sessões, ciclos e respostas. Testar em banco vazio e banco contendo v0.2, executar novamente e comprovar que não há alteração adicional. Se índices em tabelas existentes precisarem evitar bloqueios, definir execução compatível com transações do Prisma; não aplicar CREATE INDEX CONCURRENTLY cegamente dentro de uma transação.

Recuperação: voltar ao binário anterior compatível e preservar tabelas aditivas. Não fazer rollback destrutivo do Neon para “desfazer” o frontend.

## 5. Divisão da equipe e propriedade dos arquivos

Cada arquivo possui um responsável de edição; apoios revisam e não sobrescrevem trabalho paralelo.

| Integrante                         | Entrega principal                                    | Propriedade proposta                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ricardo Severiano de Souza Filho   | Integração, decisões de fronteira, revisão e release | Manifesto raiz/lockfile se necessários; Docker/CI/release; README de fechamento; integração do favicon já preparado.                                                      |
| Júlia Oliveira Veríssimo           | Contratos e critérios de aceite                      | packages/contracts/src/risks.ts, risk-overview.ts, exports e testes desses contratos; docs/CRITERIOS_V03.md.                                                              |
| Pedro Iranildo dos Santos Monteiro | Modelo e integridade dos dados                       | apps/api/prisma/schema.prisma, nova migration e fixture de riscos sintéticos; desenho/verificação das consultas em apoio a Bruno.                                         |
| Bruno Sotomayor Martin             | API de riscos e agregações                           | apps/api/src/modules/risks/risks.{controller,service,repository}.ts, risk-overview.{controller,service,repository}.ts, registro em app.module.ts e testes HTTP/unitários. |
| Thomaz Barros Costa                | Navegação, inventário e formulários                  | App.tsx, Structure.tsx, WorkspaceNavigation.tsx; novas páginas/componentes de inventário e ficha, componentes de lista/formulário e testes de interface.                  |
| Diogo Silas Woolley do Carmo       | Direção visual, dashboard e motion                   | styles.css/overview.css e estilos novos; apresentação de OrganizationOverview; ManagementDashboard, gráficos, ilustração/entrada e hooks de animação.                     |
| Luiz Henrique Rocha Silva          | Integração, acessibilidade e QA                      | Novos testes PostgreSQL/E2E de riscos e dashboard; regressões de drawer, rolagem e reduced motion; relatório de verificação.                                              |
| Eliziane Mota de Souza             | Documentação de uso e validação                      | docs/USO_V03.md, UX_V03.md e atualização do runbook/checklist de publicação; capturas e limitações verificadas.                                                           |

A tabela conserva a divisão de responsabilidades do planejamento. Na composição final, Diogo também entrega WorkspaceNavigation e o hook compartilhado useRiskData, necessários antes da integração de Thomaz. Eliziane reúne os guias e o relatório; Luiz entrega os testes de navegador e migração. O manifesto individual de cada pacote lista os arquivos exatos, sem duplicação de responsáveis.

## 6. Sequência executável e provas de aceite

Os checklists abaixo conservam as ações do plano original, inclusive revisões humanas e liberação futura; não são um quadro de tarefas atualizado. O fechamento técnico local é registrado nesta tabela e no [relatório de verificação](../VERIFICACAO_V03.md), sem presumir aprovação externa.

| Etapa           | Evidência da preparação local                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| V03-00          | Base `fc299b1` identificada; PostgreSQL e dados fictícios locais; favicon preservado. Não houve republicação da v0.2.          |
| V03-01          | Contratos strict, normalização, transições e agregações cobertos pelos testes compartilhados.                                  |
| V03-02          | Migração aditiva, integridade entre organizações, histórico protegido, seed repetível e preservação de dados v0.2 verificados. |
| V03-03 e V03-04 | API de inventário e fichas com transações, controle de versão, autoria e snapshot no servidor; testes HTTP e PostgreSQL.       |
| V03-05          | Agregações reais compatíveis com o painel anterior; série diária P1, zeros, fusos e denominadores testados.                    |
| V03-06          | Entrada e shell redesenhados, dois temas, drawer, fallback tipográfico e favicon; testes e inspeção visual.                    |
| V03-07          | Inventário, edição, origem, duas fichas, conflito, arquivo e recuperação de rota/filtros exercitados com API real.             |
| V03-08 e V03-09 | Gráficos, atalhos, movimento opcional, rolagem nativa, navegação ativa, âncoras e retorno à lista testados.                    |
| V03-10          | Checks, banco, migrações, navegador, ensaio de apresentação e guias locais; pacotes separados por integrante.                  |
| V03-11          | Não executada nesta preparação: publicação, PRs e atualização do quadro dependem da etapa futura de liberação.                 |

Cada ação original é uma unidade operacional delimitada. A faixa de 2–5 minutos orienta os micro-passos, não é promessa de duração total.

### V03-00 — Base de release e ambiente (Ricardo / Luiz)

**Dependência:** v0.2 aprovada e disponível antes de publicar v0.3. O desenho pode avançar enquanto essa condição é resolvida.  
**Arquivos:** README, CHECKLIST_RELEASE e configuração local existente, sem segredos no Git.  
**Aceite:** fonte de execução identificada, ambiente local reproduzível, v0.2 distinguida da v0.3.

- [ ] Confirmar commit da main e resultado da release v0.2; anotar baseline de build e testes.
- [ ] Preparar PostgreSQL e dados fictícios locais pelas instruções existentes; conferir readiness e parâmetros de teste, sem copiar senha de nuvem.
- [ ] Criar a integração v0.3 a partir da main validada somente na etapa de execução autorizada.
- [ ] Preservar e incluir separadamente a alteração local do favicon; não perder alterações pendentes.
- [ ] Registrar bloqueios reais antes de atribuir falhas de ambiente ao incremento.

### V03-01 — Contratos e vocabulário (Júlia; revisão Bruno/Pedro)

**Arquivos:** novos packages/contracts/src/risks.ts, risk-overview.ts e respectivos .test.ts; index.ts; novo docs/CRITERIOS_V03.md.  
**Interfaces produzidas:** CreateRiskInput, UpdateRiskInput, RiskDetail, RiskList, CreatePreliminaryEvaluationInput, PreliminaryEvaluation, RiskOverview.  
**Aceite:** estados operacionais, campos/limites, filtros e envelopes definidos sem criar score normativo.

- [ ] Definir payloads exatos, obrigatoriedade por estado, formatos de UUID/data, normalização e limites com exemplos válidos/invalidáveis.
- [ ] Escrever testes por campo/estado e executar Red pelo comportamento ausente, não por importação quebrada.
- [ ] Implementar schemas strict mínimos e exports; comprovar Green em `pnpm --filter @renr/contracts test`.
- [ ] Fixar em teste os casos “q excede 120”, setor/unidade incompatíveis no serviço, status desconhecido, expectedVersion ausente e resposta com campo inesperado.
- [ ] Revisar nomenclatura/contratos com as frentes e liberar implementação paralela.

### V03-02 — Banco aditivo (Pedro; revisão Bruno)

**Arquivos:** schema.prisma, prisma/migrations/<timestamp>_risk_inventory/*; fixture local proposta scripts/risk-demo-data.mjs.  
**Interfaces consumidas:** V03-01; relações Organization/Sector/AssessmentGroup/DiagnosticCycle existentes.  
**Aceite:** duas empresas isoladas, avaliações preservadas e dados v0.2 intactos.

- [ ] Escrever teste de integridade para vínculo cruzado entre empresas e para sequência duplicada de avaliação; observar Red na base de teste.
- [ ] Criar entidades/índices/relações aditivas e prever a ligação do AssessmentGroup com Risk.
- [ ] Testar migração sobre base v0.2 e em base vazia, e repetição sem reset.
- [ ] Gerar fixture determinística restrita ao banco local; demonstrar cenários zero, vários registros e duas organizações.
- [ ] Executar prisma:validate e testes PostgreSQL; revisar impacto/recuperação antes de liberar V03-03.

### V03-03 — API do inventário (Bruno; QA Luiz)

**Arquivos:** novos risks.controller.ts, risks.service.ts, risks.repository.ts; app.module.ts; novos apps/api/test/risks.http.spec.ts e risks.integration.spec.ts.  
**Interfaces:** rotas de RiskDetail/RiskList definidas em V03-01; sessão/scope e AuditEvent existentes.  
**Aceite:** ler/criar/editar/arquivar com escopo, validação, auditoria e conflito de versão.

- [ ] Testar sem sessão → 401, leitor escrevendo → 403 e recurso externo → 404; observar Red antes do serviço.
- [ ] Implementar operações mínimas em transação, incluindo validação de setor/origem e grupo reaproveitado por unicidade.
- [ ] Testar campos obrigatórios para REGISTERED, rascunho incompleto permitido, escopo inativo e ausência de exclusão física.
- [ ] Testar dois PATCH com mesma versão: somente um persiste; outro recebe 409 e não gera auditoria de sucesso.
- [ ] Comprovar Green com HTTP e banco real; Swagger e erro seguro correspondem ao contrato.

### V03-04 — Ficha e histórico (Bruno / Pedro; QA Luiz)

**Arquivos:** serviço/repository de riscos e novos testes de avaliações; sem endpoint genérico de logs.  
**Interfaces:** PreliminaryEvaluation, expectedVersion e metadados do autor autenticado.  
**Aceite:** nova ficha preserva anterior e não se apresenta como classificação validada.

- [ ] Testar criação de duas versões, preservação do snapshot após editar o risco e recusa de edição/apagamento de avaliação anterior; observar Red.
- [ ] Implementar sequência e gravação transacional com auditoria; proteger atualização concorrente do risco.
- [ ] Testar risco arquivado, método/versão ausentes, texto insuficiente, leitor e recurso externo.
- [ ] Testar a resposta sem scores inventados, sem convite/resposta individual e com autor/data corretos.
- [ ] Comprovar Green e documentar o limite “preliminar”.

### V03-05 — Painel agregado compatível (Bruno; apoio Pedro/Júlia)

**Arquivos:** novo risk-overview.{controller,service,repository}.ts; contrato correspondente; novos testes de agregação.  
**Interface produzida:** GET /risk-overview; resposta v0.2 /overview permanece igual.  
**Aceite:** contagens e gráficos fecham sobre um snapshot de riscos.

- [ ] Criar fixture com contagens conhecidas, rascunhos, arquivos e fichas; observar Red para totais e grupos.
- [ ] Implementar agregação restrita à empresa, sem N+1 nem leitura de respostas individuais.
- [ ] Testar zero registros, arquivados, unidade inativa, grupos múltiplos e omissão de dados externos.
- [ ] Testar contrato antigo /overview sem mudanças e responses private/no-store em ambos.
- [ ] Executar consulta com volume sintético e EXPLAIN em teste; registrar resultado real, não estimativa de produção.

### V03-06 — Fundação visual e shell (Diogo / Thomaz)

**Arquivos:** tokens/styles.css/overview.css e novos estilos por componente; componentes ui existentes; App.tsx/WorkspaceNavigation.tsx sob propriedade de Thomaz.  
**Interfaces:** componentes visuais recebem estado/dado por props; não acessam dados globais de outra empresa.  
**Aceite:** identidade consistente, navegação e foco preservados em todos os temas.

- [ ] Registrar wireframes e estados para 375, 768 e 1440 px; aprovar composição/token sem reabrir a stack.
- [ ] Escrever testes de menu móvel, foco, teclado, troca de empresa e reduced motion; observar Red do novo comportamento.
- [ ] Evoluir shell, botões, cards, campos e tipografia; incluir fonte autorizada/fallback e favicon sem efeito sobre login.
- [ ] Implementar topbar/filtros sticky, drawer com scroll contido e restauração de foco/posição.
- [ ] Verificar Green, contraste, zoom/reflow e ausência de sobreposição dos controles.

### V03-07 — Inventário e ficha no frontend (Thomaz; revisão Diogo/Júlia)

**Arquivos novos propostos:** components/risks/RiskInventory.tsx, RiskForm.tsx, RiskDetail.tsx, PreliminaryEvaluationForm.tsx e testes.  
**Rotas propostas:** #/inventario, #/inventario/novo, #/inventario/:id; query strings guardam filtros/página, sem nomes de trabalhadores ou tokens.  
**Aceite:** formulário funcional e persistência real, não apenas telas demonstrativas.

- [ ] Testar lista/filtros em URL, voltar/avançar, recarga e consulta da origem; observar Red.
- [ ] Implementar lista desktop/cards mobile com paginação, formulário e detalhe consumindo contratos reais.
- [ ] Testar/implementar validação por campo e primeiro erro com foco; preservar rascunho em falha e alertar conflito 409.
- [ ] Testar/implementar expiração de sessão, leitor sem escrita e descarte de resposta antiga ao trocar empresa/rota.
- [ ] Comprovar Green com API real, incluindo criar, recarregar, editar e registrar segunda ficha.

### V03-08 — Dashboard e gráficos animados (Diogo; integração Thomaz)

**Arquivos novos propostos:** ManagementDashboard.tsx, components/charts/OperationalBars.tsx, CompletionRing.tsx e MetricCard.tsx; ampliar apresentação do OrganizationOverview sem mudar seu contrato.  
**Interfaces consumidas:** RiskOverview e visão de estrutura existente, com horários/contextos distintos identificados.  
**Aceite:** dado e drill-down verdadeiros; animação pode ser removida sem perder a função.

- [ ] Testar dados conhecidos, denominador zero, erro, payload inválido e limpeza na troca de empresa; observar Red. Incluir um REGISTERED sem ficha e um ARCHIVED sem ficha: KPI e drill-down WITHOUT devem mostrar apenas o primeiro; o filtro explícito ARCHIVED permite consultar o segundo.
- [ ] Implementar cartões e SVGs com rótulos/lista alternativa, links de unidade e filtros explícitos.
- [ ] Aplicar entrada curta a barras/anel/KPIs por dataset válido, mantendo valor acessível final estável.
- [ ] Testar redução de movimento, aba oculta, dados atualizados durante animação e montagem/desmontagem repetidas.
- [ ] Comprovar Green e comparar representação gráfica/valores com a API; não mostrar séries sem origem.

### V03-09 — Scroll e acabamento transversal (Diogo / Thomaz)

**Arquivos:** hooks/componentes de animação, estilos dos proprietários e testes de scroll de Luiz.  
**Interfaces:** useGSAP/contexto local; nova rota aciona foco/scroll previsível, retorno restaura lista.  
**Aceite:** navegação nativa funciona e efeito não produz área morta ou scroll trap.

- [ ] Testar PageDown, toque, foco após navegação, sticky com zoom e scroll horizontal restrito à tabela; observar Red.
- [ ] Implementar ScrollTrigger só nas seções narrativas pertinentes; cleanup cancela apenas triggers próprios.
- [ ] Verificar primeiro erro/âncora sem ocultação pela topbar e lista restaurada ao voltar do detalhe.
- [ ] Garantir conteúdo final visível com reduced motion ou falha na inicialização do motor.
- [ ] Comprovar Green; inspecionar visualmente claro/escuro em desktop, tablet e celular.

### V03-10 — QA, desempenho e documentação (Luiz / Eliziane)

**Arquivos novos propostos:** tests/e2e/risks.spec.ts, dashboard-v03.spec.ts, scroll.spec.ts; docs/USO_V03.md, UX_V03.md e relatório de verificação.  
**Aceite:** jornadas críticas reproduzidas com dados fictícios e evidências do commit testado.

- [ ] Preparar base/credencial fictícias locais e executar contratos, API, UI, migrações e testes PostgreSQL.
- [ ] Executar jornada diagnóstico → registro → ficha → recarga → painel → filtro → logout, para ADMIN e READER.
- [ ] Executar regressões de privacidade do diagnóstico, isolamento, tema, drawer, reduced motion e favicon.
- [ ] Medir build/frame/interações nos alvos definidos; registrar falhas, limitações e correções sem inventar percentuais.
- [ ] Atualizar guia com funcionalidades realmente entregues, dados de demonstração, limitações e caminho de recuperação.

### V03-11 — Integração e publicação (Ricardo; revisão Luiz)

**Etapa posterior, fora desta preparação local:** não executar commits, push, PR, deploy ou atualização do Trello nesta rodada. Manter arquivos e instruções preparados para revisão da equipe. Os passos abaixo continuam como roteiro de liberação futura, sem afirmar execução.

**Arquivos:** README, manifesto/lockfile quando necessário e checklist/runbook já existentes.  
**Aceite:** revisão válida e CI verde precedem publicação manual do commit correto.

- [ ] Conferir PRs por escopo, revisões e composição na integração v0.3; sem squash quando a política de preservação exigir merge commit.
- [ ] Executar gates completos na composição, abrir PR para main e respeitar aprovação distinta do último push.
- [ ] Após autorização da release, aplicar migração aditiva e provisionamento fictício controlado, sem reset/seed local na nuvem.
- [ ] Publicar manualmente no Render Free a main aprovada; conferir commit ativo e repetir checks públicos/autenticados.
- [ ] Atualizar Trello conforme evidências e registrar rollback verificado; o MVP completo não é considerado concluído por esta versão.

## 7. Cronograma proposto e dependências

**Janela proposta: 16 a 22/10/2026, cinco dias úteis.** Não é prazo já acordado. Planejar sem depender de trabalho em 17–18/10. Se a base v0.2 ou a revisão técnica impedir a sequência, replanejar os marcos em vez de encurtar testes ou prometer publicação.

| Data proposta  | Marco                                       | Frentes em paralelo                                           | Portão                                                               |
| -------------- | ------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| 16/10, sexta   | Recorte, desenho e contratos                | Júlia + Diogo; Pedro revisa modelo; Ricardo prepara base      | Estados, campos, rotas, wireframes e limites técnicos claros.        |
| 19/10, segunda | Fundação e fluxo mínimo                     | Pedro + Bruno: banco/API; Thomaz + Diogo: shell e componentes | Criar/ler um risco real na empresa certa; shell funcional.           |
| 20/10, terça   | Inventário e ficha                          | Bruno + Thomaz; Júlia/Eliziane acompanham critérios           | Editar com versão, preservar histórico e navegar pela origem.        |
| 21/10, quarta  | Dashboard, motion e scroll                  | Diogo + Thomaz; Bruno libera agregação; Luiz amplia cenários  | Gráficos reais, drill-down, temas e reduced motion funcionando.      |
| 22/10, quinta  | Correções, documentação e release candidata | Luiz + Eliziane + Ricardo; demais corrigem sua frente         | CI/revisão/migração e homologação verificadas antes de liberar link. |

Caminho crítico: V03-01 → V03-02 → V03-03/04 → V03-05 → V03-07/08 → V03-10 → V03-11. V03-06 pode avançar em paralelo com os contratos; V03-09 acompanha os componentes prontos.

**Ordem de corte se faltar capacidade:** retirar P1; simplificar ilustração/scroll narrativo; reduzir tipos de gráfico mantendo barras acessíveis e drill-down; preservar inventário, isolamento, histórico, estados, testes e documentação. Não declarar completa uma etapa removida.

## 8. Critérios finais, riscos e decisão de engenharia

### 8.1 Gates de qualidade

| Área                  | Prova exigida                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Funcional             | Dois perfis e duas organizações; CRUD lógico/versão, ficha append-only e painel com dados de origem conferidos.                                                                                  |
| Privacidade           | Nenhum endpoint novo expõe trabalhador, convite ou resposta individual; supressão do diagnóstico preservada inclusive em gráficos/links.                                                         |
| Acessibilidade        | Teclado, foco, zoom de 200%/reflow a 320 px, contraste, gráficos com alternativa textual e reduced motion; alvos principais propostos de 44 px como escolha de usabilidade.                      |
| Responsividade/scroll | Verificar 375, 768 e 1440 px, ambos temas; página sem overflow horizontal; tabela rolável identificada; sticky não encobre foco/erro; drawer não prende a rolagem após fechar.                   |
| Desempenho            | Meta proposta de JS inicial até 200 KB gzip, com módulos pesados carregados sob demanda; WOFF2 alvo até 80 KB. Comparar com build base de aproximadamente 157 KB gzip de JS, sob o mesmo método. |
| Motion                | Transições usuais até 280 ms; entrada de blocos até 450 ms; nenhum loop decorativo no dashboard, sem animação que bloqueie ações ou mascare dados antigos.                                       |
| Release               | Main/revisão/CI, migração aditiva, commit ativo no Render e oito checks públicos mais jornadas autenticadas reais.                                                                               |

LCP ≤2,5 s, INP ≤200 ms e CLS ≤0,1 são referências-alvo de experiência, não resultados medidos nem garantia no Render Free. Separar ensaio com serviço aquecido de cold start. LCP/CLS podem ser inspecionados em laboratório; TBT/tempo de script não substituem uma medição correta de INP. Testar rolagem e interações com CPU reduzida e registrar o dispositivo/condições.

Usar os comandos existentes: `pnpm check`, `pnpm format:check`, `pnpm prisma:validate`, `pnpm test:integration`, `pnpm test:migrations` e `pnpm test:e2e`. Testes de banco/E2E exigem PostgreSQL e credencial/dados fictícios locais preparados; uma execução sem esses pré-requisitos não certifica a versão. As execuções da implementação estão no relatório, separadas dos requisitos de publicação futura.

### 8.2 Casos de borda prioritários

| Caso                                           | Resultado esperado                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Empresa muda durante fetch/animação            | Cancelar/ignorar resposta antiga e limpar dados privados antes de renderizar a nova empresa.                                           |
| Sessão expira durante edição                   | Interromper escrita, limpar visão privada e indicar nova autenticação; rascunho não é enviado para logs.                               |
| Dois administradores editam o mesmo risco      | Uma gravação válida; segunda recebe 409, preserva seu texto e oferece recarregar/comparar, sem sobrescrita silenciosa.                 |
| POST perde a resposta após salvar              | Informar resultado incerto e reconsultar; não reenviar automaticamente nem alegar idempotência inexistente.                            |
| Grupo pequeno / resultado suprimido            | Mostrar indisponibilidade, não reconstruir valores por diferença nem criar score.                                                      |
| Arquivo lógico ou unidade inativa              | Histórico continua legível; nova ficha em risco arquivado e novos registros em escopo inativo são recusados.                           |
| Valor zero / sem ficha / sem origem válida     | Estado explicitado, sem divisões por zero e sem confundir ausência de informação com ausência de risco.                                |
| Rede/Neon indisponível ou Render em cold start | Estado de espera/erro recuperável; timeout de leitura limitado e tentativa manual; nenhum mock financeiro/ocupacional substitui a API. |
| Motor de animação falha / reduced motion       | Informação final e operações permanecem utilizáveis; nenhum conteúdo preso com opacity:0.                                              |
| Voltar/recarregar/mudar tamanho                | Filtros e rota consistentes; scroll/foco restaurados; listeners/triggers anteriores removidos.                                         |

**Decisões de engenharia:** evolução da stack existente; novo contrato agregado compatível com v0.2; risco e ficha preliminar separados; dados aditivos com histórico; SVG/GSAP em vez de múltiplos motores; rolagem nativa; sem score técnico ou métrica de conformidade sem validação.

**Condições para iniciar execução:** confirmar recorte/janela com a equipe, congelar V03-01 e identificar a main base. A validação SST libera somente a classificação técnica futura, não é substituída por aprovação de layout. A licença geral do projeto permanece uma decisão conjunta separada.

## 9. Fontes consultadas

- [Resn](https://resn.co.nz/), [Locatelli](https://locatelliadv.com.br/), [Bautz](https://www.bautz.com.br/) e [R. Yazbek](https://ryazbek.com.br/): inspeção visual e DOM nas seções descritas, em 15/10/2026.
- [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) e [GSAP com React](https://gsap.com/resources/React/): integração, contexto e limpeza.
- [Licença padrão GSAP](https://gsap.com/community/standard-license/): uso da biblioteca mantém seus termos próprios e não define a licença do ReNR+.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) e [contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum): metas de acessibilidade.
- [Reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion), [scroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scroll-behavior) e [overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior): comportamento nativo e preferências.
- [Web Vitals](https://web.dev/articles/vitals): metas e distinção entre medição real e laboratório.
