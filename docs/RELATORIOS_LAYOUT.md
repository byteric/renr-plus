# PDFs de snapshots

`renderReportPdf(snapshot, options?)` recebe somente `ReportSnapshot` e retorna `Promise<Buffer>`. Não consulta banco, API, navegador ou rede. O contrato é validado antes do desenho; linhas com quantidade de células diferente dos cabeçalhos são rejeitadas.

## Composição

A4 retrato (595,28 × 841,89 pt), margens laterais de 40 pt, área de conteúdo até 782 pt e rodapé separado. A marca é a logo vetorial aprovada em `apps/web/public/renr-plus-logo.svg`, copiada sem alterações para os assets do renderer e desenhada com os mesmos paths e transforms. Não há geração de marca nova.

Percurso: tinta `#173E3A`, verde `#579277`, referência de destaque `#D5E7A3`, papel `#F7F8F2`. O destaque não é aplicado quando não há informação que o justifique. Título 25 pt, contexto 12 pt, títulos de seção 14 pt, texto e tabela 9 pt, metadados e rodapé 8 pt. Tabelas têm cabeçalho verde profundo, letras claras e alternância discreta entre branco e verde claro.

O início apresenta título, contexto, referência civil, fuso, criação do snapshot, identificador e filtros. Sinalizações financeiras e nominais refletem os booleanos reais do snapshot. Não se inventa sumário. Relatórios curtos cabem em uma página.

Seções mantêm títulos e cabeçalhos repetidos nas continuações. Células são quebradas em linhas pela largura efetiva da fonte e podem atravessar várias páginas. Identificadores sem espaços são segmentados por pontos de código sem remover caracteres. Notas e limitações fluem após o conteúdo. Rodapés mostram página atual e total. Não se geram páginas antecipadamente apenas para representar espaço entre seções.

Títulos excepcionalmente longos aparecem integralmente na primeira ocorrência; continuações usam o índice da seção quando o título ocupa mais de três linhas. Cabeçalhos acima de 200 pt são rejeitados com solicitação de reduzir o recorte, evitando tabelas sem área útil. Nenhuma linha de dados é truncada para caber no documento.

## Fontes e distribuição

Manrope oficial obtida do [repositório Google Fonts](https://github.com/google/fonts/tree/main/ofl/manrope), sob SIL Open Font License 1.1, preservada em `apps/api/assets/reports/OFL-Manrope.txt` (4.387 bytes).

- `Manrope-Variable.ttf`: original, 164.700 bytes; disponível para reutilização pelo frontend.
- `Manrope-Regular.ttf`: instância estática em peso 400, 97.488 bytes.
- `Manrope-Bold.ttf`: instância estática em peso 700, 97.480 bytes.

As instâncias foram produzidas offline com fontTools 4.62.1 (`python -m fontTools.varLib.instancer ... wght=400/700`), preservando a licença e ajustando os nomes internos Regular/Bold. PDFKit incorpora subconjuntos das duas fontes, com mapa Unicode para extração textual. Não há fallback para Helvetica nem downloads em runtime.

O caminho dos assets é relativo ao módulo (`../../../assets/reports`), compatível tanto com `src/modules/reports` quanto com `dist/modules/reports`. O pacote de distribuição deve incluir `apps/api/assets/reports` ao lado de `dist`; compilar TypeScript não copia esses assets automaticamente.

## Limites e controle de trabalho

Limites máximos do renderer: 250 páginas, 25 MiB de PDF, 4 MiB de conteúdo textual de entrada e 30 segundos. `options.deadline` recebe deadline absoluto em milissegundos; `maxPages` e `maxBytes` só podem diminuir os tetos. Um relógio injetável (`now`) permite testar a interrupção sem depender de espera real.

O deadline é conferido no preflight, em cada palavra e fragmento, a cada linha desenhada, na paginação, ao numerar páginas, nos chunks de saída e antes/depois da conclusão. Tokens longos são medidos em fragmentos limitados a 256 pontos de código, evitando uma medição síncrona única de megabytes de texto. Ao exceder um limite, o renderer rejeita o documento inteiro com `ReportPdfLimitError`, código `REPORT_PDF_LIMIT`, e não retorna PDF parcial. O controle de concorrência de uma exportação por instância pertence ao serviço chamador.

## Verificação realizada

Red observado: ausência de PDF válido e aceitação indevida dos limites na implementação inicial vazia. Green: seis testes em `report-pdf.spec.ts`, usando `pypdf` somente no ambiente de teste para inspecionar dimensões, incorporação de fontes, Unicode, todo o conjunto de 180 registros, identificação sem espaços, referência, notas, limites e paginação. O Python pode ser selecionado com `PDF_TEST_PYTHON`; padrão `python`, com `pypdf` instalado. Não é dependência de produção.

Comando: `node --experimental-vm-modules apps/api/node_modules/jest/bin/jest.js --config tmp/jest-node.config.cjs --runInBand report-pdf.spec.ts`. O typecheck `node apps/api/node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json` também passou.

Com `WRITE_REPORT_PDF_FIXTURES=1`, a suíte grava fixtures sintéticas em `tmp/pdfs/report-{long,compact}.pdf`. A longa teve 21 páginas e cerca de 59 KiB; a compacta, uma página. A longa foi renderizada com Poppler (`pdftoppm`) e inspecionada visualmente nas páginas 1, 11 e 21; a compacta também foi renderizada e inspecionada. Não se observaram cortes, sobreposição de texto, fontes ausentes, rodapés fora da página ou páginas vazias nessa amostra. Não se inspecionou manualmente cada página.

## Gate visual de sete eixos

| Eixo                 | Estado                  | Evidência e limite                                                                                                                                                                                      |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verdade e identidade | Aprovado                | Paths da logo aprovada; dados exclusivamente do snapshot; paleta Percurso; fixtures explicitamente sintéticas.                                                                                          |
| Hierarquia e tarefa  | Aprovado                | Título/contexto/referência antes das tabelas; notas ao final; sem sumário artificial; ver PNG inicial e compacto.                                                                                       |
| Tipografia e voz     | Aprovado                | Manrope 400/700 incorporada e licença local; tamanhos por papel; extração preserva acentos portugueses.                                                                                                 |
| Espaço e composição  | Aprovado na amostra     | Margens e rodapé separados; linhas longas atravessam páginas; PNGs inicial, intermediário e final sem clipping.                                                                                         |
| Física e motion      | Aprovado no escopo      | Documento estático, sem animação ou execução de JavaScript.                                                                                                                                             |
| Acesso e estados     | Parcialmente verificado | Contraste WCAG por luminância: tinta/papel 11,01:1, metadados/papel 6,04:1 e cabeçalhos 11,01:1; texto extraível. Não há alegação de PDF/UA: o PDF não é marcado e leitores de tela não foram testados. |
| Contexto e adaptação | Aprovado no escopo A4   | Compacto de uma página e documento longo; nenhuma equivalência declarada com uma interface responsiva ou visualização móvel.                                                                            |
