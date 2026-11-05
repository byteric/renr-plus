# Regras da estimativa de rescisão CLT

Política: `clt-fixed-indemnified-2026-11-v1`. Implementação pura em `apps/api/src/modules/people/clt-calculator.ts`, sem relógio, banco, rede ou framework. Base normativa pesquisada em 04/11/2026. Trata-se de estimativa, sem afirmar homologação ou aprovação de RH.

## Cenário e dados

Mensalista urbano CLT, prazo indeterminado, salário fixo, dispensa sem justa causa, aviso integral indenizado. Não calcula INSS, IRRF, valor líquido, saque disponível de FGTS, adicionais não informados, convenções coletivas, estabilidade, multas dos arts. 467/477 ou outras causas de desligamento. Remuneração variável e afastamentos complexos retornam resultado parcial, exigindo bases/histórico apurados; o salário fixo informado não é usado como substituto das médias.

`calculateCltSettlement(input: CltCalculationInput): CltCalculationResult` recebe datas civis `YYYY-MM-DD`, no intervalo 1900–9998, sem fuso horário. Datas inexistentes, desligamento anterior à admissão, valores negativos/fracionários, centavos acima de 15 dígitos, dias fora do vínculo e períodos inconsistentes geram `CltInputError`, com `field` e `code=INVALID_CLT_INPUT`.

Valores monetários de entrada são strings de centavos não negativos. A aritmética monetária usa `bigint`; nenhuma soma monetária passa por `number`. Cada rubrica é arredondada uma vez, ao centavo mais próximo, com metade para cima. Saídas monetárias são strings ou `null`, serializáveis em JSON. Datas e contagens usam inteiros seguros.

Históricos e adiantamentos desconhecidos permanecem desconhecidos. Para cálculo completo, informar explicitamente:

- `vacationHistoryKnown: true` e `acquiredVacationPeriods`, inclusive `[]` quando não há saldo adquirido; a confirmação declara que a lista contém todos os saldos ainda devidos.
- `currentAcquisitionStart` do período aberto no desligamento real, `currentAcquisitionHistoryKnown: true` e `unjustifiedAbsences`, inclusive zero.
- `complexLeaveHistoryKnown: true`, `hasComplexLeaves: false`; ausência desses campos não significa ausência de afastamentos.
- `thirteenthHistoryKnown: true` para confirmar dias cobertos computáveis, ou mapa completo `thirteenthComputableDaysByMonth` de dias computáveis por `YYYY-MM`; e `thirteenthAdvanceCents`, inclusive `'0'` se inexistente.
- `fgts.terminationBaseCents` e `fgts.confirmedIncludesPending: true` para estimar a multa separada.

O campo opcional `remunerationType` assume `FIXED` dentro do cenário desta política. `VARIABLE` sinaliza necessidade de apuração externa; não existe cálculo automático de médias neste motor.

## Fórmulas e escolhas explícitas

### Saldo salarial

`R × dias devidos / dias reais do mês do desligamento`. Mês inteiro resulta exatamente em `R`, inclusive fevereiro e meses de 31 dias. É a escolha de produto baseada no documento **histórico** HomologNet, julho de 2013, RN 2.3.1.4; não é apresentada como divisor universal obrigatório para todo caso atual.

Apesar do nome legado, `paidSalaryDays` significa **dias de salário ainda devidos**, incluindo eventual ajuste já apurado pelo responsável por faltas/DSR. O valor explícito pode ser zero. Quando omitido, o padrão é a contagem inclusiva entre o primeiro dia do mês e o desligamento, limitada pela admissão se ocorreu no mesmo mês. Essa omissão assume que o salário desse intervalo ainda está por pagar; o chamador deve substituir pelo número apurado quando houve pagamento parcial. Não há inferência de pagamentos nem cálculo automático de DSR perdido.

### Aviso e projeção

Dias de aviso = `min(90, 30 + 3 × anos completos no desligamento real)`. Valor = `R × dias / 30`. A contagem começa no dia seguinte ao desligamento e termina na data real acrescida desses dias. O período integra o tempo de serviço para férias e 13º. Aniversários de 29 de fevereiro são limitados ao último dia de fevereiro em ano comum; adições de meses preservam o dia âncora, limitado ao fim de cada mês.

### 13º salário

Rubrica `THIRTEENTH` = `R × avos / 12`, separada por ano civil, a partir do ano do desligamento até o ano da projeção. Cada mês civil conta quando possui pelo menos 15 dias computáveis dentro do vínculo projetado. A fração de férias não é usada para contar 13º. Não recalcula saldos de 13º de anos anteriores ao desligamento.

`thirteenthHistoryKnown: true` declara que todos os dias cobertos são computáveis, exceto os meses substituídos pelo mapa explícito. As faltas do período aquisitivo de férias não permitem inferir em qual mês ocorreram perdas de 13º: sem confirmação específica ou mapa, o valor fica `null`. Valores mensais explícitos devem caber no mês e no intervalo coberto pelo vínculo.

O adiantamento informado aparece em `THIRTEENTH_ADVANCE` com sinal negativo. O bruto e o subtotal são anteriores a essa compensação: não representam valor líquido a receber. A ausência do adiantamento informado impede afirmar bruto completo, mesmo que todas as parcelas positivas estejam conhecidas.

### Férias

Direito por faltas injustificadas no aquisitivo: 0–5 → 30 dias; 6–14 → 24; 15–23 → 18; 24–32 → 12; acima de 32 → zero. Não se subtrai cada falta diretamente do saldo de férias.

Adquiridas: cada entrada fornece `acquisitionStart`, `entitlementDays`, `balanceDays`, `concessionDeadline` e `historyKnown`. Valor = `R × saldo / 30 × 4/3`. Entradas com gozo parcial usam somente o saldo ainda devido, nunca o direito integral. O prazo concessivo explicitamente informado é comparado ao término projetado; após esse prazo, dobra-se apenas a remuneração do saldo devido, com o terço. Saldo zero confirmado é zero conhecido. Pagamento em atraso não gera dobra automaticamente; não existe campo que acione tal hipótese.

Proporcionais: `R × direito / 30 × avos / 12 × 4/3`. Contam-se meses de serviço ancorados no início do aquisitivo e uma fração residual superior a 14 dias, até a projeção inclusive. Se o aviso completa o aquisitivo atual, ele vira uma rubrica adquirida simples; o eventual período seguinte gera proporcional separada. Esse novo período está inteiramente no aviso indenizado, sem faltas de trabalho. Não se inventam períodos anteriores ausentes do histórico.

### FGTS

Multa estimada = `40% × base rescisória informada`, somente quando confirmada a inclusão dos depósitos rescisórios e pendências. A base é a base de depósitos devidos do contrato, atualizada para a rescisão; saldo disponível para saque, após retiradas, não a substitui. O motor não estima essa base a partir do salário ou duração do vínculo.

`fgtsPenaltyCents` fica separado das verbas remuneratórias e não é apresentado como saldo disponível. Sem base ou confirmação, é `null`; o bruto pode continuar conhecido se todas as rubricas remuneratórias forem conhecidas.

## Resultado e rastreabilidade

`items` contém código, descrição, centavos conhecidos ou `null`, referência de período/ano e quantidade quando apurada. `subtotalCents` soma somente parcelas positivas conhecidas; não inclui multa FGTS ou compensação de adiantamento. `grossTotalCents` só é publicado com todas as rubricas remuneratórias/históricos necessários conhecidos. `status` é `complete` somente sem pendências, inclusive FGTS; caso contrário é `partial`, com `missingInputs` e `reasons`. Cada resultado inclui `policyVersion` e cópia das fontes. Resultado parcial nunca transforma `null` em zero.

Exemplo: salário `300000`, admissão `2025-01-01`, desligamento `2026-06-30`, aquisitivo atual `2026-01-01`, nenhuma falta, férias adquiridas com saldo 30 e prazo `2026-12-31`, adiantamento zero e históricos confirmados: aviso 33 dias, projeção `2026-08-02`. Saldo `300000`, aviso `330000`, férias adquiridas `400000`, proporcionais `233333`, 13º `175000`: bruto `1438333`. Base FGTS `2000000` confirmada produz multa separada `800000`.

## Fontes oficiais

1. [CLT, arts. 130–147 e 487](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm): direito, aquisição, concessão, indenização e integração do aviso. Trechos também consultados nas compilações oficiais da [Câmara, art. 130](https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=1121392) e [arts. 146–147](https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=1124134), pois o acesso direto ao Planalto apresentou bloqueio nesta sessão.
2. [Lei 12.506/2011](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2011/lei/l12506.htm), também na [compilação do Senado](https://www2.senado.leg.br/bdsf/bitstream/handle/id/580894/CLT_3ed.pdf?isAllowed=y&sequence=1): proporcionalidade e limite do aviso.
3. [Lei 4.090/1962, arts. 1º–3º](https://www.planalto.gov.br/ccivil_03/leis/l4090.htm): doze avos, mês com 15 dias computáveis e rescisão sem justa causa.
4. [Lei 8.036/1990, art. 18, §1º](https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm): indenização de 40% sobre os depósitos do contrato.
5. [HomologNet, Especificação Calcular Verbas Rescisórias, julho/2013, versão 5.0](https://acesso.trabalho.gov.br/data/files/8A7C812D412E236B014130CF9D082897/HomologNet%20Caso%20de%20Uso%20Calcular%20Verbas%20Rescis%C3%B3rias%20Julho_2013.pdf): referência histórica para a escolha de divisor do saldo. Documento localizado no índice oficial; abertura direta retornou 502 nesta sessão. Não se afirma validação integral da versão histórica como sistema atual.
6. [STF, ADPF 501, notícia de 12/08/2022](https://portal.stf.jus.br/noticias/verNoticiaDetalhe.asp?idConteudo=492245&ori=1): invalidação da extensão automática da dobra ao pagamento tardio de férias concedidas no prazo.

## Verificação

Testes em `apps/api/test/clt-calculator.spec.ts`: caso numérico, frações 14/15, faixas de faltas, aviso 30/33/90, ano bissexto, projeção entre anos, aquisição concluída na projeção, gozo parcial, FGTS ausente/não confirmado, históricos desconhecidos, entradas inválidas e centavos grandes.

Red inicial executado: teste do caso numérico falhou com cálculo ainda não implementado. Uma regressão adicional confirmou Red para sobreposição de períodos adquiridos antes da proteção correspondente. O comando focal é `node tmp/run-clt-jest.cjs`. O script temporário contorna falha de resolução do preset/transformador no Jest desta instalação e usa os mesmos testes e `ts-jest` configurados no projeto; não altera configuração compartilhada. Esse resultado não comprova a suíte integral da aplicação.

Resultado final focal: **38 testes passaram**. Também passaram TypeScript estrito (`node node_modules/typescript/bin/tsc --noEmit --strict --noUncheckedIndexedAccess --skipLibCheck --target ES2023 --module commonjs --types node,jest src/modules/people/clt-calculator.ts test/clt-calculator.spec.ts`, executado em `apps/api`) e ESLint nos dois arquivos TypeScript. Prettier aplicado aos três arquivos atribuídos.
