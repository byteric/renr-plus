# Verificação ID05 — backend e contratos

Implementação: `workforce.ts` nos contratos; módulo `workforce` na API; Employee com FKs compostas e AssessmentGroup existente com nome, versão e estado; filtros específicos nas listas organizacionais; guardas para grupos inativos em novos riscos/ciclos; migração aditiva com backfill.

Evidência TDD comportamental: testes de grupo inativo em criação de risco e ciclo falharam antes das guardas (persistência alcançada) e passaram depois; teste de serialização falhou antes de mover o lock de leitura para criação do risco e passou depois; identificador Unicode com expansão NFKC reproduziu HTTP500 antes de ampliar somente a coluna normalizada para TEXT, passando depois com201 e duplicata409. A primeira execução por exports ausentes era falha de setup e não foi contabilizada como Red comportamental.

Verificações executadas com Node/pnpm local:

- `--filter @renr/contracts exec vitest run --maxWorkers=1`: 9 arquivos,95 testes aprovados. A execução paralela no sandbox falhou por ENOENT no diretório SSR temporário; execução com worker único fora dessa restrição passou.
- `--filter @renr/api test --testPathIgnorePatterns integration persistence`:20 suítes,145 testes aprovados antes da última guarda de ordem; os testes específicos da guarda foram reexecutados depois.
- Testes finais `workforce.integration`, `workforce.groups`, `workforce.http`, `workforce.openapi`:4 suítes,14 testes aprovados (FK,isolamento,ADMIN,Origin,concurrencyduplicados,status,filtroslegados,histórico,Unicode,contratoOpenAPI).
- API typecheck, Prisma generate/validate, ESLint dos arquivos novos e Prettier dos arquivos atribuídos:aprovados.
- Gate `test:migrations` no PostgreSQL isolado55436:aprovado, incluindo deploy Prisma real em banco vazio,repetição sem migrações pendentes,seed repetido e preservação de dados legados. Novo teste `workforce-migrations` integra o gate e confirma backfill do nome e conservação das referências de grupo/ciclo/risco preenchidos.

Diagnóstico resolvido: a primeira escrita em codificaçãoWindows introduziu bytesCP1252 no schema; o engine nativo falhava lendo UTF-8 e o CLI retornava0sem aplicar. Os arquivos atribuídos foram convertidos para UTF-8. A aplicação SQL manual feita durante investigação não foi usada como prova do deploy Prisma; o gate subsequente confirmou deploy real em outro banco descartável, com `_prisma_migrations` e employees presentes.

Corrida real PostgreSQL: um teste adicional observa a espera em `pg_locks` enquanto outra transação desativa o grupo, e confirma criação de risco409 após o commit. Executado isoladamente:1 aprovado,6 não selecionados. Helper E2E separado em `scripts/workforce-e2e-data.mjs`:apenas prefixo `e2e-workforce-<UUID>`,ID/nome exatos e banco loopback; sem apagar identidades de usuários.

Nenhum banco5432,deployexterno,push,commit ou arquivo frontend foi alterado por este trabalho.
