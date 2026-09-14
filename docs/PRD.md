# PRD — ReNR+ MVP

**Produto:** Plataforma de Gestão Preventiva para NR-01 e Riscos Psicossociais  
**Status:** Rascunho para validação

## Resumo

O ReNR+ será uma aplicação web para organizar e tornar rastreável a gestão de fatores de risco psicossociais relacionados ao trabalho. O MVP conectará diagnóstico, inventário de riscos, plano de ação, evidências, verificação de eficácia, reavaliação e indicadores.

O produto não realizará diagnóstico clínico, não medirá a saúde mental individual e não certificará automaticamente conformidade legal. Seu papel será apoiar profissionais responsáveis a documentar decisões técnicas, acompanhar medidas preventivas e demonstrar o histórico do processo.

## Problema

Diagnósticos, inventários, planos de ação e comprovações costumam ficar distribuídos entre planilhas, PDFs, e-mails e pastas. Essa fragmentação dificulta descobrir a origem de um risco, os critérios utilizados, o responsável pela ação, a evidência de execução e o resultado da medida preventiva.

## Hipótese do MVP

Se o ReNR+ oferecer um fluxo guiado e rastreável, uma equipe de SST conseguirá conduzir e demonstrar a gestão preventiva com menos dependência de documentos dispersos.

O sinal mínimo de validação será um profissional de SST conseguir executar um cenário completo, da abertura do diagnóstico ao relatório, mantendo a relação entre fonte, risco, decisão, ação, evidência e reavaliação.

## Personas principais

- Profissional de SST: conduz e valida o processo técnico.
- Gestor de unidade ou setor: executa e comprova ações atribuídas.
- Profissional de RH: acompanha resultados coletivos autorizados.
- Trabalhador participante: contribui por meio de instrumentos protegidos.
- Auditor ou mentor: consulta a trilha técnica e o histórico.

## Jornada principal

1. Cadastrar a estrutura organizacional e os perfis autorizados.
2. Abrir um ciclo de diagnóstico e registrar fontes de informação.
3. Consolidar fatores de risco em nível coletivo.
4. Registrar e avaliar os riscos usando critérios versionados.
5. Criar ações preventivas com responsáveis e formas de aferição.
6. Anexar evidências da execução.
7. Verificar a eficácia e reavaliar o risco.
8. Consultar indicadores e gerar um relatório rastreável.

## Requisitos funcionais P0

- **RF-01 — Acesso:** autenticar usuários internos e aplicar permissões por perfil e escopo organizacional.
- **RF-02 — Estrutura:** cadastrar organização, unidades, setores, responsáveis e unidades de avaliação.
- **RF-03 — Diagnóstico:** criar, publicar, acompanhar e encerrar ciclos de diagnóstico.
- **RF-04 — Instrumento:** aplicar um questionário previamente validado e versionado.
- **RF-05 — Outras fontes:** registrar observação, entrevista, oficina ou documento como fonte do diagnóstico.
- **RF-06 — Consolidação:** apresentar resultados coletivos e suprimir grupos abaixo do limiar definido.
- **RF-07 — Inventário:** registrar fatores, exposições, possíveis agravos, medidas existentes e fontes relacionadas.
- **RF-08 — Avaliação:** calcular ou registrar probabilidade, severidade, nível e prioridade com critérios versionados.
- **RF-09 — Plano de ação:** vincular medidas aos riscos, informando responsável, prazo, status, resultado esperado e aferição.
- **RF-10 — Evidências:** anexar documento ou registro textual com data, autor e vínculo à ação e ao risco.
- **RF-11 — Eficácia:** registrar a verificação da medida antes do encerramento definitivo.
- **RF-12 — Reavaliação:** criar uma nova avaliação sem apagar classificações anteriores.
- **RF-13 — Indicadores:** exibir riscos por nível, ações por status e filtros por ciclo, unidade e setor.
- **RF-14 — Relatório:** gerar uma visão consolidada do diagnóstico, inventário, ações, evidências e histórico.
- **RF-15 — Auditoria:** registrar autoria, data e alterações das operações críticas.

## Requisitos não funcionais

- **RNF-01 — Privacidade:** respostas individuais não poderão aparecer em painéis gerenciais.
- **RNF-02 — Autorização:** o backend deverá aplicar menor privilégio e isolamento por organização e escopo.
- **RNF-03 — Proteção:** dados em trânsito usarão HTTPS e segredos não poderão ser versionados.
- **RNF-04 — Rastreabilidade:** registros críticos preservarão autoria, data e histórico.
- **RNF-05 — Acessibilidade:** fluxos críticos buscarão conformidade com WCAG 2.2 nível AA.
- **RNF-06 — Responsividade:** os fluxos administrativos funcionarão em desktop e tablet; a participação será adequada ao celular.
- **RNF-07 — Desempenho:** as telas do piloto deverão responder em tempo compatível com demonstração e os relatórios terão limite de espera definido em teste.
- **RNF-08 — Confiabilidade:** falhas de validação não poderão produzir registros parciais inconsistentes.
- **RNF-09 — Testabilidade:** regras de negócio, autorização e fluxo principal terão testes automatizados proporcionais ao risco.
- **RNF-10 — Manutenibilidade:** módulos terão contratos explícitos e migrações versionadas.
- **RNF-11 — Observabilidade:** erros relevantes terão registros estruturados sem dados pessoais desnecessários.
- **RNF-12 — Portabilidade:** o ambiente local será reproduzível com Docker Compose.

## Critérios de aceite do MVP

- Um cenário completo percorre diagnóstico, risco, ação, evidência, eficácia, reavaliação e relatório.
- Todo risco demonstrado mantém vínculo navegável com sua origem e suas decisões.
- Toda ação publicada possui responsável, status e critério de eficácia.
- Nenhuma resposta individual fica disponível nos painéis coletivos.
- Alterações críticas aparecem na trilha de auditoria.
- O fluxo integrado utiliza dados sintéticos, anonimizados ou autorizados.

## Fora do escopo

- diagnóstico clínico ou prontuário;
- decisão automática sobre pessoas;
- certificação automática de conformidade;
- IA no fluxo P0;
- aplicativo móvel nativo;
- integrações corporativas, SSO e relatórios avançados.

## Questões que exigem validação

- instrumento e metodologia de avaliação;
- matriz de probabilidade, severidade e criticidade;
- limiar mínimo de agregação;
- matriz final de perfis e permissões;
- política de coleta, retenção, exclusão e uso de dados reais;
- formato do relatório esperado para o piloto;
- responsáveis formais pela validação técnica, jurídica e de privacidade.
