const fs = require('fs');
const path = require('path');
const https = require('https');

const SCRAPER_KEY = process.env.SCRAPER_API_KEY;
const USERNAME = process.env.INSTA_USERNAME;

const IMAGES_DIR = path.join(__dirname, '../www/images/insta');
const LINKS_JSON_PATH = path.join(__dirname, '../www/insta-links.json');

// Headers obrigatórios para a API mobile do Instagram.
// Sem X-IG-App-ID o Instagram retorna HTML da página de login em vez de JSON.
// customHeaders=true no scrape.do instrui o proxy a encaminhar os headers
// da requisição de entrada para o destino.
const INSTA_HEADERS = {
    'X-IG-App-ID': '936619743392459',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram/334.0.0.12.96',
    'Accept': 'application/json',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(LINKS_JSON_PATH)) {
    fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: [] }, null, 2));
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        // Mudado para HTTPS!
        const targetUrl = `https://api.scrape.do?token=${SCRAPER_KEY}&url=${encodeURIComponent(url)}`;
        
        https.get(targetUrl, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Falha no download da imagem. Status: ${response.statusCode}`));
                return;
            }
            const fileStream = fs.createWriteStream(destPath);
            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });
        }).on('error', (err) => reject(err));
    });
}

function requestRaw(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            headers,
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        }).on('error', (err) => reject(err));
    });
}

async function runScraper() {
    console.log(`[START] Iniciando raspagem estável para o usuário: @${USERNAME}`);

    if (!SCRAPER_KEY || !USERNAME) {
        console.error("[CRITICAL] Falta configurar SCRAPER_API_KEY ou INSTA_USERNAME nos Secrets.");
        process.exit(1);
    }

    // web_profile_info retorna a grade pública do perfil sem precisar de sessão.
    // O endpoint /feed/user/{username}/username/ só devolve posts para usuários logados.
    const targetInstagramUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${USERNAME}`;
    // customHeaders=true: scrape.do encaminha os headers desta requisição para o Instagram
    const proxyUrl = `https://api.scrape.do?token=${SCRAPER_KEY}&url=${encodeURIComponent(targetInstagramUrl)}&customHeaders=true`;

    try {
        const res = await requestRaw(proxyUrl, INSTA_HEADERS);

        console.log(`[DEBUG] HTTP Status do proxy: ${res.statusCode}`);
        console.log(`[DEBUG] Resposta (primeiros 300 chars): ${res.body.slice(0, 300)}`);

        if (res.statusCode !== 200) {
            throw new Error(`Status HTTP inesperado do proxy: ${res.statusCode}`);
        }

        let parsed;
        try {
            parsed = JSON.parse(res.body);
        } catch (e) {
            throw new Error(`Resposta não é JSON válido. Conteúdo recebido: ${res.body.slice(0, 400)}`);
        }

        const edges = parsed?.data?.user?.edge_owner_to_timeline_media?.edges;
        if (!edges || edges.length === 0) {
            throw new Error(`Feed vazio ou formato inesperado. Chaves recebidas: ${Object.keys(parsed).join(', ')}`);
        }

        // Filtra vídeos; aceita fotos (GraphImage) e carrosséis (GraphSidecar)
        const topPosts = edges
            .filter(e => e.node.__typename !== 'GraphVideo')
            .slice(0, 9);
        const linksData = [];

        console.log(`[PIPELINE] Processando ${topPosts.length} posts coletados...`);

        for (let i = 0; i < topPosts.length; i++) {
            const node = topPosts[i].node;
            const indexValue = String(i + 1).padStart(2, '0');
            const imageName = `instaFoto_${indexValue}.jpg`;
            const destPath = path.join(IMAGES_DIR, imageName);

            // display_url é a imagem em tamanho completo
            const imageUrl = node.display_url || node.thumbnail_src;

            if (imageUrl) {
                console.log(`-> Baixando imagem [${indexValue}/09]...`);
                await downloadFile(imageUrl, destPath);

                linksData.push({
                    index: indexValue,
                    localImage: `images/insta/${imageName}`,
                    permalink: `https://www.instagram.com/p/${node.shortcode}/`,
                });
            }
        }

        fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: linksData }, null, 2));
        console.log('[SUCCESS] Sincronização realizada com sucesso!');

    } catch (error) {
        console.error(`[CRITICAL] O script falhou: ${error.message}`);
        process.exit(1);
    }
}

runScraper();