const fs = require('fs');
const path = require('path');
const https = require('https');

const SCRAPER_KEY = process.env.SCRAPER_API_KEY;
const USERNAME = process.env.INSTA_USERNAME;
const SESSION_ID = process.env.INSTA_SESSION_ID; // Cookie sessionid do Instagram (obrigatorio)

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
    if (!SESSION_ID) {
        throw new Error(
            'INSTA_SESSION_ID nao configurado.\n' +
            'Como obter: Chrome -> instagram.com -> F12 -> Application -> Cookies -> sessionid\n' +
            'Adiciona como Secret no GitHub: Settings -> Secrets -> Actions -> INSTA_SESSION_ID'
        );
    }

    // Headers que o frontend do Instagram usa para chamar a propria API
    const igHeaders = {
        'x-ig-app-id': '936619743392459',
        'cookie': `sessionid=${SESSION_ID}`,
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'referer': 'https://www.instagram.com/',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
    };
    const apiEndpoint = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${USERNAME}`;

    let posts = null;

    // ESTRATEGIA 1: via scrape.do com customHeaders + session cookie
    // customHeaders=true faz o scrape.do repassar os headers (incluindo Cookie) para o Instagram
    {
        const proxyUrl = new URL('https://api.scrape.do');
        proxyUrl.searchParams.set('token', SCRAPER_KEY);
        proxyUrl.searchParams.set('url', apiEndpoint);
        proxyUrl.searchParams.set('customHeaders', 'true');

        console.log('[STRATEGY 1] web_profile_info via scrape.do + session cookie...');
        const res = await requestRaw(proxyUrl.toString(), igHeaders);
        console.log(`[DEBUG] Status: ${res.statusCode} | Body: ${res.body.slice(0, 300)}`);

        if (res.statusCode === 200) {
            try {
                const json = JSON.parse(res.body);
                posts = extractPostsFromObject(json);
                if (posts?.length > 0) console.log(`[STRATEGY 1] Sucesso! ${posts.length} posts.`);
                else console.log('[STRATEGY 1] JSON OK mas sem posts na estrutura. scrape.do pode estar a bloquear o header Cookie.');
            } catch (e) {
                console.log(`[STRATEGY 1] JSON parse falhou: ${e.message}`);
            }
        }
    }

    // ESTRATEGIA 2: chamada direta ao Instagram (sem proxy) com session cookie
    // Fallback caso o scrape.do nao repasse o header Cookie
    if (!posts || posts.length === 0) {
        console.log('[STRATEGY 2] Chamada direta ao Instagram com session cookie...');
        const res = await requestRaw(apiEndpoint, igHeaders);
        console.log(`[DEBUG] Status: ${res.statusCode} | Body: ${res.body.slice(0, 300)}`);

        if (res.statusCode === 200) {
            try {
                const json = JSON.parse(res.body);
                posts = extractPostsFromObject(json);
                if (posts?.length > 0) console.log(`[STRATEGY 2] Sucesso! ${posts.length} posts.`);
                else console.log('[STRATEGY 2] JSON OK mas sem posts. Verifica se INSTA_SESSION_ID esta correto e valido.');
            } catch (e) {
                console.log(`[STRATEGY 2] JSON parse falhou: ${e.message}`);
            }
        } else if (res.statusCode === 401 || res.statusCode === 403) {
            console.log('[STRATEGY 2] Sessao invalida ou expirada. Renova o INSTA_SESSION_ID.');
        }
    }

    if (!posts || posts.length === 0) {
        throw new Error('Posts nao encontrados. Verifica se INSTA_SESSION_ID e valido (Chrome -> instagram.com -> F12 -> Application -> Cookies -> sessionid).');
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
