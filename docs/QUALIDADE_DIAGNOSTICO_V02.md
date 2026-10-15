# Qualidade — diagnóstico demonstrativo v0.2

Verificação local de 12/10/2026. Somente massa fictícia; PostgreSQL descartável e separado do
banco original. Nenhuma migração ou teste foi executado no Neon.

## Resultados automatizados

| Verificação                                      | Resultado                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Scripts de ambiente, homologação e inicialização | 47 testes passaram                                                |
| Contratos compartilhados                         | 24 testes passaram                                                |
| API sem dependência de banco                     | 100 testes passaram                                               |
| Integração PostgreSQL real                       | 25 testes passaram                                                |
| Interface e cliente HTTP                         | 42 testes passaram                                                |
| Navegador desktop/mobile                         | 28 testes passaram                                                |
| ESLint, TypeScript, build e Prettier             | Passaram                                                          |
| Prisma validate                                  | Schema válido                                                     |
| Migrações                                        | Três aplicadas em banco vazio; repetição sem pendências           |
| Seed                                             | Executado duas vezes; registros existentes preservados            |
| Docker Linux                                     | Build passou; imports do runtime conferidos em contêiner sem rede |

Os resultados da API totalizam 125 testes: os 25 de integração são executados separadamente pelo
comando específico. Não somar novamente uma execução repetida do mesmo teste.

## Casos verificados

- Criação e recarga do ciclo, abertura, emissão de códigos, envio obrigatório, encerramento e frequência calculada de respostas efetivamente persistidas.
- Código de uso único, disputa entre duas submissões, rollback em falha de persistência e concorrência com encerramento.
- Isolamento de organização/versão, ausência de endpoints individuais e bloqueio de mutação pelo leitor.
- Limiar de cinco, supressão de categoria rara, percentuais de múltipla escolha e ausência de dados antes do encerramento.
- Falhas de rede/validação, foco preservado, paginação sem seleção invisível e limpeza de movimento no desmontar.

Capturas intencionais mostram somente dados fictícios e interfaces sem códigos/credenciais.
Traces, vídeos e capturas automáticas ficam desativados nas jornadas que manipulam acesso e convites.

## Correção de regressão

Ao paginar unidades ou setores no formulário de ciclo, uma seleção anterior poderia continuar no estado
sem aparecer no controle. Dois testes reproduziram o envio indevido (Red). A troca de página agora limpa
a seleção e exige nova escolha (Green). A suíte web e a jornada de navegador foram repetidas.

A animação de entrada limita-se ao título e não move o contêiner de campos. O teste de foco cobre
mudança de orientação durante preenchimento; movimento reduzido preserva conteúdo e ações.

## Repetir no ambiente local

Prepare infraestrutura, build, migrações e seed conforme o README, depois execute:

```powershell
pnpm check
pnpm format:check
pnpm prisma:validate
pnpm test:integration
pnpm test:migrations
pnpm test:e2e
docker build -t renr-v02-local .
```

Os comandos de integração e migrações possuem guardas de endereço local. Não desativá-las
nem substituir o banco por uma conexão remota. O teste de migrações remove somente o banco temporário
que criou na própria execução, sem conteúdo do projeto.

## Limites de conclusão

Testes locais não confirmam publicação nem substituem revisão técnica de SST. A validação do commit
publicado será feita após PRs aprovadas e deploy manual no Render Free. Instrumento, metodologia,
política de dados e retenção para coleta real permanecem pendentes.

O limiar demonstrativo não garante anonimato. Convites não comprovam pessoa única, e limitação de
tentativas atrás de proxy requer verificação no ambiente publicado. Nenhum ganho de performance,
conformidade de acessibilidade completa ou certificação legal é declarado.
