# Comercial — IDs 45 e 46

O Comercial reaproveita o cadastro fiscal da Plataforma. A ficha comercial registra responsável, contato, adesão e o plano contratado vigente. O catálogo reúne planos recorrentes e serviços avulsos. A versão registra preço em centavos, unidade de cobrança, início de vigência, condições, limites, recursos entregues e recursos previstos.

## Acessos

Na área **Plataforma → Administração da plataforma → Concessões globais**, quem administra concessões pode liberar **Consultar planos e contratos** ou **Gerenciar planos e contratos**. A consulta permite abrir o cadastro, o histórico e o PDF assinado. A gestão também permite registrar alterações. O acesso global de consulta e os perfis da empresa conservam o escopo que já tinham.

## Roteiro com dados fictícios

1. Abra **Plataforma → Comercial** e cadastre uma oferta. Os valores de referência ajudam a preencher o formulário e passam ao catálogo quando o operador salva.
2. Em **Clientes e contratos**, filtre uma empresa fictícia. Registre o responsável comercial e a data de adesão. A classificação fiscal continua na Administração da plataforma.
3. Cadastre o contrato com início, fim, condições e a versão do plano aplicável na data de início. Consulte o histórico após registrar uma renovação, um reajuste ou um cancelamento. Para corrigir a programação, use **Retirar termo agendado** no termo futuro mais recente e informe o motivo.
4. Na revisão assinada, associe um PDF de até 5 MiB que abra sem senha. O arquivo pode ser baixado pela mesma área com autorização. Se o envio falhar depois de recebido, reenvie o mesmo arquivo.

A data civil da operação segue o fuso de São Paulo. Cada versão do plano tem início de vigência próprio. Uma nova contratação ou renovação escolhe a versão aplicável em sua data de início. Cada revisão já registrada mantém a versão de plano e as condições da contratação, inclusive quando o catálogo muda.

## API

As rotas usam o prefixo `/api/v1/platform/commercial`. Escritas exigem a origem configurada. Leituras usam as concessões comerciais e conservam o recorte da empresa e do contrato.

| Método e caminho                                                           | Resultado                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /plans`                                                               | Catálogo de planos e serviços com suas versões                           |
| `POST /plans`                                                              | Oferta e versão inicial                                                  |
| `POST /plans/:planId/versions`                                             | Versão posterior, com a versão esperada do catálogo                      |
| `GET /clients`                                                             | Clientes paginados com filtros de classificação, situação fiscal e busca |
| `PATCH /clients/:orgId`                                                    | Ficha comercial; a primeira gravação usa versão esperada zero            |
| `GET /clients/:orgId/contract`                                             | Contrato com a revisão e a situação vigentes, ou contrato ausente        |
| `POST /clients/:orgId/contract`                                            | Primeiro registro de contrato da empresa                                 |
| `POST /clients/:orgId/contract/:contractId/revisions`                      | Renovação, reajuste, cancelamento ou retirada de termo agendado          |
| `POST /clients/:orgId/contract/:contractId/revisions/:revisionId/document` | PDF de até 5 MiB enviado no campo multipart `file`                       |
| `GET /clients/:orgId/contract/:contractId/revisions/:revisionId/document`  | Download privado do PDF associado à revisão                              |

O contrato de leitura retorna `SCHEDULED`, `ACTIVE`, `EXPIRED` ou `CANCELLED`, a revisão vigente quando houver e o histórico. Essa leitura oferece a situação contratual para as próximas evoluções. As alterações exigem a versão atual. Para retirar uma revisão ainda sem vigência, envie `kind: WITHDRAW_SCHEDULED`, `revisionId`, `expectedVersion` e `reason`. A retirada acrescenta um evento ao histórico e a vigência anterior volta a reger a situação. O servidor registra o autor e o motivo nas operações comerciais.

## Documentos e operação

O PDF usa o armazenamento privado e o adaptador S3 já existentes, com caminho separado dos anexos de SST. O sistema verifica a estrutura do arquivo, reserva a chave no banco e só libera o PDF depois da confirmação do envio. Uma tentativa pendente pode ser retomada com os mesmos bytes, usando a mesma chave. O download entrega o arquivo como anexo, verifica o tamanho e o SHA-256 e revalida acesso. PDFs finalizados e termos retirados permanecem vinculados ao histórico. Para uso real, a ReTech+ deve aprovar prazos e procedimento de retenção antes de qualquer expurgo.

O fluxo é manual. Assinatura integrada, renovação automática e processamento de pagamentos ficam no pós-MVP. As migrações ampliam o schema e mantêm empresas, cadastros e concessões atuais. Validar o deploy antes de conceder novos acessos. Após a primeira concessão comercial, atualizar abas abertas antes de consultar a plataforma. Usar uma versão que reconheça as novas capacidades para rollback, pois o contrato anterior da API de concessões também pode listar concessões inativas.
