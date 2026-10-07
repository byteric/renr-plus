# ReNR+ — incremento v0.1

Referência: 04/10/2026. Atualização: 07/10/2026. Revisão planejada: 08/10/2026.

## Objetivo e recorte

Entregar uma primeira fatia executável: **login → empresa → unidade → setor**,
com API real, dados persistidos e acesso limitado à empresa autorizada.
Não apresentar esta versão como o MVP completo nem como certificação de conformidade.

## Entregue nesta versão

| Área      | Comportamento implementado                                                             |
| --------- | -------------------------------------------------------------------------------------- |
| Acesso    | Login por e-mail/senha, recuperação de sessão, seleção de empresa e logout             |
| Empresas  | Criar, consultar, editar, inativar e reativar empresas autorizadas                     |
| Unidades  | Criar, consultar, editar e inativar unidades da empresa selecionada                    |
| Setores   | Criar, consultar, editar e inativar setores vinculados a uma unidade                   |
| Perfis    | ADMIN altera cadastros; READER somente consulta                                        |
| Interface | Claro/escuro, navegação responsiva, carregamento, vazio, erro e rascunho preservado    |
| Banco     | Migração aditiva, vínculos, unicidade normalizada e dados sintéticos idempotentes      |
| Auditoria | Autor, operação, recurso e horário; alterações críticas e auditoria na mesma transação |
| Ambiente  | PostgreSQL e MinIO locais, volumes persistentes e verificação de prontidão             |

### Campos e regras

- Empresa: nome obrigatório de 2 a 120 caracteres, identificador fiscal opcional de
  até 32 caracteres e fuso horário IANA válido. O identificador é informativo nesta
  versão; não existe validação de CNPJ nem consulta a serviços externos.
- Unidade: nome obrigatório de 2 a 120 caracteres e código opcional de até 32.
- Setor: nome obrigatório de 2 a 120 caracteres, vinculado à unidade selecionada.
- Nome de unidade não se repete na mesma empresa; nome de setor não se repete na
  mesma unidade, considerando a normalização aplicada pelo servidor.
- Inativação preserva o registro; não apaga histórico nem significa exclusão.
  Nesta v0.1, é um estado cadastral, não bloqueio automático dos cadastros filhos.
- Listas possuem paginação. As regras são verificadas no servidor, não apenas na tela.
- Editar empresa exige selecionar seu contexto; empresas inativas continuam
  selecionáveis para permitir administração e reativação.

## Contrato e dados

API REST sob `/api/v1`; contratos Zod compartilhados entre API e interface.
OpenAPI está disponível localmente em `/api/docs`.

```text
User ── Membership (ADMIN ou READER) ── Organization ── Unit ── Sector
  └── Session (empresa ativa, expiração, hash do token)
AuditEvent (autor e recurso; eventos críticos gravados junto à alteração)
```

Principais rotas:

| Método       | Caminho                                | Finalidade                                  |
| ------------ | -------------------------------------- | ------------------------------------------- |
| POST         | `/auth/sessions`                       | Entrar                                      |
| GET / DELETE | `/auth/session`                        | Consultar sessão e sair                     |
| PUT          | `/auth/session/organization`           | Selecionar empresa autorizada               |
| GET / POST   | `/organizations`                       | Listar vínculos autorizados / criar empresa |
| PATCH        | `/organizations/:id`                   | Alterar empresa selecionada                 |
| GET / POST   | `/organizations/:organizationId/units` | Listar / criar unidades                     |
| PATCH        | `/units/:id`                           | Alterar unidade                             |
| GET / POST   | `/units/:unitId/sectors`               | Listar / criar setores                      |
| PATCH        | `/sectors/:id`                         | Alterar setor                               |

Entrada inválida retorna 400; sessão ausente/expirada, 401; perfil ou origem sem
permissão, 403; recurso fora do escopo, 404; conflito, 409; limite de tentativas, 429;
dependência indisponível, 503. Erros têm identificador de requisição e não expõem senhas.

## Segurança e limites de implantação

- Senhas são derivadas com scrypt; o banco não recebe a senha em texto claro.
- Sessão utiliza token opaco, somente hash no banco, cookie HttpOnly/SameSite=Lax
  e expiração de oito horas. Em produção, o cookie exige Secure.
- Cada requisição privada verifica sessão e vínculo atualizado. Operações de alteração
  verificam a origem autorizada; IDs de outras empresas não liberam acesso.
- Limitação de tentativas de login é local à instância. Antes de produção distribuída,
  substituir por armazenamento compartilhado e validar política operacional.
- HTTPS, backups/restauração, observabilidade, gestão de usuários, recuperação de senha
  e homologação de produção ainda não integram este incremento local.
- MinIO está preparado e verificado, mas não existe tela de anexos/evidências nesta v0.1.
- Não utilizar dados reais de trabalhadores. Nenhuma coleta, diagnóstico clínico ou
  análise individual foi implementada. IA permanece prevista somente no pós-MVP.

## Verificação reproduzível

Com o ambiente preparado conforme o README:

```powershell
pnpm check
pnpm format:check
pnpm prisma:validate
pnpm test:integration
pnpm test:migrations
pnpm test:e2e
pnpm infra:verify
pnpm audit --prod
```

Testes incluem persistência após recarga, entradas inválidas, duplicidade,
autorização ADMIN/READER, isolamento entre empresas, origem externa, logout,
falha de gravação com preservação do texto e navegação desktop/mobile.
O workflow de CI reproduz build, testes e migrações em PostgreSQL de teste.
A composição publicada em `integracao/v01` passou na
[execução remota de qualidade](https://github.com/byteric/renr-plus/actions/runs/37670562273),
verificada em 07/10/2026, após incorporar as contribuições e correções de revisão.

Resultados da CI da integração verificados em 07/10/2026:

- 71 testes de código: 15 de scripts, 6 de contratos, 38 da API e 12 da interface.
- 10 testes de integração com PostgreSQL real.
- 16 testes de navegador: 8 cenários em desktop e mobile.
- Tipos, lint, formatação, build e geração do cliente Prisma aprovados.
- Instalação com lockfile congelado, migrações em banco vazio e repetição de deploy/seed
  aprovadas. Os 10 testes de banco são executados separadamente dos 71 testes de código.

Verificações locais de 04/10/2026: schema Prisma e armazenamento MinIO aprovados;
auditoria de dependências de produção sem vulnerabilidades conhecidas após correções
transitivas restritas ao Prisma CLI. Essas verificações não são etapas da CI descrita
acima e não garantem segurança absoluta nem homologação de produção.

Também é verificada a aplicação de migrações em um banco local inicialmente vazio,
repetindo deploy e seed para conferir idempotência. A base temporária criada por essa
verificação é removida ao final; a base principal é preservada.

## Roteiro de demonstração — aproximadamente 5 minutos

1. Abrir a aplicação local e entrar com `admin1@renr.example`. Não exibir a senha.
2. Selecionar a empresa fictícia e criar uma unidade com nome e código.
3. Recarregar a página: mostrar que a unidade continua no banco.
4. Abrir os setores da unidade, criar um setor, editar e inativar.
5. Alternar modo claro/escuro e mostrar a navegação no viewport móvel.
6. Sair e entrar como `reader@renr.example`: mostrar consulta sem botões de alteração.
7. Explicar que a segunda conta pertence a outra empresa e que os testes verificam
   a recusa de acesso indevido, mesmo por requisição direta à API.
8. Encerrar delimitando: o próximo incremento é diagnóstico; riscos, ações,
   evidências e indicadores ainda serão implementados.

Dados criados manualmente nesta demonstração permanecem no banco. Não reutilizar
nomes em execuções seguintes sem considerar as regras de duplicidade.

## Organização da revisão em 08/10

| Integrante                         | Foco de revisão / próximo trabalho                         |
| ---------------------------------- | ---------------------------------------------------------- |
| Ricardo Severiano de Souza Filho   | Integrar, conduzir demonstração e autorizar publicação     |
| Júlia Oliveira Veríssimo           | Conferir campos, regras e critérios do próximo diagnóstico |
| Diogo Silas Woolley do Carmo       | Conferir UX, estados e consistência com o protótipo        |
| Thomaz Barros Costa                | Conferir interface responsiva e contratos do frontend      |
| Bruno Sotomayor Martin             | Conferir sessão, autorização e endpoints do backend        |
| Pedro Iranildo dos Santos Monteiro | Conferir vínculos, migração e persistência                 |
| Luiz Henrique Rocha Silva          | Reproduzir ambiente, testes e roteiro de demonstração      |
| Eliziane Mota de Souza             | Consolidar evidências, documentação e feedback da mentoria |

Esses focos não constituem comprovação de revisão já realizada pelos integrantes.
Contribuições seguem branches individuais e pull request; Ricardo aprova a integração.

## Próximo incremento — fora desta entrega

Diagnóstico organizacional: instrumento versionado, tipos de perguntas, ciclo,
resposta única, envio completo e agregação protegida. As regras devem seguir o PRD
e as decisões técnicas da mentoria. Colaboradores/perfis mais específicos e módulos
de risco, ação, evidência e indicador não são considerados concluídos por esta v0.1.
