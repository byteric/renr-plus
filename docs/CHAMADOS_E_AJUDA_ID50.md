# Chamados e ajuda contextual

O atendimento ocorre dentro do ReNR+. A ReTech+ define o prazo de cada chamado ao longo do atendimento.

## Percurso por perfil

| Perfil                                             | Caminho                                       | Ações                                                                                                                                 |
| -------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Administrador empresarial sem restrição de recorte | **Gestão → Chamados → Abrir chamado**         | Enviar assunto, categoria e descrição. Abrir o chamado para acompanhar o prazo, a situação e as atualizações da própria empresa.      |
| Equipe ReTech+ com `MANAGE_SUPPORT`                | **Plataforma → Atendimento de chamados**      | Abrir um chamado, atribuir a alguém com a mesma concessão, informar o prazo, registrar uma atualização visível ao cliente e resolver. |
| Equipe ReTech+ com `READ_SUPPORT`                  | **Plataforma → Atendimento de chamados**      | Consultar a fila, o detalhe e o histórico.                                                                                            |
| Equipe ReTech+ com uma concessão de suporte        | **Plataforma → Comercial → Painel comercial** | Consultar o total pendente, vencimentos em até sete dias e vencidos. Seguir o alerta até o chamado correspondente.                    |

O administrador global concede acesso de leitura ou atendimento em **Administração da plataforma → Concessões globais**. A API verifica os vínculos e as concessões também nas consultas diretas. Gestores com recorte, leitores empresariais e perfis somente comerciais ou financeiros ficam fora do suporte.

## Regras de atendimento

- Um chamado aberto ou em atendimento conta como pendente. O prazo é uma data civil. Vencido significa anterior à data corrente em São Paulo. A faixa de próximos sete dias inclui o prazo de hoje.
- Uma atualização exige a versão atual do chamado e uma nota para o cliente. O histórico preserva a autoria, situação, responsável e prazo de cada revisão. Ao resolver, o atendimento é encerrado e o histórico continua disponível para consulta.
- Se a versão mudar durante a edição, o sistema preserva o registro mais recente e pede que o atendente recarregue o chamado antes de salvar.

## Ajuda na própria tela

Abra o botão **?** em Diagnóstico demonstrativo, Inventário, Ações, catálogo de clientes, grupos de empresas, Colaboradores ou Gestão de Pessoas. O texto orienta o próximo passo, com os pré-requisitos e as operações correspondentes ao perfil. O botão **Fechar** ou a tecla **Esc** devolve o foco ao botão de ajuda.

## Arquivos principais

| Área             | Arquivos                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Dados e API      | `prisma/schema.prisma`, migração `20261124050000_internal_support_tickets`, módulo `support` da API e contratos `support.ts` |
| Navegação e fila | `SupportWorkspace.tsx`, `support.css`, `Structure.tsx`, `WorkspaceNavigation.tsx` e `PlatformGrants.tsx`                     |
| Painel           | `commercial-dashboard.service.ts`, `commercial-dashboard.ts`, `CommercialWorkspace.tsx` e `CommercialDashboard.tsx`          |
| Ajuda            | `contextual-help.tsx`, `contextual-help.css` e integrações nos cabeçalhos das sete telas                                     |
| Testes           | Suítes HTTP e PostgreSQL de chamados e painel, `ContextualHelp.test.tsx`, `contextual-help.spec.ts` e `support-id50.spec.ts` |
