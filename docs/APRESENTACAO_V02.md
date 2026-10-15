# ReNR+ — roteiro do avanço da segunda semana

## Abertura — Pedro

“Nesta etapa, evoluímos a experiência visual e implementamos o primeiro fluxo completo de diagnóstico.
Ele conecta empresa e setor, abertura do ciclo, convite de participação, resposta e resultado coletivo.
São perguntas e participantes fictícios para validar o funcionamento; não se trata de avaliação técnica de riscos.”

## Demonstrar

| Tela               | Mostrar                                                | Explicar                                                                 |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Painel e cadastros | Empresa ativa, unidades/setores e temas                | As informações vêm do banco e respeitam o contexto autorizado.           |
| Diagnóstico        | Criar ciclo, período e setor; abrir                    | Cada aplicação preserva a versão do instrumento.                         |
| Convites           | Fluxo de emissão, sem projetar códigos reais de acesso | Link e código são separados; cada código aceita um envio.                |
| Participação       | Página pública móvel, perguntas e validação            | Não requer conta administrativa; dados de teste são persistidos.         |
| Resultados         | Ciclo encerrado com massa fictícia e supressão         | Só há visão coletiva; grupos pequenos e categorias raras são protegidos. |

Prepare previamente uma massa fictícia de cinco ou mais envios para mostrar a consolidação. Se usar
um ciclo novo com apenas um envio, explique a supressão e depois apresente o cenário consolidado separado.
Não afirmar que esse único envio gerou os resultados de outro ciclo.

## Segurança e próximos passos

“Mantivemos o isolamento entre empresas, as permissões de administrador e leitor e os testes de
persistência e concorrência. O próximo incremento avançará para inventário e acompanhamento dos riscos.
Antes de coleta real, precisamos validar instrumento, metodologia e política de dados com os responsáveis.”

## Perguntar na reunião

- Esse recorte de ciclo, participação e consolidação atende à expectativa do primeiro diagnóstico?
- Qual instrumento/metodologia deve substituir o modelo fictício antes de dados reais?
- Quais resultados coletivos serão úteis para orientar o inventário e o plano de ação?

## Se não usar slides

“A segunda semana entregou o diagnóstico demonstrativo integrado: ciclo, convites, respostas persistidas
e resultados coletivos protegidos, além do refinamento da interface. O restante do MVP permanece em
desenvolvimento. Queremos validar esse fluxo e os critérios técnicos para avançar ao inventário.”
