# Critérios de aceite — painel organizacional

## História

Como administrador ou leitor autorizado, quero consultar a estrutura cadastrada
da empresa selecionada para identificar unidades sem setores e acompanhar os cadastros.

## Critérios verificáveis

1. O painel consulta `GET /api/v1/organizations/:id/overview`, autenticado por sessão.
2. Administrador e leitor consultam somente a empresa selecionada e autorizada na sessão.
3. Sem sessão, a API responde 401. Empresa de outro contexto responde 404, sem dados.
4. Os totais incluem todos os registros da empresa, não apenas a primeira página de uma lista.
5. Ativos e inativos respeitam o status próprio do cadastro. A soma equivale ao total.
6. Uma unidade sem nenhum setor conta em `unitsWithoutSectors`, inclusive se estiver inativa.
7. Um setor inativo ainda é um setor cadastrado; sua unidade não conta como sem setores.
8. Uma empresa vazia apresenta zeros e orientação para começar pelos cadastros.
9. A troca de empresa remove os indicadores anteriores antes de apresentar os novos.
10. Falha de conexão permite nova tentativa. A interface não substitui erro por números fictícios.
11. Sessão expirada remove os dados protegidos e solicita novo acesso.
12. A interface funciona com teclado, em desktop e celular, nos modos claro e escuro.
13. A resposta não inclui nomes de colaboradores, respostas individuais ou credenciais.
14. Estes são indicadores de cadastro, não de riscos, saúde mental ou conformidade legal.

## Fora deste incremento

Questionários, pontuação psicossocial, colaboradores, inventário, ações, anexos e IA.
