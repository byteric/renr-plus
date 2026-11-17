# Relatórios

Emissão e consulta de snapshots de SST, Gestão de Pessoas e administração da plataforma. A prévia e o PDF compartilham os dados congelados da emissão. A API verifica o escopo e as capacidades atuais antes de consultar e baixar.

Consulte o [guia de operação e rotas](../../../../../docs/GESTAO_PESSOAS_PLATAFORMA.md) e os [limites de emissão](../../../../../docs/RELATORIOS_LAYOUT.md).

## Resumo executivo SST

Inclua `executive-summary` em `sectionKeys` do `POST /organizations/:orgId/reports` com `kind: "SST"`. A seleção gera panorama, coletas por setor e prioridades com referências aos registros de origem. As outras seções técnicas continuam disponíveis na mesma emissão. Envie `comparison: { referenceCycleId, currentCycleId }` para incluir a evolução entre ciclos. Os dois precisam estar no recorte solicitado e são comparados com as regras do módulo de coletas.

A síntese registra `executiveVersion: 1` e preserva data, recorte, informações protegidas e referências no próprio retrato. Quando o comparativo protege uma contagem ou distribuição, a emissão aplica a mesma proteção às seções técnicas relacionadas. Prioridades operacionais usam prazos e estados registrados. Níveis de risco e recomendações vêm das avaliações e dos pareceres vigentes de origem. Acesso, prévia e PDF seguem as permissões de SST.

Relatórios anteriores continuam disponíveis. Após emitir retratos da versão executiva, mantenha uma versão da aplicação que saiba ler esse formato ao fazer retorno de publicação.
