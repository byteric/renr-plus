# Indicadores de RH (ID25)

`PeopleAnalyticsService.overview` produz o contrato `peopleOverviewSchema` em uma transação PostgreSQL `RepeatableRead`. A autorização é revalidada dentro da transação: vínculo organizacional ativo e `HR_ANALYTICS_READ`. ADMIN e concessões globais não substituem essa capacidade. Valores financeiros exigem adicionalmente `HR_COMPENSATION_READ` ou `HR_COMPENSATION_MANAGE`; sem isso, as consultas financeiras não são executadas e as três métricas financeiras retornam `FORBIDDEN`.

## Referência e população

A referência é a data civil atual no fuso da organização. Não se aceita uma data histórica na query. A competência salarial é explícita na resposta; quando omitida, usa o mês dessa referência. Unidade e setor devem pertencer ao tenant e, quando ambos informados, à mesma relação.

`population` conta registros Employee, não pessoas naturais únicas. Sem `isActive`, inclui ativos e inativos. As métricas e distribuições consideram somente os ativos dentro do recorte; portanto, filtrar `isActive=false` produz população inativa e universo elegível vazio. Registros sem perfil não são preenchidos a partir de `createdAt`.

Idade usa anos completos, considerando aniversário de 29/02 em 01/03 nos anos não bissextos. Faixas: até 29, 30–39, 40–49, 50–59 e 60 ou mais. Tempo de casa usa meses completos do único vínculo vigente (`startsOn <= referência` e `endsOn >= referência`, ou sem fim); ausência ou sobreposição é desconhecida. Faixas: menos de 12, 12–35, 36–59, 60–119 e 120 ou mais meses. Gênero é exclusivamente autodeclarado; ausência é desconhecida. A opção “Prefere não informar” é uma categoria separada, mas não integra o numerador de declarações efetivas na métrica de cobertura.

## Férias

Cada ativo recebe uma única categoria, nesta prioridade: saldo vencido confirmado; histórico desconhecido; saldo com prazo entre hoje e hoje + 60 dias, inclusive; acompanhamento; regular. Um período vencido confirmado prevalece sobre histórico desconhecido. Perfil inexistente, histórico não confirmado ou período com histórico desconhecido não resultam em regular. A média de idade e de tempo de casa usa os valores conhecidos e informa a cobertura; valores ausentes não entram como zero.

## Valores financeiros e rescisão

Salários zero são valores conhecidos. Ausência na competência é dado faltante. A massa é a soma dos salários conhecidos, e a média usa a quantidade de salários conhecidos como denominador, com cobertura explícita em ambas. Se nenhum salário é conhecido em um universo não vazio, os valores são indisponíveis. Somas e arredondamento da média usam inteiros exatos (`bigint`) e são transportados como strings em centavos. A média arredonda meio centavo para cima.

A rescisão usa o mesmo motor CLT e a mesma versão de política da simulação individual: dispensa sem justa causa, aviso indenizado, remuneração fixa quando suportada pelo motor. Processa ativos em lotes de até 200 registros, em ordem de UUID, sem consultas por empregado. Usa vínculo atual, salário da competência, perfil, períodos aquisitivos e parâmetros de cálculo persistidos especificamente para a referência atual. Parâmetros ausentes ou com data divergente não produzem zero.

Somam-se apenas `grossTotalCents` conhecidos; o estado global é `INSUFFICIENT_DATA` e o total é nulo se algum ativo não tiver bruto conhecido. FGTS é separado do bruto pelo motor: ausência da base de multa não invalida um bruto que o motor tenha calculado. O contrato não oferece campo para subtotal conhecido; a cobertura indica quantos registros participaram e quantos faltam, respeitando a privacidade. O resultado é uma estimativa, não um TRCT.

## Privacidade HR_MIN5_COMPLEMENT_V1

Qualquer cobertura conhecida ou faltante positiva menor que cinco suprime a métrica: `value`, `known` e `missing` ficam nulos. Categorias de férias também protegem o próprio valor e seu complemento positivo menor que cinco. Se qualquer bucket positivo de uma distribuição tiver menos de cinco registros, todos os buckets dessa distribuição são suprimidos, inclusive o desconhecido. No caso de férias, os indicadores de contagem também são todos suprimidos quando houver bucket pequeno, para impedir inferência combinando métricas. Buckets zero não disparam supressão. Não se reutiliza a política de diagnóstico.

Contagens e distribuições são calculadas no PostgreSQL, sem carregar a população em memória. As consultas financeiras são separadas das demográficas; apenas a rescisão percorre lotes limitados.

Partições por setor com categorias ou coberturas raras também suprimem indicadores que permitiriam deduzi-las pela diferença entre recortes. Em produção, o acesso agregado sem leitura de perfil fica limitado aos contadores estruturais. Empresas sintéticas na lista de configuração têm acesso aos indicadores de demonstração conforme as capacidades concedidas.

## Verificação

Na raiz, execute `pnpm --filter @renr/api test people-analytics.spec.ts`.

Para a integração PostgreSQL local, use `pnpm test:integration` com o ambiente de testes configurado. As fixtures são sintéticas, isoladas por UUID e removidas ao final. A integração verifica a prioridade exclusiva de férias, a inclusão do limite de 60 dias, a distinção entre falta de dados e zero, a contagem populacional e a exatidão monetária acima de `Number.MAX_SAFE_INTEGER`.
