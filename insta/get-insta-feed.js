const fs = require('fs');
const path = require('path');
const https = require('https');

const SCRAPER_KEY = process.env.SCRAPER_API_KEY;
const USERNAME = process.env.INSTA_USERNAME;

const IMAGES_DIR = path.join(__dirname, '../www/images/insta');
const LINKS_JSON_PATH = path.join(__dirname, '../www/insta-links.json');

// Garante a infraestrutura básica de pastas e arquivos de cara para o Git não quebrar
fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(LINKS_JSON_PATH)) {
    fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: [] }, null, 2));
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        // Passa o download também pelo Scrape.do para evitar block na CDN de imagens do Insta
        const targetUrl = `http://api.scrape.do?token=${SCRAPER_KEY}&url=${encodeURIComponent(url)}`;
        
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

async function requestJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ ok: res.statusCode === 200, body: JSON.parse(data) });
                } catch (e) {
                    reject(new Error(`Resposta da API não é um JSON válido. Printe recebido: ${data.slice(0, 100)}`));
                }
            });
        }).on('error', (err) => reject(err));
    });
}

async function runScraper() {
    console.log(`[START] Iniciando raspagem estável para o usuário: @${USERNAME}`);

    if (!SCRAPER_KEY || !USERNAME) {
        console.error("[CRITICAL] Falta configurar SCRAPER_API_KEY ou INSTA_USERNAME nos Secrets.");
        process.exit(1);
    }

    // Endpoint público estático simulando o feed via proxy
    const targetInstagramUrl = `https://www.instagram.com/api/v1/feed/user/${USERNAME}/username/?count=12`;
    const proxyUrl = `http://api.scrape.do?token=${SCRAPER_KEY}&url=${encodeURIComponent(targetInstagramUrl)}`;

    try {
        const res = await requestJson(proxyUrl);

        if (!res.ok || !res.body.items) {
            throw new Error("Não foi possível coletar os dados do feed. Verifique o status da conta.");
        }

        const items = res.body.items.filter(item => item.media_type === 1 || item.media_type === 8);
        const topPosts = items.slice(0, 9);
        const linksData = [];

        console.log(`[PIPELINE] Processando ${topPosts.length} posts coletados...`);

        for (let i = 0; i < topPosts.length; i++) {
            const post = topPosts[i];
            const indexValue = String(i + 1).padStart(2, '0');
            const imageName = `instaFoto_${indexValue}.jpg`;
            const destPath = path.join(IMAGES_DIR, imageName);

            // Pega a URL da imagem de maior resolução disponível
            const imageUrl = post.image_versions2?.candidates?.[0]?.url || post.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url;

            if (imageUrl) {
                console.log(`-> Baixando imagem estática [${indexValue}/09]...`);
                await downloadFile(imageUrl, destPath);

                linksData.push({
                    index: indexValue,
                    localImage: `images/insta/${imageName}`,
                    permalink: `https://www.instagram.com/p/${post.code}/`
                });
            }
        }

        fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: linksData }, null, 2));
        console.log("[SUCCESS] Sincronização realizada com sucesso via Scrape.do!");

    } catch (error) {
        console.error(`[FALLBACK] O Script falhou: ${error.message}`);
        // Força saída limpa para não quebrar o pipeline do GitHub se o Instagram instabilizar
        process.exit(0);
    }
}

runScraper();