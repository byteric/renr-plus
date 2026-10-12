# Cenários de validação do painel

| Cenário                      | Preparação                                                | Resultado esperado                                      |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Empresa sem cadastros        | Empresa autorizada com zero unidades e setores            | Totais zero, sem valores simulados                      |
| Cadastros mistos             | Duas unidades, uma ativa e outra inativa                  | Total 2, ativos 1, inativos 1                           |
| Unidade sem setor            | Uma unidade não possui nenhum setor                       | Indicador de unidade sem setores aumenta em 1           |
| Setor inativo                | A única associação da unidade é um setor inativo          | Unidade não é contabilizada como sem setores            |
| Muitos cadastros             | Total superior ao tamanho da página da listagem           | Contagem representa todos os registros, sem truncamento |
| Outra empresa                | Sessão da empresa A consulta o identificador da empresa B | 404; nenhum dado da empresa B                           |
| Leitor                       | Perfil READER consulta a empresa autorizada               | Painel disponível, sem conceder alteração de cadastros  |
| Sem sessão                   | Chamada sem cookie autorizado                             | 401; resposta JSON, não HTML                            |
| Sessão expirada              | Cookie vencido ou sessão removida                         | Volta ao acesso, sem manter indicadores protegidos      |
| Falha da API                 | Resposta 503, perda da conexão ou formato inválido        | Mensagem de falha e nova tentativa, sem zeros enganosos |
| Troca durante carregamento   | Resposta de A chega depois da seleção de B                | Dados de A não aparecem no painel de B                  |
| Acesso móvel                 | Tela estreita e navegação por toque                       | Informações e ações legíveis, sem corte horizontal      |
| Consulta simultânea a edição | Cadastros mudam durante a consulta                        | Contagens lidas em snapshot consistente                 |

Os dados da demonstração e dos testes são sintéticos. Não limpar dados existentes para validar os cenários.
