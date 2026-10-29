# Verificação local — métodos e inventário contextual

Data: 25/10/2026. Base: `18e63dd0a5776fbe69027d5cbb707cf567695812`.
Estado: concluído e verificado localmente. Sem commit, push ou publicação deste incremento.

## Entrega e contratos

O ID 11 acrescenta catálogo de métodos, rascunhos, publicação com referência documental,
novas versões e avaliações técnicas imutáveis. Escalas rotuladas e tabela explícita
resolvem nível e prioridade; não há fórmula executável, pontuação presumida ou matriz
normativa fornecida pelo sistema. Uma nova versão não reclassifica o histórico.

O ID 12 acrescenta fonte, avaliação vigente, prioridade, ações e pendências ao inventário.
A partir de 1100 px, o registro abre ao lado da listagem; abaixo disso, abre em página
inteira, mantendo seu endereço. Retorno preserva filtros/página e devolve foco à origem.
A matriz conta todo o recorte e aceita somente uma versão publicada exata por consulta.

Os contratos antigos de `/risks` e das fichas preliminares continuam separados.
As novas rotas e DTOs estão no [contrato de implementação](plans/IMPLEMENTACAO_ID11_ID12.md).

## Banco, autorização e consistência

- Três tabelas aditivas: `evaluation_methods`, `evaluation_method_versions` e
  `technical_risk_evaluations`; referências compostas preservam a organização.
- Migrações `20261025000000_technical_evaluation_methods` e
  `20261025010000_technical_evaluation_integrity`, aplicadas somente no banco local
  isolado `renr_technical_id11_verification`. Nenhuma migração anterior foi reescrita.
- Escritas exigem vínculo ativo e capacidade explícita `TECHNICAL_DECISIONS`.
  ADMIN sozinho não basta. Sessão, origem e organização são verificadas no servidor.
- Registro técnico, incremento da versão do risco e auditoria são atômicos.
  Versões concorrentes e referências alteradas devolvem 409.
- O SQL também bloqueia a hierarquia durante o registro, rejeita escopo inativo e
  demonstrações e confere o SHA-256 do conteúdo técnico congelado.

A vigência usa conteúdo técnico, grupo, setor e unidade. Registrar uma ficha preliminar
ou renomear administrativamente a unidade não invalida a classificação. Alterar conteúdo
técnico ou desativar o contexto retira sua classificação vigente, sem apagar o histórico.
Fontes do ID 09 são referências coletivas; respostas individuais e contagens suprimidas
não são copiadas para a avaliação.

## Evidências executadas

| Verificação                         | Resultado local                                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos e propriedades            | 107 testes aprovados na suíte de contratos, incluindo 5 de definição, completude e determinismo                                                                                                |
| HTTP específico do ID 11            | 10 testes aprovados com PostgreSQL e aplicação Nest reais                                                                                                                                      |
| Persistência específica do ID 11    | 13 testes SQL aprovados sobre as duas migrações aplicadas                                                                                                                                      |
| Integração e persistência completas | 13 suítes aprovadas; 105 testes aprovados e 4 ignorados explicitamente                                                                                                                         |
| UI com fixtures sintéticas          | 30 testes aprovados nos temas claro/escuro; após o ajuste final do painel, 4 testes focais de contexto/matriz aprovados                                                                        |
| Prisma validate                     | Schema válido                                                                                                                                                                                  |
| Migrações                           | Banco vazio, repetição de deploy/seed e regressões das expansões anteriores aprovados; teste adicional aplica os dois scripts do ID 11 sobre dados preenchidos e preserva contexto e histórico |
| Compatibilidade                     | Artefato e contratos congelados v0.3 aprovados sobre o schema ampliado; rollback de aplicação preservou histórico                                                                              |
| E2E técnico específico              | Aprovado em desktop e mobile com frontend compilado, API e banco reais                                                                                                                         |
| Check geral                         | Aprovado: lint, tipos, 52 testes de scripts, 107 de contratos, 155 de API, 199 de frontend e build; testes de banco executados separadamente                                                   |
| Build de produção e formatação      | Aprovados; frontend recompilado com ambiente de produção antes do E2E                                                                                                                          |
| Regressão E2E completa              | 160 testes aprovados: 80 desktop e 80 mobile, sem retries; aplicação compilada com PostgreSQL e MinIO locais                                                                                   |

Regressões tiveram falha observada antes da correção: HTTP retornava 404 antes das
novas rotas; UI não possuía a coluna Fonte; SQL aceitava escopo inativo, fontes
demonstrativas e impressão de contexto arbitrária. Os casos SQL foram isolados por
savepoint para evitar dependência da ordem. A corrida HTTP passou de aceitação indevida
para conflito controlado, preservando a atomicidade. A regressão E2E também identificou
a navegação do painel sob o cabeçalho fixo; o afastamento foi corrigido, com quatro
testes de rolagem desktop/mobile aprovados antes da execução completa final.

O teste E2E específico usa uma organização exclusiva por execução e método 2×3
explicitamente sintético, sem alegar aprovação real. Sua limpeza arquiva somente os
riscos de sua própria fixture e inativa essa organização; não apaga histórico imutável.

## Inspeção visual no escopo

Referência: inventário tabular com contexto lateral, conforme a composição aprovada.
Tokens e identidade existentes foram preservados. A inspeção inclui capturas desktop
1440 px e mobile 375 px; os testes também verificam 1024 e 640 px, retorno pelo navegador
e preservação do recorte. Não há captura de rolagem nem novo motor de animação.

| Eixo                 | Estado e evidência                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verdade e identidade | Aprovado no recorte: ausência de avaliação é explícita, sem risco baixo presumido; método/versão e exclusões vêm da API                                                    |
| Hierarquia e tarefa  | Aprovado: lista, filtros e seleção mantidos no desktop; detalhe contextual possui ação e histórico próprios                                                                |
| Tipografia e voz     | Aprovado: tokens existentes, rótulos funcionais e textos extensos legíveis nas capturas                                                                                    |
| Espaço e composição  | Aprovado: painel delimitado, tabelas em região com rolagem local e sem overflow horizontal da página                                                                       |
| Movimento            | Aprovado no comportamento: foco, retorno e rolagem de seção respeitam redução de movimento; desempenho de quadros não foi medido                                           |
| Acesso e estados     | Verificação parcial: nomes acessíveis, cabeçalhos de tabela, teclado, foco, vazio/erro/sucesso e contraste dos estados cobertos por testes; sem certificação WCAG integral |
| Responsividade       | Aprovado nos tamanhos testados: lista retida no desktop e detalhe em página inteira no mobile; mesmo endereço preservado                                                   |

Capturas sintéticas e logs permanecem nos diretórios locais ignorados
`tmp/id11-ui-evidence` e `tmp/id11-*.log`; não contêm aprovação técnica real.

## Limites e continuidade

O seed normal não publica métodos nem concede capacidade técnica automaticamente.
Para uso real, a ReTech+ ainda precisa fornecer/validar escalas, níveis,
correspondências e responsáveis. Uma referência preenchida documenta uma decisão,
mas não certifica metodologia nem conformidade regulatória.

Cadastro e versionamento de métodos são entregues pela API neste ID; a interface inclui
seleção de versões publicadas e registro de avaliações, sem editor visual de métodos.
Referência documental é texto; não acrescenta upload de arquivos a este fluxo.

Não foram implementados IDs posteriores, eficácia de medidas, relatórios formais ou
identidade global nova. Estes testes não representam benchmark de produção, auditoria
de acessibilidade completa ou validação jurídica. O ambiente remoto não foi alterado.

O diff Prisma mantém duas diferenças legadas de defaults em `instrument_versions`
(`instrument_id` e `creation_transaction`); foram preservadas para compatibilidade.
Não se declara drift zero nem se propõe alteração desses defaults neste incremento.
