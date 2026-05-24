const fs = require('fs');
const path = require('path');
const https = require('https');

const SCRAPER_KEY = process.env.SCRAPER_API_KEY;
const USERNAME = process.env.INSTA_USERNAME;

const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, '../www/images/insta');
const LINKS_JSON_PATH = process.env.LINKS_JSON_PATH || path.join(__dirname, '../www/insta-links.json');
const DEBUG_HTML_PATH = process.env.DEBUG_HTML_PATH || path.join(__dirname, '../www/debug-insta.html');

fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(LINKS_JSON_PATH)) {
    fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify({ posts: [] }, null, 2));
}

function requestRaw(url, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        https.get({ hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search, headers: extraHeaders }, (res) => {
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

// Busca recursiva por dados de posts dentro de qualquer JSON
// Suporta formato antigo (edge_owner_to_timeline_media) e novo (media.edges com 'code')
function extractPostsFromObject(obj, depth = 0) {
    if (depth > 15 || !obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const found = extractPostsFromObject(item, depth + 1);
            if (found) return found;
        }
        return null;
    }
    // Formato antigo: GraphQL edge_owner_to_timeline_media
    if (obj.edge_owner_to_timeline_media?.edges?.length > 0) {
        return obj.edge_owner_to_timeline_media.edges
            .filter(e => e.node?.__typename !== 'GraphVideo' && (e.node?.shortcode || e.node?.code))
            .map(e => ({
                shortcode: e.node.shortcode || e.node.code,
                imageUrl: e.node.display_url || e.node.thumbnail_src
                    || e.node.image_versions2?.candidates?.[0]?.url,
            })).filter(p => p.shortcode && p.imageUrl);
    }
    // Formato novo: media.edges com campo 'code'
    if (obj.media?.edges?.length > 0) {
        return obj.media.edges
            .filter(e => e.node && (e.node.code || e.node.shortcode))
            .map(e => ({
                shortcode: e.node.code || e.node.shortcode,
                imageUrl: e.node.image_versions2?.candidates?.[0]?.url
                    || e.node.display_url || e.node.thumbnail_src,
            })).filter(p => p.shortcode && p.imageUrl);
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
    // Instagram serve .webp, .jpg ou URLs sem extensao; usa src, srcset ou data-src
    const regex = /href="\/p\/([A-Za-z0-9_-]+)\/"[\s\S]{0,2000}?(?:src|srcset|data-src)="(https:\/\/[^"]*(?:cdninstagram\.com|fbcdn\.net)[^"]*)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const [, shortcode, rawUrl] = match;
        // srcset pode ter "url 640w, url 1280w" — pega a ultima (maior resolucao)
        const imageUrl = rawUrl.split(',').pop().trim().split(' ')[0];
        if (!seen.has(shortcode) && imageUrl) {
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

    let posts = null;

    // ESTRATEGIA 1: endpoint JSON do Instagram via scrape.do com X-IG-App-ID
    // Este e o mesmo endpoint que o frontend do Instagram usa — retorna JSON estruturado.
    // Requer customHeaders=true para o scrape.do repassar o header X-IG-App-ID.
    const apiEndpoint = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${USERNAME}`;
    const proxyApiUrl = new URL('https://api.scrape.do');
    proxyApiUrl.searchParams.set('token', SCRAPER_KEY);
    proxyApiUrl.searchParams.set('url', apiEndpoint);
    proxyApiUrl.searchParams.set('customHeaders', 'true');

    console.log('[STRATEGY 1] Chamando web_profile_info JSON API...');
    const apiRes = await requestRaw(proxyApiUrl.toString(), {
        'x-ig-app-id': '936619743392459',
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'referer': 'https://www.instagram.com/',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
    });

    console.log(`[DEBUG] API Status: ${apiRes.statusCode} | Body: ${apiRes.body.slice(0, 300)}`);

    if (apiRes.statusCode === 200) {
        try {
            const json = JSON.parse(apiRes.body);
            posts = extractPostsFromObject(json);
            if (posts?.length > 0) console.log(`[STRATEGY 1] Sucesso! ${posts.length} posts encontrados.`);
            else console.log('[STRATEGY 1] JSON parseado mas posts nao encontrados na estrutura.');
        } catch (e) {
            console.log(`[STRATEGY 1] JSON parse falhou: ${e.message}. Body: ${apiRes.body.slice(0, 200)}`);
        }
    }

    // ESTRATEGIA 2: render=true com wait=8000 para aguardar o React carregar os posts
    // Instagram e uma SPA — os posts so aparecem no DOM apos o JS fazer os fetches de API.
    if (!posts || posts.length === 0) {
        console.log('[STRATEGY 2] Tentando render=true com wait=8000ms...');
        const targetUrl = `https://www.instagram.com/${USERNAME}/`;
        const proxyUrl = new URL('https://api.scrape.do');
        proxyUrl.searchParams.set('token', SCRAPER_KEY);
        proxyUrl.searchParams.set('url', targetUrl);
        proxyUrl.searchParams.set('render', 'true');
        proxyUrl.searchParams.set('wait', '8000');

        const res = await requestRaw(proxyUrl.toString());

        console.log(`[DEBUG] HTML Status: ${res.statusCode} | Tamanho: ${res.body.length} chars`);
        const postLinks = [...res.body.matchAll(/href="\/p\/([A-Za-z0-9_-]+)\/"/g)].map(m => m[1]);
        const cdnImages = (res.body.match(/cdninstagram\.com|fbcdn\.net/g) || []).length;
        console.log(`[DEBUG] Links /p/: ${postLinks.length} | Refs CDN: ${cdnImages}`);

        if (res.statusCode === 200) {
            posts = extractPostsFromScripts(res.body);
            if (!posts || posts.length === 0) posts = extractPostsFromHTML(res.body);
        }

        if (!posts || posts.length === 0) {
            fs.writeFileSync(DEBUG_HTML_PATH, res.body);
        }
    }

    if (!posts || posts.length === 0) {
        throw new Error('Posts nao encontrados. Verifique o artefato debug-insta.html para diagnostico.');
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
