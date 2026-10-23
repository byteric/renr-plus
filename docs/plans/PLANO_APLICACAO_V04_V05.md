# ReNR+ — incrementos locais v0.4 e v0.5

## Base e limites

Base: `main` em `c301caae569442a4aa5ccef34111ffaf32f05982`, v0.3 publicada e validada.
A integração desta rodada será conduzida por PRs para `integracao/v04-v05`.
Publicação, mudanças de credenciais e alterações da homologação permanecem fora
do primeiro lote de contratos. A integração v0.3 foi removida
somente depois de comprovar que estava incorporada à `main`.

O incremento v0.4 executa o plano de ações preventivas já definido. A v0.5 acrescenta
evidências privadas às ações; eficácia técnica, reavaliação e relatório consolidado
permanecem nos próximos incrementos. IA continua fora do MVP. Usar dados sintéticos.

## v0.4 — ações acompanháveis

- Uma medida por ação, ligada a risco registrado e escopo ativo. Responsável nominal
  não concede acesso. Prazo civil, resultado esperado e critério de aferição são obrigatórios.
- Contexto original copiado pelo servidor, versão do risco conferida e referência
  opcional a uma ficha do mesmo risco/empresa. Mudanças posteriores não reescrevem a origem.
- Estados: planejada → em execução → execução informada; cancelamento permitido nos
  estados abertos. Edições e transições exigem versão e justificativa. Notas permanecem
  possíveis após estado terminal. Execução informada não comprova eficácia.
- Cada mutação gera uma revisão imutável e auditoria mínima na mesma transação.
  Conflito não causa gravação parcial. Arquivar a origem impede novas ações, não o acompanhamento das existentes.
- Lista e painel usam contagens reais, filtros e paginação. Atraso usa data e fuso da
  empresa, não o relógio do navegador; vencimento hoje não é atraso.

## v0.5 — evidências privadas

Arquivos PDF, PNG e JPEG, até 5 MiB cada, com descrição de 10–1.000 caracteres.
Extensão, tipo declarado e assinatura precisam concordar. Limite de 20 evidências
ativas por ação; nome de objeto gerado no servidor e sem chave pública no contrato.

O backend autentica, autoriza empresa/ação e confere Origin antes do processamento
do upload. O download exige sessão autorizada e usa attachment, nosniff e no-store.
Metadados, autoria, hash e tamanho são preservados. Adição/arquivamento conferem a
versão da ação e acrescentam revisão/auditoria, sem modificar seu estado operacional.
Arquivar não apaga o histórico nem os bytes retidos no bucket privado.

O armazenamento usa S3/MinIO local existente. Falha de armazenamento retorna erro
seguro e não impede consultar ações ou registrar notas. Em falha de persistência,
compensação atinge somente o objeto novo daquela tentativa. Não há repetição automática
de POST de resultado incerto nem promessa de idempotência.

Não há antivírus, garantia de conteúdo seguro, aprovação técnica de evidência ou
eficácia automática. Antes de dados reais, validar política de acesso/retenção e requisitos técnicos.

## Experiência e contratos

Preservar identidade visual, temas, navegação móvel, foco, rolagem nativa e movimento
opcional da v0.3. A área de ações tem lista, formulário, detalhe, histórico e evidências.
Atalhos conectam risco, medida e origem. O painel separa estados de atraso, sem somar
atrasadas como um quinto estado. Módulos novos carregam sob demanda.

Recortes e página ficam na URL. Erros por campo preservam dados; 409 pede releitura
antes de reaplicar. Troca de empresa descarta drafts/dados do contexto anterior e
respostas atrasadas não podem recolocá-los na tela. Leitor não recebe controles de escrita.

Contratos novos são strict e versionados no mesmo prefixo `/api/v1`; contratos anteriores
de risco, diagnóstico e painel continuam compatíveis. Migrações v0.4 e v0.5 são aditivas e separadas.

## Propriedade e composição

| Ordem | Integrante                         | Conteúdo combinado das duas versões                       |
| ----- | ---------------------------------- | --------------------------------------------------------- |
| 1     | Júlia Oliveira Veríssimo           | Contratos, histórias e critérios de aceite.               |
| 2     | Pedro Iranildo dos Santos Monteiro | Schema, migrações e dados sintéticos.                     |
| 3     | Bruno Sottomayor Martin            | API, integridade, concorrência e armazenamento privado.   |
| 4     | Diogo Silas Woolley do Carmo       | Apresentação, métricas, timeline e estilos.               |
| 5     | Thomaz Barros Costa                | Navegação, formulários, ações e evidências integradas.    |
| 6     | Luiz Henrique Rocha Silva          | Regressão, migrações e jornadas ponta a ponta.            |
| 7     | Eliziane Mota de Souza             | Guias técnicos, uso e verificações.                       |
| 8     | Ricardo Severiano de Souza Filho   | Composição, dependências, versão e preparação de release. |

Cada pasta reúne somente o delta final do integrante em relação à v0.3, sem arquivos
intermediários sobrescritos. Um único pacote/commit por integrante contempla as duas versões,
seguido de PR para a integração conjunta quando sua criação remota for autorizada.
Manifestos, tutoriais e ZIPs de envio ficam fora do repositório. A ordem evita depender
de arquivos que só chegarão em uma contribuição posterior.

## Portões de execução

1. Fixar contratos e observar falhas de comportamento; implementar e verificar Green.
2. Aplicar migrações somente no PostgreSQL local exclusivo; testar integridade,
   preservação da v0.3, repetição e imutabilidade.
3. Exercitar API e MinIO local com duas empresas/perfis, falha de objeto/DB, limites,
   concorrência e downloads privados. Nunca usar Neon nos testes locais.
4. Exercitar a interface nos dois temas, desktop/celular, teclado, reflow, conflitos,
   indisponibilidade e recuperação sem duplicação de POST.
5. Executar `pnpm check`, `pnpm format:check`, `pnpm prisma:validate`,
   `pnpm test:integration`, `pnpm test:migrations` e `pnpm test:e2e` na composição.
6. Gerar pacotes individuais, conferir hashes e reproduzir a composição sobre a
   base limpa sem criar commits; somente depois declarar a preparação pronta.

## Estado

Implementação local concluída e verificada em 22/10/2026. Os oito pacotes cumulativos
foram compostos sobre a base limpa e passaram pelos portões locais, incluindo 124 jornadas
de navegador. Resultados e limites estão em `docs/VERIFICACAO_V04_V05.md`.
A integração começa pelo lote de contratos e critérios, sem antecipar a publicação
dos incrementos. A promoção à `main` e o deploy dependem dos portões de verificação
da composição e da revisão exigida pelo repositório.
