# Verificação local dos IDs 25 a 30

## Resultado por ID

| ID  | Implementação local                                                                                                              | Verificação                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 25  | Cadastro fiscal, indicadores de RH, histórico de vínculos, remuneração, férias, estimativa, plataforma e snapshots de relatórios | Integração PostgreSQL, compatibilidade do cadastro anterior, vetores de CNPJ, testes do motor CLT e de renderização                     |
| 26  | Gestão de Pessoas, perfis, catálogo global, concessões, filtros e emissão por seção                                              | Testes de interface, recortes autorizados e emissão SST com download em desktop e no perfil Pixel 7                                     |
| 27  | Identidade Percurso, favicon, login e painéis por área                                                                           | Chromium em seis larguras, claro e escuro, reflow CSS de 200%, foco, cursor e decodificação dos ícones                                  |
| 28  | Transições, microfeedback e gráficos com movimento reduzido                                                                      | Testes do frontend e checagens no build de produção                                                                                     |
| 29  | Capacidades independentes, histórico protegido, recortes suprimidos e trava para dados reais                                     | Testes de isolamento, revogação de exportação, acesso global separado e classificação de demonstração sem efeito de autorização         |
| 30  | Paginação, agregação no banco, carregamento sob demanda e limites de PDF                                                         | Benchmark com 100 clientes elegíveis e 10 mil cadastros sintéticos. JavaScript inicial de 177,28 kB gzip, dentro do orçamento de 200 kB |

## Evidências

- A suíte de contratos passou 167 testes e a suíte web passou 345. A suíte da API foi executada com PostgreSQL local. Os cenários afetados pelos ajustes finais de cadastro, OpenAPI, indicadores e relatórios foram reexecutados com sucesso.
- As 21 migrações rodaram em banco vazio. Repetir migração e seed preservou os dados. Os 14 testes de continuidade e expansão em bancos descartáveis passaram.
- A aplicação compilada serviu interface e API na mesma origem. Nas duas larguras testadas com banco real local, o navegador exibiu a prévia, baixou um arquivo com assinatura PDF válida e recebeu HTTP 401 para o mesmo documento após o logout.
- A medição local do recorte de maior concentração registrou p95 de 142,55 ms sem finanças e 559,03 ms com finanças. O PDF sintético com 300 riscos e 1.000 ações foi renderizado em 188 páginas, com p95 de 398,24 ms. Texto acima da capacidade de paginação provocou recusa explícita. Veja [método e resultados completos](DESEMPENHO_ID30.md).

## Condições para publicação e uso real

A evidência visual combina Chromium com fixtures sintéticas e uma jornada de relatório com PostgreSQL local. O zoom a 200% foi medido por CSS. O zoom nativo, a aparência do favicon na barra do navegador e a capacidade do ambiente hospedado sob carga continuam sem verificação.

O cadastro fiscal usa a premissa de um CNPJ completo por organização. Os dados antigos recebem classificação de cliente somente após conferência. A simulação rescisória se limita ao cenário documentado de dispensa sem justa causa com aviso indenizado, remuneração fixa e insumos suficientes. Os responsáveis devem aprovar as regras operacionais e a governança antes da ativação para dados reais. Veja [guia de acesso e operação](GESTAO_PESSOAS_PLATAFORMA.md) e [regras de cálculo e fontes](REGRAS_CLT_ESTIMATIVAS.md).
