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
    console.log(`[START] Iniciando Scraping de HTML Puro para: @${TARGET_USERNAME}`);
    
    if (!TARGET_USERNAME || !SCRAPE_DO_TOKEN) {
        console.error("[CRITICAL] Variáveis de ambiente faltando!");
        process.exit(1);
    }

    // Acessa a página pública principal do usuário
    const targetUrl = `https://www.instagram.com/${TARGET_USERNAME}/`;
    const proxyUrl = `https://api.scrape.do?token=${SCRAPE_DO_TOKEN}&url=${encodeURIComponent(targetUrl)}`;

    try {
        const response = await fetch(proxyUrl);
        const html = await response.text();
        
        if (!response.ok || !html) {
            throw new Error(`Não foi possível ler o HTML da página através do proxy. Status: ${response.status}`);
        }

        let edges = [];

        // ESTRATÉGIA A: Tentar capturar o bloco injetado injection _sharedData
        const sharedDataRegex = /window\._sharedData\s*=\s*({.+?});\s*<\/script>/;
        const sharedMatch = html.match(sharedDataRegex);

        if (sharedMatch && sharedMatch[1]) {
            console.log("[PARSER] Bloco '_sharedData' localizado via Regex!");
            const parsed = JSON.parse(sharedMatch[1]);
            const userObj = parsed.entry_data?.ProfilePage?.[0]?.graphql?.user;
            if (userObj?.edge_owner_to_timeline_media?.edges) {
                edges = userObj.edge_owner_to_timeline_media.edges;
            }
        }

        // ESTRATÉGIA B (FALLBACK): Se não achar o sharedData, varrer tags <script> adicionais geradas pelo Next/Hydration do Insta
        if (edges.length === 0) {
            console.log("[PARSER] Tentando Fallback B: Capturar scripts de hidratação internos...");
            const scriptBlocks = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/g) || [];
            
            for (const script of scriptBlocks) {
                if (script.includes("edge_owner_to_timeline_media")) {
                    // Limpa as tags de script para isolar apenas o JSON interno
                    const cleanJsonText = script.replace(/<\/?.+?>/g, '').trim().replace(/^[^{]*/, '').replace(/[^}]*$/, '');
                    try {
                        const parsedFallback = JSON.parse(cleanJsonText);
                        const userObj = parsedFallback.require?.[0]?.[3]?.[0]?.__bbox?.result?.data?.user || parsedFallback.data?.user;
                        if (userObj?.edge_owner_to_timeline_media?.edges) {
                            edges = userObj.edge_owner_to_timeline_media.edges;
                            break;
                        }
                    } catch (e) {
                        // Ignora falhas de parse de blocos parciais e continua procurando
                    }
                }
            }
        }

        // ESTRATÉGIA C (ÚLTIMO RECURSO): Se a renderização for estritamente via SSR nativo simplificado
        if (edges.length === 0) {
            console.log("[PARSER] Tentando Fallback C: Extração direta de metadados de imagens...");
            // Regex agressiva para caçar links de posts e imagens em tags meta/img jogadas no corpo do HTML deslogado
            const imagePattern = /"display_url":"(https:\/\/[^#]+?\.(?:jpg|webp|png)[^#]*?)"/g;
            let match;
            const uniqueUrls = new Set();
            
            while ((match = imagePattern.exec(html)) !== null) {
                let cleanUrl = match[1].replace(/\\u0026/g, '&');
                uniqueUrls.add(cleanUrl);
                if (uniqueUrls.size >= 9) break;
            }

            if (uniqueUrls.size > 0) {
                edges = Array.from(uniqueUrls).map((url, i) => ({
                    node: {
                        display_url: url,
                        shortcode: `static_post_${i}`
                    }
                }));
            }
        }

        if (edges.length === 0) {
            throw new Error("O Instagram escondeu completamente as mídias da página pública HTML. Bloqueio temporário no IP do proxy.");
        }

        const topPosts = edges.slice(0, 9);
        fs.mkdirSync(IMAGES_DIR, { recursive: true });

        const linksData = [];
        console.log(`[PIPELINE] Baixando ${topPosts.length} mídias interpretadas pelo parser estático...`);
        
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
                permalink: post.shortcode.startsWith('static_post_') ? `https://www.instagram.com/${TARGET_USERNAME}/` : `https://www.instagram.com/p/${post.shortcode}/`
            });
        }

        fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: linksData }, null, 2));
        console.log(`[SUCCESS] Scraping de HTML executado! Resultados persistidos com sucesso.`);

    } catch (error) {
        console.error(`[CRITICAL ERRO] O Script estático quebrou: ${error.message}`);
        process.exit(1); 
    }
}

pipelineInsta();