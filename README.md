# 🌐 Cloudflare Edge Platform - Enterprise Serverless Architecture

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Hono.js](https://img.shields.io/badge/Hono.js-4.4-FF0055?logo=hono&logoColor=white)](https://hono.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)

Este é um projeto serverless de nível de produção e alta performance projetado para rodar diretamente na borda (Edge) da Cloudflare. Ele implementa padrões avançados baseados no ecossistema e conceitos do **Cloudflare Computer**, aproveitando a infraestrutura distribuída globalmente para fornecer baixa latência de milissegundos de dígito único e consistência robusta de estado.

---

## 🗺️ 1. Arquitetura do Projeto e Fluxo de Dados

A plataforma utiliza o modelo de processamento distribuído na borda da Cloudflare, acoplando armazenamento rápido em cache (KV), banco de dados relacional transacional serverless (D1), armazenamento binário de alta escala (R2) e estado forte transacional com concorrência otimista via Durable Objects.

### Fluxo de Requisição (ASCII)

```text
                               +------------------------------------+
                               |              Cliente               |
                               +-----------------+------------------+
                                                 |
                                     [Requisição HTTP / HTTPS]
                                                 |
                                                 v
                               +------------------------------------+
                               |   Cloudflare Edge (Cloudflare DNS) |
                               +-----------------+------------------+
                                                 |
                                                 v
                               +------------------------------------+
                               |        Hono Edge Worker            |
                               | (Interceptação & JWT Auth Middleware)|
                               +--------+--------+--------+---------+
                                        |        |        |
         +------------------------------+        |        +------------------------------+
         | (Cache Leitura Rápida)                | (SQL Transacional)                    | (Armazenamento Binário)
         v                                       v                                       v
+------------------+                    +------------------+                    +------------------+
|  Cloudflare KV   |                    |  Cloudflare D1   |                    |  Cloudflare R2   |
|    (KV_CACHE)    |                    |    (Database)    |                    |    (R2_STORAGE)  |
+------------------+                    +------------------+                    +------------------+
                                                 ^
                                                 | (Forte Consistência de Estado)
                                                 v
                                        +------------------+
                                        | Durable Objects  |
                                        | (CounterOrState) |
                                        +------------------+
```

### Detalhes dos Recursos & Bindings

- **Workers Interceptor**: Roteamento rápido baseado em Hono.js e verificação de JWT local (evitando dependências circulares de empacotamento).
- **D1 Database (`DB`)**: Armazenamento relacional serverless baseado em SQLite. Usado para persistência de dados de usuários e logs de auditoria.
- **KV Cache (`KV_CACHE`)**: Banco de chave-valor de baixíssima latência para leitura pesada de configurações e sessões temporárias.
- **R2 Storage (`R2_STORAGE`)**: Armazenamento compatível com S3 e sem taxas de transferência de saída (egress), perfeito para arquivos e mídias estruturadas.
- **Durable Objects (`COUNTER_OR_STATE`)**: Responsável por estado transacional altamente consistente com acesso em thread única coordenada por ID de contexto.

---

## 📂 2. Estrutura Completa de Arquivos

Abaixo está o mapeamento detalhado da estrutura do projeto:

```text
cloudflare-edge-platform/
├── src/
│   ├── durable-objects/
│   │   └── CounterOrState.ts   # Implementação do Durable Object para consistência forte
│   ├── routes/
│   │   └── api.ts              # Endpoints REST e Middleware de Autenticação JWT
│   ├── index.ts                # Entrypoint principal do Worker e exportação do DO
│   └── index.test.ts           # Suíte de testes integrados e mock do ambiente Cloudflare
├── package.json                # Dependências, scripts npm (Vitest 4 e Wrangler 3)
├── tsconfig.json               # Configurações do compilador TypeScript
├── schema.sql                  # Estrutura do banco de dados relacional Cloudflare D1
├── vitest.config.ts            # Arquivo de configuração de teste integrado Vitest 4
└── wrangler.toml               # Configurações do Wrangler CLI (bindings de D1, KV, R2, DO)
```

---

## ⚙️ 3. Instalação

### Pré-requisitos
- Node.js (v22.x ou superior recomendado)
- NPM (v11.x ou superior)
- Conta na Cloudflare (para deploy em produção)

### Passo a Passo

1. Navegue até o diretório do projeto:
   ```bash
   cd cloudflare-edge-platform
   ```

2. Instale as dependências configuradas do projeto:
   ```bash
   npm install
   ```

---

## 🛠️ 4. Configuração

Toda a configuração de ambiente, recursos de banco de dados e bindings de borda estão centralizados no arquivo `wrangler.toml`.

### Banco de Dados D1 (Inicialização Local)

Para criar as tabelas do banco de dados D1 no seu ambiente local, execute o seguinte comando utilizando o Wrangler CLI:

```bash
npx wrangler d1 migrations apply d1-database --local --file=schema.sql
```

Para produção, o mesmo comando pode ser executado sem a flag `--local` após criar o banco no painel da Cloudflare:

```bash
npx wrangler d1 create d1-database
npx wrangler d1 migrations apply d1-database --remote --file=schema.sql
```

---

## 🚀 5. Execução & Uso

### Desenvolvimento Local

Inicie o servidor de desenvolvimento local que simula todo o ecossistema do Cloudflare Workers, KV, R2, D1 e Durable Objects com extrema precisão utilizando o Miniflare interno:

```bash
npm run dev
```

O servidor local iniciará na porta padrão `http://localhost:8787`.

### Endpoints da API

| Método | Rota | Descrição | Requer Auth JWT? |
|--------|------|-----------|------------------|
| `GET` | `/api/health` | Verifica integridade do Worker | Não |
| `GET` | `/api/auth/token` | Gera token de teste JWT | Não |
| `GET` | `/api/users` | Lista usuários persistidos no D1 | Não |
| `POST` | `/api/users` | Cria um usuário no D1 e registra log | **Sim** (Bearer Token) |
| `POST` | `/api/cache` | Grava um par chave-valor no KV Cache | Não |
| `GET` | `/api/cache/:key` | Recupera um valor do KV Cache | Não |
| `POST` | `/api/storage/upload` | Faz upload de arquivo para o R2 Storage | Não |
| `GET` | `/api/storage/download/:key` | Faz download de arquivo do R2 Storage | Não |
| `GET` | `/api/state` | Retorna o contador e estado do Durable Object | Não |
| `POST` | `/api/state/increment` | Incrementa o contador persistente no DO | Não |
| `POST` | `/api/state/decrement` | Decrementa o contador persistente no DO | Não |
| `POST` | `/api/state/set` | Grava estado arbitrário no DO | Não |

---

## 🧪 6. Testes

Os testes são executados de forma totalmente isolada dentro do runtime real das APIs da Cloudflare usando o **Vitest 4** e o plugin oficial `@cloudflare/vitest-pool-workers`.

Para rodar os testes unitários e de integração:

```bash
npm run test
```

### O que é testado?
- Geração correta e estrutura de segurança de payloads JWT.
- Integridade do middleware bloqueando acessos não autorizados com status `401`.
- Leitura, escrita e persistência de dados no **KV Cache**.
- Operações de upload e recuperação de streams e buffers de arquivos binários no **R2 Storage**.
- Conectividade de rede interna e persistência transacional com o stub de **Durable Objects**.

---

## 🛡️ 7. Segurança

A plataforma foi arquitetada seguindo as melhores práticas de segurança de borda:

- **Autenticação Descentralizada**: O JWT é decodificado e validado de forma ultra rápida diretamente no Worker utilizando codificação Base64URL segura nativa da borda.
- **Prevenção de Injeção SQL**: Todas as queries enviadas para o banco de dados serverless D1 utilizam prepared statements (`DB.prepare().bind()`), eliminando qualquer risco de SQL injection.
- **Namespaces Isolados**: Os bindings impedem que o Worker acesse diretamente dados fora de seus escopos explícitos de privilégio configurados no `wrangler.toml`.

---

## 🔍 8. Troubleshooting

### Erro: `Runner @cloudflare/vitest-pool-workers is not supported`
- **Causa**: Ocorre quando o runner ou a configuração do pool do Vitest não encontra o plugin configurado na versão correspondente à do Vitest 4.
- **Solução**: Garantir que o `vitest.config.ts` utiliza o plugin `cloudflareTest` importado de `@cloudflare/vitest-pool-workers` em vez do formato `poolOptions` antigo nas versões legadas do Vitest.

### Warning: `ESM syntax in a file loaded as CommonJS`
- **Causa**: Ocorre se o arquivo de configuração do Vitest ou scripts utilizarem imports ES6 sem o pacote estar explicitly configurado como módulo.
- **Solução**: O arquivo `package.json` possui `"type": "module"` configurado por padrão neste template para suporte nativo a ESM do ecossistema do Cloudflare Workers v3+.

### Concorrência e Conexões com o Durable Object bloqueadas
- **Causa**: Tentativa de instanciar múltiplos stubs locais sem ID compartilhado.
- **Solução**: O projeto utiliza `idFromName("global_state")` para mapear de maneira deterministicamente idêntica o singleton de gerenciamento de estado entre diferentes chamadas HTTP.
