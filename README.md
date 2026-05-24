# 🪐 LuaInk Tattoo — Digital Base & Static Automation Pipeline

[![Platform: Plain HTML5 / CSS3](https://img.shields.io/badge/Platform-HTML5%20%2F%20CSS3-orange.svg?style=flat-square)]()
[![Automation: GitHub Actions](https://img.shields.io/badge/Automation-GitHub%20Actions-blueviolet.svg?style=flat-square)]()
[![Infrastructure: Netlify Edge](https://img.shields.io/badge/Hosting-Netlify%20Edge-00C7B7.svg?style=flat-square)]()
[![Security: Blind Scraping API](https://img.shields.io/badge/Security-Proxy%20Bypass-green.svg?style=flat-square)]()

Este repositório armazena a infraestrutura do site institucional e portfólio digital da **LuaInk**, focado na artista Lua, especialista nos estilos de alta fidelidade **BLACKWORK** e **FINE LINE**. 

O projeto adota uma arquitetura de vanguarda baseada em **Jamstack Estático**, utilizando engenharia reversa e rotas assíncronas de CI/CD para alimentar dados em tempo de execução sem inflar o bundle do cliente final ou criar gargalos operacionais.

---

## 🚀 O Conceito: Engenharia "Entregar e Esquecer" (Zero Maintenance)

Exibições tradicionais de feeds sociais dependem de widgets pesados de terceiros (com payloads pagos) ou da instável **API Oficial do Meta (Graph API)**, cujos tokens de longa duração expiram imprevisivelmente a cada 60 dias. 

Para eliminar o retrabalho técnico e blindar a aplicação contra quebras de layout, este projeto implementa um **Pipeline de Persistência Local Assíncrona**. O Instagram da marca funciona apenas como o CMS de backend; o site renderiza os dados de forma estática pura, nativa e local.

### 📊 Fluxo Hidrodinâmico de Dados

```text
 [ Agendador Cron ] -> Roda 1x por semana no GitHub Actions
       │
       ▼
 [ Motor Node.js ] -> Dispara requisição encapsulada via Scrape.do Proxy
       │
       ├──> [ Download Binário ] -> Baixa as 9 fotos mais recentes (Substitui localmente)
       └──> [ Geração de Mapa ]  -> Cria o arquivo compacto 'insta-links.json'
       │
       ▼
 [ Commit Autônomo ] -> Robô do Git injeta as mídias na branch 'main' [skip ci]
       │
       ▼
 [ Netlify Edge ] -> Detecta o push e distribui os assets na CDN global

```

---

## 📁 Anatomia Estrutural do Repositório

O ecossistema é dividido estritamente entre o motor de automação em background e a camada de apresentação do cliente localizada no diretório de produção (`www/`):

```text
├── .github/
│   └── workflows/
│       └── cron-insta.yml       # Orquestrador do pipeline de automação (CI/CD)
├── insta/
│   └── get-insta-feed.js        # Script Node.js (Motor de scraping, download e parse)
└── www/                         # Diretório raiz servido pelo Netlify Edge
    ├── index.html               # Interface principal (Plain HTML estruturado)
    ├── insta-links.json         # Banco de dados de relacionamentos local (JSON público)
    ├── images/
    │   ├── insta_ico.png        # Assets fixos da interface UI
    │   └── insta/
    │       ├── instaFoto_01.jpg # Mídias locais dinâmicas (Auto-atualizáveis de 01 a 09)
    │       └── ...
    └── js/
        └── insta.js             # Script cliente leve para hidratação da galeria (Vanilla JS)

```

---

## 🛠️ Stack Tecnológica & Blindagem contra Bloqueios (Bypass)

O script contido em `insta/get-insta-feed.js` executa uma chamada em endpoints internos do Instagram simulando acessos móveis nativos.

Para contornar as defesas de barreira de IP e CAPTCHAs que o Meta impõe a servidores comuns (como os nós de execução do GitHub Actions), a requisição é envelopada através do gateway do **Scrape.do**, uma API de proxy residencial rotativo de alta performance. O plano gratuito oferece até 5.000 requisições de sucesso mensais, garantindo um teto operacional estável com **custo zero perpétuo**.

---

## ⚙️ Variáveis de Ambiente Requeridas (GitHub Secrets)

Para a execução íntegra do orquestrador em ambiente isolado, é obrigatório mapear duas credenciais criptografadas no painel do repositório (**Settings -> Secrets and variables -> Actions**):

| Variável | Descrição | Exemplo de Valor |
| --- | --- | --- |
| `INSTA_USERNAME` | Identificador único do perfil alvo no Instagram (sem caractere `@`). | `luaink_` |
| `SCRAPER_API_KEY` | Token privado gerado no painel de controle do provedor Scrape.do. | `6a8b7c...2d1f` |

---

## 🎨 Arquitetura de Interface e Renderização Dinâmica

A galeria é implementada mantendo os efeitos visuais de transição e máscaras CSS nativas (`.trampoAbre`). No arquivo principal `www/index.html`, a árvore de elementos reduz-se ao container de ancoragem:

```html
<div id="tramposGaleria">
    </div>

```

Ao carregar o DOM, o script `www/js/insta.js` realiza uma requisição interna de baixo custo ao arquivo local `insta-links.json`. O motor itera sobre o array e monta dinamicamente as tags, vinculando cada imagem baixada no repositório com o link real do post correspondente:

```javascript
// Exemplo de hidratação nativa no cliente com proteção de cache
fotoElement.style.backgroundImage = `url('${post.localImage}?t=${new Date().getTime()}')`;

```

---

## 💎 Vantagens Operacionais Competitivas

* **Velocidade de Carregamento Próxima a Zero (LCP):** Os arquivos de imagem residem localmente na CDN do Netlify. Não há requisições a servidores externos ou render-blocking de scripts proprietários no navegador do usuário.
* **Resiliência Anti-Quebra:** Caso o Instagram saia do ar ou o gateway de proxy falhe em uma das execuções semanais, o tratamento de erros captura a exceção, mantém o arquivo anterior intacto e impede que a galeria do site exiba blocos vazios ou imagens corrompidas.