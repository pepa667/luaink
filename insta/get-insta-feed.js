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
                reject(new Error(`Falha no download da imagem. Status: ${response.statusCode}`));
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

    // Endpoint público estável do ecossistema Web do Instagram
    const targetUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${TARGET_USERNAME}`;
    
    // Injeta os cabeçalhos obrigatórios usando o formato exato que o Scrape.do exige via URL parameter
    const targetHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "X-IG-App-ID": "936619743392459"
    };
    
    const proxyUrl = `https://api.scrape.do?token=${SCRAPE_DO_TOKEN}&url=${encodeURIComponent(targetUrl)}&headers=${encodeURIComponent(JSON.stringify(targetHeaders))}`;

    try {
        const response = await fetch(proxyUrl);
        const rawText = await response.text();
        
        if (!response.ok || !rawText) {
            throw new Error(`Resposta inválida do gateway Scrape.do. Status: ${response.status}`);
        }

        const data = JSON.parse(rawText);
        const userObj = data.data?.user;
        
        if (!userObj || !userObj.edge_owner_to_timeline_media) {
            throw new Error("Estrutura não encontrada. O perfil pode estar privado ou a API mudou.");
        }

        const edges = userObj.edge_owner_to_timeline_media.edges;
        if (edges.length === 0) throw new Error("Nenhum post público retornado para este perfil.");

        const topPosts = edges.slice(0, 9);
        fs.mkdirSync(IMAGES_DIR, { recursive: true });

        const linksData = [];
        console.log(`[PIPELINE] Baixando ${topPosts.length} mídias identificadas...`);
        
        for (let i = 0; i < topPosts.length; i++) {
            const post = topPosts[i].node;
            const indexValue = String(i + 1).padStart(2, '0');
            const imageName = `instaFoto_${indexValue}.jpg`;
            const destPath = path.join(IMAGES_DIR, imageName);

            console.log(`-> Baixando imagem [${indexValue}/09]...`);
            await downloadImage(post.display_url, destPath);

            linksData.push({
                index: indexValue,
                localImage: `images/insta/${imageName}`,
                permalink: `https://www.instagram.com/p/${post.shortcode}/`
            });
        }

        fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: linksData }, null, 2));
        console.log(`[SUCCESS] Pipeline finalizado! Todos os dados estáticos salvos em /www.`);

    } catch (error) {
        console.error(`[CRITICAL ERRO] O Script quebrou: ${error.message}`);
        process.exit(1); 
    }
}

pipelineInsta();