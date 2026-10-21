# ReNR+

Plataforma web de apoio à gestão preventiva da NR-01 e de fatores de risco psicossociais relacionados ao trabalho, desenvolvida no Programa de Residência Tecnológica do Porto Digital com acompanhamento da ReTech+.

O MVP conectará, em um único histórico rastreável:

`diagnóstico → inventário → plano de ação → evidências → verificação de eficácia → reavaliação → indicadores`

> O ReNR+ apoia a gestão de condições de trabalho. Não realiza diagnóstico clínico, não expõe respostas individuais e não certifica automaticamente conformidade legal.

## Estado do projeto

A base v0.1 implementa login, sessão e cadastros. A v0.2 acrescenta diagnóstico demonstrativo com ciclos, convites de uso único e consolidação coletiva protegida. A v0.3 local conecta inventário, fichas preliminares e dashboards com dados reais, incluindo cadastros por dia. O instrumento é fictício e a ficha não representa pontuação ou validação técnica. Ações, evidências e avaliação técnica validada continuam nos próximos incrementos. Consulte o [guia de execução](../README.md), o [recorte v0.3](IMPLEMENTACAO_V03.md) e o [guia de uso](USO_V03.md). A disponibilidade online depende do commit publicado, não apenas da documentação.

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
- [Diagnóstico demonstrativo](DIAGNOSTICO_V02.md)
- [Histórias e critérios do diagnóstico](CRITERIOS_DIAGNOSTICO_V02.md)
- [Contrato HTTP do diagnóstico](API_DIAGNOSTICO_V02.md)
- [Roteiro de apresentação](APRESENTACAO_V02.md)
- [Verificações de qualidade](QUALIDADE_DIAGNOSTICO_V02.md)

## Governança do repositório

- A branch `main` será protegida contra alterações diretas.
- Toda contribuição será submetida por pull request.
- Pull requests precisarão da aprovação de `@Byteric` antes do merge.
- Aprovações antigas serão descartadas quando houver novas alterações no pull request.
- Conversas de revisão deverão ser resolvidas antes do merge.
- Force push e exclusão da branch protegida permanecerão bloqueados.

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

Cada integrante trabalha e publica commits somente em sua branch. A integração com `main` será feita por pull request revisado e aprovado pela conta `@Byteric`.

## Dados e responsabilidade

Use somente dados sintéticos, anonimizados ou formalmente autorizados durante desenvolvimento e demonstrações. Instrumentos, critérios, relatórios, base legal de tratamento e uso de dados reais dependem de validação técnica e jurídica pelos responsáveis competentes.

## Licença

A definir com a ReTech+, o Programa e os integrantes antes da distribuição do software.
