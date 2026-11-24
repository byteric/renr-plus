# Verificação em duas etapas

O ReNR+ aceita códigos temporários de um aplicativo autenticador. Cada titular configura o próprio fator. A plataforma mantém o fluxo de recuperação de senha separado da recuperação do autenticador.

## Ativar e entrar

1. Abra **Segurança da conta → Ativar autenticador** e informe a senha atual.
2. Leia o QR code com o aplicativo autenticador ou adicione a chave manual. Informe o código de seis dígitos que o aplicativo mostra para concluir a configuração.
3. Guarde os códigos de recuperação em um local privado. Eles são mostrados na confirmação e cada código autoriza um único acesso.
4. Na próxima entrada, informe a senha e preencha a etapa de verificação. Se estiver sem o aplicativo, escolha **Usar código de recuperação**. A sessão só é criada depois da confirmação.
5. Para trocar de dispositivo, abra **Segurança da conta → Trocar autenticador** e confirme a senha e o fator atual ou um código de recuperação. A troca revoga o fator, os códigos e as sessões anteriores.

O QR code é gerado pela própria aplicação. Trate a chave manual, o QR code e os códigos de recuperação como credenciais. O aplicativo gera um código a cada 30 segundos, com tolerância de um intervalo para cada lado. Cada intervalo aceito é registrado para impedir a reutilização. O desafio de entrada e a configuração pendente expiram em 5 minutos. Cinco falhas de verificação em 15 minutos esgotam o limite daquela operação para a conta.

## Recuperação assistida

Caso o titular perca o aplicativo e os códigos de recuperação, um responsável nomeado com a concessão `RECOVER_ACCOUNT_MFA` confirma sua identidade por um contato previamente validado e abre **Plataforma → Recuperação de acesso**. O responsável usa uma conta global própria, sem empresa selecionada e com verificação do segundo fator nos últimos 10 minutos. Em seguida, registra a referência do atendimento e entrega o link ao titular por um canal privado.

O titular usa o link de 30 minutos com a senha atual e confirma o novo autenticador. O link autoriza somente a configuração do fator. A conclusão substitui o fator anterior e revoga as sessões e os códigos antigos. Se o titular também esqueceu a senha, use o fluxo de [recuperação de acesso](RECUPERACAO_DE_ACESSO_ID52.md) antes de recuperar o autenticador. Redefinir a senha conserva o segundo fator da conta e invalida as tentativas de login iniciadas com a senha anterior.

## Configuração do ambiente

- `MFA_ENCRYPTION_KEY` aceita uma chave de 32 bytes em Base64URL. Mantenha a chave no cofre de variáveis privadas do serviço e retenha uma cópia protegida para restaurar o ambiente. Preserve a mesma chave em reinícios e novos deploys. Uma troca de chave precisa ser coordenada com a recuperação dos fatores já cadastrados.
- `MFA_REQUIRE_GLOBAL_ADMINS` começa como `false`. Quando ativada, a política exige segundo fator de contas com a concessão `MANAGE_GRANTS`, inclusive em sessões abertas antes de a conta entrar no recorte. A exigência também vale para toda conta em que o fator já foi ativado.
- Nomeie os responsáveis e ensaie a recuperação com contas fictícias em ambiente isolado antes de exigir o fator dos administradores na homologação. Guarde os códigos de recuperação dos administradores em local privado e documente quem pode atender chamados.

O banco conserva o segredo do fator cifrado e os códigos de recuperação como hashes. O histórico registra quem realizou a operação e seu resultado, com os dados necessários ao atendimento. A autenticação segue o [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238). A separação dos fluxos de recuperação segue as práticas de [verificação em duas etapas da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).
