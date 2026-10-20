# Sistema de locação para festas e eventos

Controle de materiais (mesas, cadeiras, toalhas, utensílios...), reservas por data, clientes, contrato para imprimir,
pagamentos em parcelas e caixa. Funciona no celular e no computador. **Não precisa instalar nada além do Node.js 22.**

## O que ele faz
- **Catálogo e disponibilidade por data**: informe o período e veja o que está livre; o sistema não deixa reservar o mesmo item duas vezes.
- **Locações**: reservar, editar (antes da entrega), entregar com conferência, receber a devolução, cancelar.
- **Entrega e devolução**: checklist de materiais, quem entregou e quem recebeu; faltantes e quebrados ficam bloqueados até você consertar ou dar baixa.
- **Clientes**: cadastro, histórico de locações, WhatsApp com um toque.
- **Contrato para imprimir ou salvar em PDF**, com os dados da sua empresa e as condições que você escrever.
- **Pagamentos e parcelas**: recebimento parcial, parcelas mensais, aviso de vencidas, estorno.
- **Caixa**: entradas e saídas por mês e categoria, exportação para planilha (CSV).
- **Equipe**: administrador e funcionários, cada um com seu e-mail e senha.
- **Cópia de segurança**: automática todo dia no servidor e botão para baixar.

## Usar no seu computador (teste)
1. Instale o Node.js 22 ou mais novo (https://nodejs.org).
2. Abra a pasta do sistema no terminal e rode: `node server.js`
3. Acesse http://localhost:3000 e crie o acesso do administrador.
4. Para abrir no celular na mesma rede Wi‑Fi, use o endereço do computador (ex.: `http://192.168.0.10:3000`).

Os dados ficam na pasta `data/`. Copie essa pasta para fazer backup.

## Publicar na internet (para usar de qualquer lugar)
O banco de dados é um arquivo (SQLite). Por isso a hospedagem **precisa ter disco persistente**; em planos gratuitos que apagam os arquivos
a cada reinício, você perderia tudo. Opções:

- **Render**: o arquivo `render.yaml` já está pronto (cria o serviço com um disco de 1 GB). Envie esta pasta para um repositório no GitHub e use "New → Blueprint". Confira o preço atual do plano com disco.
- **Qualquer serviço com Docker** (Fly.io, Railway, VPS): use o `Dockerfile`, monte um volume em `/data` e defina `TRUST_PROXY=1` e `COOKIE_SECURE=1`.
- **Servidor próprio (VPS)**: `node server.js` atrás de um proxy com HTTPS (Nginx/Caddy).

Use sempre **HTTPS** (os serviços acima já fornecem). Variáveis de ambiente: veja `.env.example`.

### No celular
Abra o endereço no navegador e use "Adicionar à tela inicial" para virar um ícone.

## Segurança em resumo
Senhas guardadas com scrypt; sessão por cookie protegido (HttpOnly, SameSite); bloqueio de 10 minutos após 5 senhas erradas;
verificação de origem nas alterações; política de conteúdo (CSP) sem scripts externos; fotos validadas pelo conteúdo do arquivo;
exportações CSV protegidas contra fórmulas; todas as alterações importantes ficam registradas.

## Testes
- `npm test` — 10 testes automáticos da API e das regras (sem instalar nada).
- `npm run test:e2e` — teste no navegador (precisa do pacote `playwright`).

## Estrutura
```
server.js        inicia o servidor e a cópia diária
src/             regras: login, catálogo, locações, caixa, clientes (SQLite)
public/          telas (HTML, CSS e JavaScript puros, sem build)
test/            testes
```

## Limites desta primeira versão
- Um único negócio por instalação; sem emissão de nota fiscal e sem pagamento online.
- Funciona somente com internet (não há modo offline).
- O modelo de contrato é um ponto de partida: revise as condições com um advogado se precisar de validade jurídica específica.
- A fotos são guardadas no banco (reduzidas para 800 px); para catálogos com milhares de fotos, vale migrar para armazenamento de arquivos.
