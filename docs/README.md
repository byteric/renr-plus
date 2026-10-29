# ReNR+

Plataforma web de apoio à gestão preventiva da NR-01 e de fatores de risco psicossociais relacionados ao trabalho, desenvolvida no Programa de Residência Tecnológica do Porto Digital com acompanhamento da ReTech+.

O MVP conectará, em um único histórico rastreável:

`diagnóstico → inventário → plano de ação → evidências → verificação de eficácia → reavaliação → indicadores`

> O ReNR+ apoia a gestão de condições de trabalho. Não realiza diagnóstico clínico, não expõe respostas individuais e não certifica automaticamente conformidade legal.

## Estado do projeto

A aplicação reúne acesso por empresa, cadastros, instrumentos versionados, coletas protegidas, inventário, ações e evidências privadas. Os IDs 11–20 acrescentam métodos e avaliações técnicas versionadas, atribuição de ações, pareceres de eficácia, reavaliação, encerramento técnico e recuperação explícita de uploads. Instrumentos demonstrativos não constituem validação metodológica; métodos reais dependem de responsável e aprovação técnica. Consulte o [guia de execução](../README.md) e o [guia de promoção dos IDs 11–20](RELEASE_IDS11_20.md). A disponibilidade no link corresponde ao commit ativo no Render, depois da publicação e verificação.

## Escopo do MVP

- autenticação e controle de acesso por perfil;
- cadastro de organização, unidades, setores e responsáveis;
- abertura e acompanhamento de ciclos de diagnóstico;
- consolidação coletiva com proteção de grupos pequenos;
- inventário e avaliação versionada de riscos;
- plano de ação com responsável, prazo, status e forma de aferição;
- registro de evidências e verificação de eficácia;
- reavaliação sem perda do histórico;
- dashboard e relatório básico com rastreabilidade.

Ficam fora do MVP: diagnóstico clínico, prontuário, exposição de respostas individuais, IA decisória, aplicativo nativo, integrações corporativas e certificação automática de conformidade.

## Stack escolhida

- Frontend: React, TypeScript, Vite, Tailwind CSS e shadcn/ui.
- Backend: NestJS com TypeScript, API REST versionada e OpenAPI.
- Dados: PostgreSQL, Prisma ORM e migrações versionadas.
- Arquivos: armazenamento compatível com S3; MinIO no desenvolvimento local.
- Testes: Vitest, React Testing Library, Jest, Supertest e Playwright.
- Ambiente: Docker Compose, GitHub e GitHub Actions.

A arquitetura é um monólito modular. IA não faz parte do MVP; uma porta de integração desacoplada poderá ser adicionada posteriormente sem tornar o fluxo manual dependente dela.

## Equipe

| Integrante | Função principal | LinkedIn | GitHub |
|---|---|---|---|
| Ricardo Severiano de Souza Filho | Coordenação e integração do projeto | [Perfil](https://www.linkedin.com/in/ricardofilhodev/) | [@byteric](https://github.com/byteric) |
| Júlia Oliveira Veríssimo | Produto e requisitos | — | — |
| Diogo Silas Woolley do Carmo | UX/UI e Figma | [Perfil](https://linkedin.com/in/Diowoolley) | [@ildevdio](https://github.com/ildevdio) |
| Thomaz Barros Costa | Frontend | — | — |
| Bruno Sotomayor Martin | Backend e API | [Perfil](https://www.linkedin.com/in/bruno-sottomayor-martin) | [@brunosm26](https://github.com/brunosm26) |
| Pedro Iranildo dos Santos Monteiro | Banco de dados e indicadores | [Perfil](https://www.linkedin.com/in/pedro-ism/) | [@devpedrois](https://github.com/devpedrois) |
| Luiz Henrique Rocha Silva | Qualidade e DevOps | [Perfil](https://www.linkedin.com/in/luiz-henrique-rocha-silva-dev/) | [@Luizrocha0](https://github.com/Luizrocha0) |
| Eliziane Mota de Souza | Documentação e validação | [Perfil](https://www.linkedin.com/in/eliziane-mota) | [@elizianemota](https://github.com/elizianemota) |

## Documentação

- [PRD do MVP](PRD.md)
- [Incremento v0.1 e roteiro de demonstração](IMPLEMENTACAO_V01.md)
- [Incremento v0.2](IMPLEMENTACAO_V02.md)
- [Incremento v0.3](IMPLEMENTACAO_V03.md)
- [Inventário e fichas: guia de uso](USO_V03.md)
- [Contratos e critérios v0.3](CRITERIOS_V03.md)
- [Experiência e acessibilidade v0.3](UX_V03.md)
- [Verificação v0.3](VERIFICACAO_V03.md)
- [Promoção e verificação dos IDs 11–20](RELEASE_IDS11_20.md)
- [Evidências recuperáveis](EVIDENCIAS_RECUPERAVEIS_ID19.md)
- [Diagnóstico demonstrativo](DIAGNOSTICO_V02.md)
- [Histórias e critérios do diagnóstico](CRITERIOS_DIAGNOSTICO_V02.md)
- [Contrato HTTP do diagnóstico](API_DIAGNOSTICO_V02.md)
- [Roteiro de apresentação](APRESENTACAO_V02.md)
- [Verificações de qualidade](QUALIDADE_DIAGNOSTICO_V02.md)

## Governança do repositório

- A branch `main` recebe alterações por pull request, com CI e revisão válidas.
- Ricardo coordena a composição do incremento e a publicação.
- A PR final de Ricardo exige a aprovação independente de um revisor autorizado; Luiz é o revisor solicitado para esta promoção.
- Novos pushes exigem conferir novamente a validade da aprovação e dos checks.
- Conversas de revisão precisam ser resolvidas antes do merge.
- Force push, exclusão da branch protegida e bypass não fazem parte do fluxo.

### Branches da equipe

| Integrante | Branch própria |
|---|---|
| Ricardo Severiano de Souza Filho | `dev/ricardo` |
| Júlia Oliveira Veríssimo | `dev/julia` |
| Diogo Silas Woolley do Carmo | `dev/diogo` |
| Thomaz Barros Costa | `dev/thomaz` |
| Bruno Sotomayor Martin | `dev/bruno` |
| Pedro Iranildo dos Santos Monteiro | `dev/pedro` |
| Luiz Henrique Rocha Silva | `dev/luiz` |
| Eliziane Mota de Souza | `dev/eliziane` |

Cada integrante contribui pela sua branch; Ricardo compõe o incremento na `dev/ricardo`. A `main` recebe a PR final após CI e aprovação independente. O merge commit preserva os commits e suas coautorias. Publicação é manual e ocorre depois das migrações aditivas verificadas.

## Dados e responsabilidade

Use somente dados sintéticos, anonimizados ou formalmente autorizados durante desenvolvimento e demonstrações. Instrumentos, critérios, relatórios, base legal de tratamento e uso de dados reais dependem de validação técnica e jurídica pelos responsáveis competentes.

## Licença

A definir com a ReTech+, o Programa e os integrantes antes da distribuição do software.
