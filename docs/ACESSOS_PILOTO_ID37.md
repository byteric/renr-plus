# ID 37 — Acessos de demonstração por persona

**Estado — preparação validada localmente.** Seis contas internas e uma participação pública foram ensaiadas em duas empresas fictícias isoladas. A emissão e a entrega de novos convites para o piloto hospedado continuam pendentes do cenário, da janela e dos destinatários confirmados. Este guia guarda os escopos e os resultados da verificação.

## Escopo e pré-condições

- Preparar **seis convites individuais de conta** para a empresa fictícia ReNR Dev Studio: visão geral ReTech+, administrador cliente, Camila (SST), João (gestor), Rafael (RH) e Helena (auditora/mentora).
- Preparar **um código público individual** para Ana (respondente), emitido para uma coleta sintética já aprovada. Esse código não cria conta.
- Antes de emitir qualquer convite ou código, confirmar o aceite do cenário e os destinatários autorizados. Para homologação, usar exclusivamente o cenário aprovado e as pessoas que foram autorizadas a recebê-lo. Se isso não estiver confirmado, limitar o ensaio ao ambiente local com dados sintéticos.
- Convites internos não são enviados por e-mail. O link secreto é exibido uma vez na criação ou reemissão; entregá-lo somente ao destinatário, por canal privado. A validade configurável é de 1 a 168 horas; este roteiro recomenda **24 horas**, ajustadas ao horário combinado.
- Usar a empresa fictícia como escopo ativo. Não promover conta cliente a acesso global, não conceder exportação/compensação ao RH sem autorização e não alterar a conta existente de administrador geral da plataforma.

## Matriz de acesso pretendida

| Persona                          | Ativação e escopo                                                                                                              | Acesso permitido no roteiro                                                        | Negado / não conceder                                                                                    | Validade e encerramento                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ReTech+ · visão geral            | Convite temporário `READER` na ReNR Dev Studio; depois concessão global `READ_OVERVIEW` por gestor de concessões já autorizado | Painel e catálogo globais conforme a capacidade de leitura                         | Escrita global, `MANAGE_CLIENTS`, `MANAGE_GRANTS` e rotas da empresa após desativar o vínculo temporário | Convite: 24 h. Após ativação e concessão, desativar o vínculo temporário da empresa antes de usar a visão de plataforma; a concessão global permanece até revogação autorizada |
| Administrador da empresa cliente | Convite `ADMIN` vinculado somente à ReNR Dev Studio                                                                            | Administração e cadastros da própria empresa conforme o produto                    | Painel/catálogo global e dados de outras empresas                                                        | Convite: 24 h; ao terminar, inativar o vínculo temporário ou revogá-lo conforme a necessidade aprovada                                                                         |
| Camila · SST                     | Convite `READER` na empresa + `TECHNICAL_DECISIONS`                                                                            | Percurso SST e registro técnico permitido pela capacidade explícita                | Administração de acessos, decisões sem capacidade e dados fora da empresa                                | Convite: 24 h; revogar/inativar ao encerrar o piloto                                                                                                                           |
| João · gestor de unidade         | Convite `READER` na empresa, sem capacidade adicional até o aceite do ID 34                                                    | Painel, resultados, histórico operacional e filtros autorizados da própria empresa | Escopo global, acesso a outras empresas, escrita/execução de ações e trilha geral de auditoria           | Convite: 24 h; revogar/inativar ao encerrar o piloto                                                                                                                           |
| Rafael · RH                      | Convite `READER` na empresa + `HR_ANALYTICS_READ` e `HR_PROFILE_READ`                                                          | Indicadores agregados e leitura de perfis conforme as capacidades concedidas       | Remuneração, gestão de perfis e exportação (`HR_COMPENSATION_READ`, `HR_PROFILE_MANAGE`, `HR_EXPORT`)    | Convite: 24 h; revogar/inativar ao encerrar o piloto                                                                                                                           |
| Helena · auditora/mentora        | Convite `READER` na empresa, sem capacidades extras até o aceite do ID 34                                                      | Painel, resultados, histórico operacional e filtros autorizados da própria empresa | Auditoria global, outras empresas e escrita                                                              | Convite: 24 h; revogar/inativar ao encerrar o piloto                                                                                                                           |
| Ana · respondente                | Um código de participação individual, sem conta, para uma coleta sintética                                                     | Abrir o formulário público e enviar uma resposta uma única vez                     | Entrar na área autenticada, consultar resultados ou reutilizar o código após consumo                     | Até o fim do ciclo; uso único. Encerrar o ciclo para invalidar códigos ainda não consumidos                                                                                    |

**Regra provisória até o aceite do ID 34:** gestor e auditora permanecem `READER` na empresa fictícia, com leitura do histórico operacional. O vínculo atual autoriza leitura no nível da empresa. Os filtros de unidade e setor recortam a consulta, mas não impõem uma fronteira de autorização. A limitação de acesso do gestor à própria unidade ou setor depende da decisão e da implementação do ID 34. Não habilitar leitura da trilha geral de auditoria. SST recebe apenas `TECHNICAL_DECISIONS`; executar ações exigiria capacidade e atribuição explícitas, fora deste roteiro. O RH recebe somente `HR_ANALYTICS_READ` e `HR_PROFILE_READ`. A conta cliente `ADMIN` continua restrita à própria organização e não recebe concessão global.

## Emissão e ativação das seis contas

Uma pessoa administradora autorizada da ReNR Dev Studio emite cada convite individual em **Acessos → Convites de acesso → Novo convite** (API `POST /api/v1/organizations/{orgId}/access-invites`). Para cada linha da matriz:

1. Preencher nome e e-mail do destinatário autorizado; selecionar papel, capacidades exatas e validade de 24 horas. Informar uma justificativa curta que identifique o piloto sintético e a persona.
2. Conferir organização, papel, capacidades e expiração antes de confirmar. Salvar o link secreto exibido uma única vez em canal privado para aquele destinatário; não colá-lo neste arquivo, em tickets, chat coletivo ou capturas de tela.
3. O destinatário abre o link e conclui a ativação. Para identidade nova, informa nome e senha que satisfaça a política apresentada; para identidade existente, autentica-se com a senha própria. Aceitar o convite ativa um vínculo na organização, mas não altera uma senha existente.
4. Conferir na lista de convites o estado `CONSUMED` e na lista de membros o vínculo, papel, capacidades e estado ativo esperados. Registrar apenas status, validade e resultado da conferência, nunca o token ou a senha.

Depois da ativação, abrir a entrada da aplicação e autenticar com o e-mail convidado e a senha escolhida. As contas com vínculo de empresa entram em **Empresas**. Escolher a empresa fictícia e seguir o percurso da persona. A conta ReTech+ com concessão global entra em **Administração da plataforma**. Links diretos preservam seu destino quando o acesso é autorizado.

### Ativação especial da visão geral ReTech+

1. Emitir para a persona de visão geral um convite de 24 horas como `READER`, sem capacidades de empresa, e entregar o link em privado.
2. Depois que a pessoa aceitar, um gestor de concessões **já autorizado** acessa a área **Administração da plataforma → Concessões globais** e atribui a esse `userId` somente `READ_OVERVIEW`, com justificativa do piloto. Não conceder nem delegar `MANAGE_GRANTS` à conta demonstrativa.
3. Um administrador autorizado da ReNR Dev Studio inativa o vínculo temporário dessa pessoa em **Acessos → Membros da empresa**. A desativação limpa o escopo ativo da empresa nas sessões correspondentes. A pessoa deve sair e entrar novamente; confirmar que a sessão abre a visão da plataforma e que endpoints de organização não ficam disponíveis.
4. Confirmar que o painel global de leitura funciona e que escrita, gestão de concessões e rotas da empresa são recusadas. A concessão `READ_OVERVIEW` deve ser removida por gestor autorizado ao fim do período aprovado. A conta geral preexistente permanece intocada.

Se não houver gestor com autorização `MANAGE_GRANTS`, parar nesta etapa e solicitar a ativação ao responsável autorizado. Não usar bootstrap, não elevar a conta demonstrativa e não contornar permissões.

## Código individual da respondente

1. No ciclo sintético aprovado, confirmar datas, fuso, instrumento publicado e estado aberto. Usar a área de Coletas/avaliações e emitir **exatamente um** convite (API: `POST /api/v1/organizations/{orgId}/assessment-cycles/{cycleId}/invites`, corpo com `count: 1`).
2. Guardar o código mostrado apenas para entrega privada a Ana. O código dá acesso somente ao formulário daquele ciclo, não identifica uma conta autenticada e expira no horário final do ciclo.
3. Fazer uma única submissão durante a demonstração. A participação é de uso único; depois do consumo, nova tentativa com o mesmo código deve ser indisponível. Não tentar testar com dados pessoais.
4. Não há rota para revogar apenas um código individual. Se um código for compartilhado indevidamente ou o ciclo precisar ser encerrado, fechar o ciclo (`POST /api/v1/organizations/{orgId}/assessment-cycles/{cycleId}/close`). O estado fechado bloqueia códigos remanescentes, consumidos ou não. Confirmar o estado fechado e registrar que a coleta demonstrativa acabou.

## Encerramento, revogação e registro

- **Convite ainda pendente:** em **Acessos → Convites de acesso**, revogar antes da validade se não for mais necessário (`POST /api/v1/organizations/{orgId}/access-invites/{inviteId}/revoke`). Convite expirado, revogado ou consumido não pode ser aceito. Reemissão invalida o link anterior e gera um novo segredo de exibição única.
- **Conta já ativada:** inativar o vínculo em **Acessos → Membros da empresa**. Para a persona ReTech+, o gestor autorizado também desativa `READ_OVERVIEW` na área de concessões. Confirmar que o percurso protegido fica indisponível mesmo com a sessão aberta. Na sessão de teste, usar **Sair** e verificar que voltar ao percurso pede autenticação.
- **Código público:** a validade termina com o ciclo; código consumido não pode responder novamente. Para invalidar qualquer código ainda aberto, encerrar a coleta. A aplicação não oferece revogação individual de código.
- **Auditoria do processo:** usar a trilha de acesso da organização para conferir concessão/revogação de convites, capacidades e vínculos, sem copiar segredos. Anotar responsável, persona, escopo, expiração, status antes/depois e resultado permitido/negado.

### Folha de controle da execução hospedada

| Persona/código            | Escopo                                                 | Validade                      | Status inicial → final | Permitido conferido | Negado conferido | Responsável/data |
| ------------------------- | ------------------------------------------------------ | ----------------------------- | ---------------------- | ------------------- | ---------------- | ---------------- |
| Visão geral ReTech+       | Plataforma `READ_OVERVIEW`; vínculo temporário inativo | 24 h no convite               | Não executado          | Não verificado      | Não verificado   | —                |
| Administrador cliente     | ReNR Dev Studio                                        | 24 h no convite               | Não executado          | Não verificado      | Não verificado   | —                |
| Camila · SST              | ReNR Dev Studio                                        | 24 h no convite               | Não executado          | Não verificado      | Não verificado   | —                |
| João · gestor             | ReNR Dev Studio                                        | 24 h no convite               | Não executado          | Não verificado      | Não verificado   | —                |
| Rafael · RH               | ReNR Dev Studio                                        | 24 h no convite               | Não executado          | Não verificado      | Não verificado   | —                |
| Helena · auditora/mentora | ReNR Dev Studio                                        | 24 h no convite               | Não executado          | Não verificado      | Não verificado   | —                |
| Ana · código público      | Ciclo sintético aprovado                               | Até o fim do ciclo; uso único | Não executado          | Não verificado      | Não verificado   | —                |

## Percurso local e percurso hospedado

**Ensaio local:** permitido somente com organização, pessoas e dados sintéticos. Percorrer os passos, registrar resultados reais na folha e testar recusas entre escopos distintos. Não reutilizar tokens de exemplo em hospedagem; não registrar o ensaio como aceite do parceiro.

**Homologação hospedada:** condicionada à aprovação explícita do cenário, à confirmação dos destinatários e à autorização para compartilhar cada convite. Emitir novos segredos diretamente no ambiente aprovado, apenas durante a janela necessária; não reutilizar códigos locais. Se a autorização ou a lista de destinatários não estiver confirmada, não emitir nem compartilhar convites/código. O aceite do ID 34 e o piloto do ID 36 permanecem independentes deste roteiro.

## Verificação local de 7 de novembro de 2026

O teste `tests/e2e/personas-id37.spec.ts` emitiu os seis convites pela API da aplicação, ativou cada identidade pelo formulário e autenticou sessões distintas. A fixture `tests/e2e/personas-id37-fixture.ts` preparou duas empresas fictícias em PostgreSQL local descartável. O ensaio passou em Chrome desktop e no perfil mobile Pixel 7.

| Persona                   | Percurso permitido verificado                                                                      | Tentativa negada verificada                                                                                                    | Encerramento verificado                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| ReTech+                   | Entrada na plataforma, painel, catálogo e relatórios globais com `READ_OVERVIEW`                   | Gestão de concessões recusada com 403; painéis das duas empresas recusados com 404                                             | Concessão revogada interrompe leitura global; saída encerra a sessão                                              |
| Administrador cliente     | Entrada em Empresas, área Acessos e consulta de membros                                            | Panorama global recusado com 403; painel da outra empresa recusado com 404                                                     | Vínculo inativo retira o acesso mesmo na sessão aberta; saída encerra a sessão                                    |
| Camila · SST              | Entrada em Empresas, Coletas e criação de método técnico em rascunho com `TECHNICAL_DECISIONS`     | Gestão de acessos recusada com 403; outra empresa recusada com 404                                                             | Vínculo inativo retira o acesso; saída encerra a sessão                                                           |
| João · gestor             | Entrada em Empresas, Painel e indicadores da própria empresa                                       | Gestão de acessos e criação de método técnico recusadas com 403; outra empresa recusada com 404                                | Vínculo inativo retira o acesso; saída encerra a sessão                                                           |
| Rafael · RH               | Entrada em Empresas, Gestão de Pessoas e indicadores com as duas capacidades de leitura concedidas | Remuneração recusada com 403; outra empresa recusada com 404                                                                   | Vínculo inativo retira o acesso; saída encerra a sessão                                                           |
| Helena · auditora/mentora | Entrada em Empresas, Inventário e histórico operacional do risco                                   | Trilha geral de auditoria recusada com 403; outra empresa recusada com 404                                                     | Vínculo inativo retira o acesso; saída encerra a sessão                                                           |
| Ana · respondente         | Código individual abre o formulário público e permite concluir uma resposta                        | Sessão e resultados protegidos recusados com 401; código consumido e código remanescente após fechar o ciclo recusados com 409 | Código consumido; fechamento do ciclo invalida o segundo código emitido exclusivamente para testar o encerramento |

Os convites internos do ensaio tinham validade de duas horas. O teste conferiu a expiração e o código público com o mesmo término do ciclo. A recomendação operacional de 24 horas deve ser ajustada à janela do piloto. Após uma única resposta, a consulta administrativa continuou com resultado `SUPPRESSED`, conforme o limiar de cinco.

A identidade, os vínculos e a organização ativa da conta administrativa do seed foram comparados antes e depois. A sessão administrativa global da fixture conservou as três concessões e o acesso à leitura global e à gestão de concessões. As permissões das demais personas foram consultadas no endpoint de capacidades e comparadas com a matriz exata.

A limpeza atingiu somente os identificadores fictícios da fixture. Os processos, o banco e o bucket temporários do ensaio foram encerrados e removidos. Os convites locais foram consumidos ou revogados. A evidência local comprova o comportamento técnico das personas e precede a execução hospedada e o aceite com os representantes.

Na checagem geral, lint e tipos passaram, assim como os 170 testes de contratos, os 238 testes unitários da API e os 342 testes carregados da interface. A suíte `PeopleWorkspace.test.tsx` falhou no carregamento de `@testing-library/react` pelo Vite. Na repetição isolada, seus 20 testes passaram. A rodada `pnpm check` permaneceu reprovada por essa falha de carregamento. A formatação geral passou em `pnpm format:check`.

O build completo passou em uma execução separada de `pnpm build`.
