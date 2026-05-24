const fs = require('fs');
const path = require('path');
const https = require('https');

const SCRAPER_KEY = process.env.SCRAPER_API_KEY;
const USERNAME = process.env.INSTA_USERNAME;

const IMAGES_DIR = path.join(__dirname, '../www/images/insta');
const LINKS_JSON_PATH = path.join(__dirname, '../www/insta-links.json');

fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(LINKS_JSON_PATH)) {
    fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: [] }, null, 2));
}

function requestRaw(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        https.get({ hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        }).on('error', reject);
    });
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const proxyUrl = new URL('https://api.scrape.do');
        proxyUrl.searchParams.set('token', SCRAPER_KEY);
        proxyUrl.searchParams.set('url', url);

        https.get({ hostname: proxyUrl.hostname, path: proxyUrl.pathname + proxyUrl.search }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Download falhou. Status: ${res.statusCode}`));
                return;
            }
            const stream = fs.createWriteStream(destPath);
            res.pipe(stream);
            stream.on('finish', () => { stream.close(); resolve(); });
        }).on('error', reject);
    });
}

// Busca recursiva por edge_owner_to_timeline_media dentro de qualquer JSON
function extractPostsFromObject(obj, depth = 0) {
    if (depth > 12 || !obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const found = extractPostsFromObject(item, depth + 1);
            if (found) return found;
        }
        return null;
    }
    if (obj.edge_owner_to_timeline_media?.edges?.length > 0) {
        return obj.edge_owner_to_timeline_media.edges
            .filter(e => e.node?.__typename !== 'GraphVideo' && e.node?.shortcode)
            .map(e => ({
                shortcode: e.node.shortcode,
                imageUrl: e.node.display_url || e.node.thumbnail_src,
            }));
    }
    for (const val of Object.values(obj)) {
        const found = extractPostsFromObject(val, depth + 1);
        if (found) return found;
    }
    return null;
}

// Tenta extrair dos <script type="application/json"> embutidos no HTML
function extractPostsFromScripts(html) {
    const matches = [...html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)];
    for (const [, jsonStr] of matches) {
        try {
            const posts = extractPostsFromObject(JSON.parse(jsonStr));
            if (posts?.length > 0) return posts;
        } catch (e) { /* proximo */ }
    }
    return null;
}

// Fallback: regex buscando pares shortcode + imagem CDN no HTML renderizado
function extractPostsFromHTML(html) {
    const posts = [];
    const seen = new Set();
    const regex = /href="\/p\/([A-Za-z0-9_-]+)\/"[\s\S]{0,800}?src="(https:\/\/[^"]*(?:cdninstagram\.com|fbcdn\.net)[^"]*\.jpg[^"]*)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const [, shortcode, imageUrl] = match;
        if (!seen.has(shortcode)) {
            seen.add(shortcode);
            posts.push({ shortcode, imageUrl });
        }
        if (posts.length >= 9) break;
    }
    return posts;
}

async function runScraper() {
    console.log(`[START] Raspagem de @${USERNAME}`);

    if (!SCRAPER_KEY || !USERNAME) {
        throw new Error('Falta configurar SCRAPER_API_KEY ou INSTA_USERNAME nos Secrets.');
    }

    const targetUrl = `https://www.instagram.com/${USERNAME}/`;
    // render=true: Chrome headless com fingerprint real - bypassa os anti-bots do Instagram.
    // Os endpoints da API (/api/v1/...) retornam {"status":"ok"} vazios sem sessao autenticada.
    const proxyUrl = `https://api.scrape.do?token=${SCRAPER_KEY}&url=${encodeURIComponent(targetUrl)}&render=true`;

    const res = await requestRaw(proxyUrl);

    console.log(`[DEBUG] HTTP Status: ${res.statusCode}`);
    console.log(`[DEBUG] Tamanho da resposta: ${res.body.length} chars`);
    console.log(`[DEBUG] Inicio do body: ${res.body.slice(0, 200)}`);

    if (res.statusCode !== 200) {
        throw new Error(`Status inesperado: ${res.statusCode} | Body: ${res.body.slice(0, 300)}`);
    }

    // 1a tentativa: JSON embutido nas script tags do HTML
    let posts = extractPostsFromScripts(res.body);

    // 2a tentativa: regex direto no HTML renderizado
    if (!posts || posts.length === 0) {
        console.log('[DEBUG] Script JSON nao encontrado. Tentando regex no HTML renderizado...');
        posts = extractPostsFromHTML(res.body);
    }

    if (!posts || posts.length === 0) {
        // Salva o HTML para analise manual no artefato do Actions
        fs.writeFileSync(path.join(__dirname, '../www/debug-insta.html'), res.body);
        throw new Error('Posts nao encontrados. HTML salvo em www/debug-insta.html para diagnostico.');
    }

    const topPosts = posts.slice(0, 9);
    const linksData = [];

    console.log(`[PIPELINE] Processando ${topPosts.length} posts...`);

    for (let i = 0; i < topPosts.length; i++) {
        const { shortcode, imageUrl } = topPosts[i];
        const indexValue = String(i + 1).padStart(2, '0');
        const imageName = `instaFoto_${indexValue}.jpg`;
        const destPath = path.join(IMAGES_DIR, imageName);

        console.log(`-> Baixando [${indexValue}/0${topPosts.length}]: ${imageName}`);
        await downloadFile(imageUrl, destPath);

        linksData.push({
            index: indexValue,
            localImage: `images/insta/${imageName}`,
            permalink: `https://www.instagram.com/p/${shortcode}/`,
        });
    }

    fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: linksData }, null, 2));
    console.log('[SUCCESS] Sincronizacao realizada!');
}

runScraper().catch(err => {
    console.error(`[CRITICAL] ${err.message}`);
    process.exit(1);
});
