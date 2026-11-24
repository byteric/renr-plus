# Atualização de colaboradores por planilha

Em **Colaboradores → Atualizar por planilha**, use o modelo Excel da empresa ativa. A coluna **Matrícula** identifica um registro já existente e deve ser preenchida como texto. Preencha **Nome**, **Unidade** e **Setor** apenas quando quiser mudar o valor. Células vazias mantêm o cadastro atual. Se a unidade mudar, o setor informado ou preservado precisa pertencer à unidade de destino.

1. Selecione um arquivo `.xlsx` com até 500 linhas de dados e 1 MiB.
2. Gere a prévia e confira os valores antes e depois. Linhas sem mudança e pessoas ausentes da planilha mantêm o cadastro atual.
3. Corrija matrículas desconhecidas ou repetidas, destinos ambíguos e demais pendências no arquivo. Gere outra prévia antes de confirmar. Para cadastrar pessoas novas, use **Importar Excel**.
4. Confirme em até 15 minutos. Se a confirmação perder a conexão, use **Consultar resultado** na janela do lote antes de reenviar.
5. Confira os totais de pessoas atualizadas e sem mudanças. Abra **Editar colaborador → Histórico de atualizações por planilha** para consultar as versões. Para corrigir uma alteração aplicada, faça uma nova atualização com os valores corretos.

## Contrato e acesso

| Método | Caminho após `/api/v1/organizations/:orgId/employees/bulk-update` | Resultado                                                                                                                                         |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/preview`                                                        | Recebe o campo multipart `file`. Devolve versão, validade, totais e diferenças por linha para o administrador autorizado.                         |
| POST   | `/confirm`                                                        | Recebe `file` e `version`. Aplica o lote validado em transação e devolve as contagens. Repetições da operação reconhecida reutilizam o resultado. |
| GET    | `/:version`                                                       | Consulta o estado `PENDING`, `EXPIRED` ou `CONFIRMED`. O resultado reconhecido traz somente as contagens do lote.                                 |

A prévia fica vinculada à empresa, ao ator, ao arquivo e ao estado dos registros revisados. Versões desatualizadas exigem nova prévia. O servidor revalida a autorização e os destinos antes de gravar. Matrícula, situação, vínculos, fichas de RH e retratos históricos de coletas e relatórios têm operações próprias.

O banco preserva os metadados de confirmação e registra as revisões nominais separadamente da auditoria geral. O arquivo Excel fica disponível apenas durante o processamento da requisição, e os valores da prévia ficam na janela aberta do administrador. A próxima prévia do mesmo administrador na mesma empresa remove recibos pendentes expirados há mais de 24 horas. O fluxo usa o banco e a hospedagem do projeto.

A edição consulta as versões nominais por `GET /api/v1/organizations/:orgId/employees/:employeeId/bulk-update-history`, com paginação e autorização do cadastro.
