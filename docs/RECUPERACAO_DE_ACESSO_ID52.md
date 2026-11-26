# Recuperação assistida de acesso

O titular solicita orientação pela tela de entrada. Um responsável autorizado confere sua identidade em um contato previamente validado, registra a referência da conferência e entrega o link por esse mesmo canal privado. O titular define a nova senha.

## Jornada

1. Na entrada, abra **Esqueci minha senha** e informe o e-mail da conta. A tela dá a mesma orientação para qualquer endereço válido. O titular procura seu contato autorizado para continuar.
2. O responsável empresarial abre **Gestão → Acessos → Recuperar senha** na empresa ativa. Essa operação exige vínculo de administrador sem restrição de recorte e a concessão explícita `ASSIST_COMPANY_PASSWORD_RECOVERY`. Encaminhe ao responsável global contas com vínculos em mais de uma empresa, concessões de plataforma ou consulta de grupo, inclusive quando esses acessos estiverem inativos.
3. O responsável com `MANAGE_PASSWORD_RECOVERY` usa **Plataforma → Recuperação de acesso**. A concessão global de recuperação tem finalidade própria. A autorização é conferida no servidor em cada operação. A emissão exige um responsável distinto do titular.
4. Depois da conferência, marque a confirmação de identidade e informe uma referência curta, como o identificador de um protocolo. Copie o link pelo botão e entregue ao titular pelo contato validado. Use a referência para localizar o registro da conferência, mantendo dados pessoais e credenciais fora desse campo.
5. O titular abre o link, preenche e confirma a senha e volta à entrada. O ReNR+ invalida as sessões antigas. Vínculos e concessões permanecem disponíveis após o novo login.

Cada link vale 30 minutos. Links expirados, consumidos ou revogados apresentam a mesma orientação. A emissão de um link novo invalida os anteriores. A solicitação pública informa como fazer contato e preserva a senha e as sessões da conta. A operação usa o atendimento interno, sem disparos automáticos.

## Ensaio local e ativação

Use um banco de teste local, duas empresas fictícias e contas com as concessões explícitas. Defina `PASSWORD_RECOVERY_ASSISTED_ENABLED=true` apenas no processo do ensaio. A configuração padrão mantém a emissão e o uso de links desabilitados.

Antes da ativação para contas reais, registre a política da ReTech+ com a versão do procedimento, os responsáveis nomeados e os contatos previamente validados. A entrega usa um canal privado existente.

A inicialização da administração global concede apenas as permissões administrativas básicas. A concessão de recuperação exige designação explícita. Uma sessão revogada impede que uma emissão ainda em espera prossiga.

## Contratos da API

| Método e caminho                                        | Resultado                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/v1/auth/recovery/requests`                   | Confirmação pública uniforme `202` para e-mails válidos.                |
| `POST /api/v1/auth/recovery/status`                     | Booleano genérico de disponibilidade do link.                           |
| `POST /api/v1/auth/recovery/confirm`                    | Troca da senha pelo titular e invalidação das sessões em uma transação. |
| `POST /api/v1/organizations/:orgId/password-recoveries` | Emissão assistida no escopo empresarial autorizado.                     |
| `POST /api/v1/platform/password-recoveries`             | Emissão assistida pelo responsável global autorizado.                   |

O banco conserva o hash do segredo e o histórico de emissão, consumo e revogação. O navegador conserva o segredo somente em memória durante a jornada. As respostas de recuperação usam `Cache-Control: private, no-store`. A janela de 15 minutos aceita até 15 orientações, 60 consultas ou 12 confirmações por IP e 15 emissões por operador, por instância da API. Esse controle é separado do login. [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)

## Verificações locais

- HTTP e PostgreSQL cobrem a resposta uniforme, as concessões, o isolamento entre empresas, a expiração, a reemissão, o rollback em falha e a concorrência entre confirmações ou com o login.
- Chromium em desktop e mobile cobre a emissão por perfil, o uso de teclado, os temas claro e escuro, a limpeza do endereço, a revogação de sessão e o novo login.
- A migração `20261125000000_assisted_password_recovery` adiciona a persistência da recuperação e as concessões explícitas. O contrato compartilhado fica em `password-recovery.ts`. As operações da API estão no módulo de identidade e as telas no fluxo de entrada e na área de acessos.
