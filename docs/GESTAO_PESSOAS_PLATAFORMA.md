# Gestão de Pessoas, plataforma e relatórios

## Áreas e acesso

| Área                     | Escopo                                     | Capacidades                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Indicadores de pessoas   | Empresa ativa da sessão                    | `HR_ANALYTICS_READ`. Indicadores exatos de RH em produção exigem também leitura de perfil, salvo nas empresas sintéticas autorizadas.                                                          |
| Ficha, vínculos e férias | Colaborador da empresa ativa               | `HR_PROFILE_READ` ou `HR_PROFILE_MANAGE`. Alterações exigem gestão de perfil.                                                                                                                  |
| Remuneração e estimativa | Colaborador da empresa ativa               | `HR_COMPENSATION_READ` ou `HR_COMPENSATION_MANAGE`. Alterações exigem gestão de remuneração.                                                                                                   |
| Relatório de pessoas     | Empresa ativa, recorte e seções escolhidos | `HR_EXPORT` e `HR_ANALYTICS_READ`. A inclusão nominal exige leitura de perfil. A inclusão financeira exige leitura de remuneração. As condições de produção dos indicadores também se aplicam. |
| Plataforma               | Resumo e catálogo de clientes              | `READ_OVERVIEW` para consultar, `MANAGE_CLIENTS` para corrigir o catálogo e `MANAGE_GRANTS` para gerir concessões globais. O relatório global exige `READ_OVERVIEW`.                           |

A permissão de administrador da empresa é independente das concessões da plataforma. A plataforma conta cadastros de colaboradores por cliente, preservando vínculos distintos. O recorte padrão de atendimento considera clientes confirmados e com CNPJ estruturalmente válido. Pendências, conflitos e demonstrações têm classificação própria. O identificador original é preservado durante a revisão do cadastro. A validação de dígitos não consulta a situação na Receita.

## Operação e dados

1. Selecione a empresa ativa e abra **Gestão de Pessoas**. Filtre por unidade, setor, situação e competência. Abra **Colaboradores** para consultar ou registrar informações de acordo com seu acesso.
2. Use **Relatórios** na empresa ativa para SST ou Gestão de Pessoas. Escolha seções e recorte, emita e abra a prévia. O PDF é gerado a partir do mesmo snapshot. Na área **Plataforma**, use **Relatórios da plataforma** para o relatório global.
3. Para corrigir vínculos, férias, remunerações ou cadastro fiscal, informe a origem e a justificativa quando solicitadas. O histórico protegido guarda a versão e a autoria. Se houver conflito de versão, recarregue o registro e revise a alteração.

Em produção, `HR_REAL_DATA_ENABLED` começa desativado. O operador pode configurar `HR_DEMO_ORGANIZATION_IDS` com UUIDs de empresas exclusivamente sintéticas para demonstração. A classificação do catálogo é independente dessa lista. Antes de habilitar dados reais, os responsáveis devem definir finalidade, origem, perfis autorizados, retenção, correção e descarte, e validar a regra de cálculo com os dados e políticas aplicáveis. Veja [regras e cobertura das estimativas](REGRAS_CLT_ESTIMATIVAS.md) e [indicadores e supressão](INDICADORES_RH.md).

O primeiro operador global é provisionado uma vez, para uma conta existente. Após compilar e conferir o banco de destino, rode a prévia em ambiente administrativo privado.

```powershell
node --env-file=apps/api/.env apps/api/dist/modules/platform/bootstrap-platform.js --user-id '<UUID-da-conta>' --reason 'Concessão inicial aprovada'
```

Confira o usuário e as capacidades retornadas. Repita com `--apply` para efetivar a concessão e registrar a auditoria. Concessões posteriores passam pela área **Plataforma**, com justificativa e controle de versão.

## Rotas

As rotas usam o prefixo `/api/v1` e a sessão autenticada. Consultas de listas têm paginação. Os recursos da empresa também exigem que o identificador corresponda ao contexto ativo.

| Recurso                        | Rotas                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Indicadores e colaboradores    | `GET /organizations/:orgId/people-overview`, `GET /organizations/:orgId/people/employees`                                                                                                   |
| Perfil e histórico             | `GET/PUT /organizations/:orgId/employees/:id/hr-profile`, `GET /organizations/:orgId/employees/:id/hr-history`                                                                              |
| Vínculos, férias e remuneração | `GET/POST` para `employment-periods`, `vacation-periods` e `remunerations` sob `/organizations/:orgId/employees/:id`. `PATCH` nos mesmos recursos com `/:recordId`.                         |
| Estimativa                     | `POST /organizations/:orgId/employees/:id/settlement-preview`, `GET/PUT /organizations/:orgId/employees/:id/settlement-parameters`                                                          |
| Plataforma e cadastro fiscal   | `GET /platform/capabilities`, `GET /platform/overview`, `GET /platform/clients`, `PATCH /platform/clients/:id`, `GET/PUT /platform/grants`, `GET /organizations/:orgId/client-registration` |

Relatórios usam `GET/POST /organizations/:orgId/reports` ou `GET/POST /platform/reports`. Acrescente `/:id` para a prévia e `/:id/pdf` para download. A API revalida sessão e acesso antes de entregar o PDF. O arquivo é privado e contém referências de evidências, sem URLs públicas. Exportações acima dos limites pedem um recorte menor. Veja [conteúdo e limites de emissão](RELATORIOS_LAYOUT.md).
