const fs = require('fs');
const path = require('path');
const https = require('https');

const TARGET_USERNAME = process.env.INSTA_USERNAME;
const SCRAPE_DO_TOKEN = process.env.SCRAPER_API_KEY; 

const IMAGES_DIR = path.join(__dirname, '../www/images/insta');
const LINKS_JSON_PATH = path.join(__dirname, '../www/insta-links.json');

function downloadImage(url, destPath) {
    return new Promise((resolve, reject) => {
        const proxyUrl = `https://api.scrape.do?token=${SCRAPE_DO_TOKEN}&url=${encodeURIComponent(url)}`;
        
        https.get(proxyUrl, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Falha no download. Status: ${response.statusCode}`));
                return;
            }
            const fileStream = fs.createWriteStream(destPath);
            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });
        }).on('error', (err) => { reject(err); });
    });
}

async function pipelineInsta() {
    console.log(`[START] Iniciando processamento para: @${TARGET_USERNAME}`);
    
    if (!TARGET_USERNAME || !SCRAPE_DO_TOKEN) {
        console.error("[CRITICAL] Variáveis de ambiente faltando!");
        process.exit(1);
    }

    const targetUrl = `https://www.instagram.com/${TARGET_USERNAME}/?__a=1&__d=dis`;
    const proxyUrl = `https://api.scrape.do?token=${SCRAPE_DO_TOKEN}&url=${encodeURIComponent(targetUrl)}`;

    try {
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`Erro no proxy: ${response.status}`);

        const data = await response.json();
        const userObj = data.graphql?.user || data.data?.user;
        
        if (!userObj || !userObj.edge_owner_to_timeline_media) {
            throw new Error("Estrutura inválida retornada pelo Meta.");
        }

        const edges = userObj.edge_owner_to_timeline_media.edges;
        const topPosts = edges.slice(0, 9); // Garante os 9 posts da grade

        fs.mkdirSync(IMAGES_DIR, { recursive: true });
        const linksData = [];

        for (let i = 0; i < topPosts.length; i++) {
            const post = topPosts[i].node;
            
            // Padroniza o número com dois dígitos (01, 02, 03...)
            const indexValue = String(i + 1).padStart(2, '0');
            const imageName = `instaFoto_${indexValue}.jpg`;
            const destPath = path.join(IMAGES_DIR, imageName);

            console.log(`-> Baixando imagem ${indexValue}/09...`);
            await downloadImage(post.display_url, destPath);

            linksData.push({
                index: indexValue,
                localImage: `images/insta/${imageName}`,
                permalink: `https://www.instagram.com/p/${post.shortcode}/`
            });
        }

        fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: linksData }, null, 2));
        console.log(`[SUCCESS] Fotos salvas e 'insta-links.json' gerado.`);

    } catch (error) {
        console.error(`[FALLBACK] O Script falhou: ${error.message}`);
        process.exit(0);
    }
}

pipelineInsta();