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
    // Formato API mobile: items[] com 'code' e image_versions2
    if (Array.isArray(obj.items) && obj.items.length > 0 && obj.items[0]?.code) {
        const posts = obj.items
            .filter(item => (item.code || item.shortcode) && item.media_type !== 2) // exclui videos
            .map(item => ({
                shortcode: item.code || item.shortcode,
                imageUrl: item.image_versions2?.candidates?.[0]?.url || item.display_url,
            })).filter(p => p.shortcode && p.imageUrl);
        if (posts.length > 0) return posts;
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

    let posts = null;

    // ESTRATEGIA 1: web_profile_info → extrai user_id → feed/user/{id}
    // web_profile_info retorna o perfil (sem posts). O user_id e usado para chamar
    // o endpoint de feed que retorna os posts com imagens.
    {
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${USERNAME}`;
        const proxyUrl = new URL('https://api.scrape.do');
        proxyUrl.searchParams.set('token', SCRAPER_KEY);
        proxyUrl.searchParams.set('url', profileUrl);
        proxyUrl.searchParams.set('customHeaders', 'true');

        console.log('[STRATEGY 1a] Obtendo user_id via web_profile_info...');
        const profileRes = await requestRaw(proxyUrl.toString(), igHeaders);
        console.log(`[DEBUG] Profile Status: ${profileRes.statusCode} | Body: ${profileRes.body.slice(0, 200)}`);

        let userId = null;
        if (profileRes.statusCode === 200) {
            try {
                const json = JSON.parse(profileRes.body);
                userId = json?.data?.user?.id;
                // Tenta extrair posts diretamente caso o formato inclua (formato antigo)
                posts = extractPostsFromObject(json);
                if (posts?.length > 0) console.log(`[STRATEGY 1a] Posts no profile response: ${posts.length}`);
                else if (userId) console.log(`[STRATEGY 1a] user_id obtido: ${userId}. Buscando feed...`);
                else console.log('[STRATEGY 1a] Sem user_id nem posts no profile response.');
            } catch (e) {
                console.log(`[STRATEGY 1a] Parse falhou: ${e.message}`);
            }
        }

        // Step 2: busca o feed com o user_id
        if (userId && (!posts || posts.length === 0)) {
            const feedUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=9`;
            const proxyFeedUrl = new URL('https://api.scrape.do');
            proxyFeedUrl.searchParams.set('token', SCRAPER_KEY);
            proxyFeedUrl.searchParams.set('url', feedUrl);
            proxyFeedUrl.searchParams.set('customHeaders', 'true');

            console.log('[STRATEGY 1b] Obtendo posts via feed/user/{id}...');
            const feedRes = await requestRaw(proxyFeedUrl.toString(), igHeaders);
            console.log(`[DEBUG] Feed Status: ${feedRes.statusCode} | Body: ${feedRes.body.slice(0, 400)}`);

            if (feedRes.statusCode === 200) {
                try {
                    const json = JSON.parse(feedRes.body);
                    posts = extractPostsFromObject(json);
                    if (posts?.length > 0) console.log(`[STRATEGY 1b] Sucesso! ${posts.length} posts.`);
                    else console.log('[STRATEGY 1b] JSON OK mas posts nao encontrados. Keys: ' + Object.keys(json).join(', '));
                } catch (e) {
                    console.log(`[STRATEGY 1b] Parse falhou: ${e.message}`);
                }
            }
        }
    }

    // ESTRATEGIA 2: chamada direta ao Instagram (sem proxy) — fallback
    if (!posts || posts.length === 0) {
        console.log('[STRATEGY 2] Chamada direta ao Instagram com session cookie...');
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${USERNAME}`;
        const profileRes = await requestRaw(profileUrl, igHeaders);
        console.log(`[DEBUG] Direct Status: ${profileRes.statusCode} | Body: ${profileRes.body.slice(0, 200)}`);

        let userId = null;
        if (profileRes.statusCode === 200) {
            try {
                const json = JSON.parse(profileRes.body);
                userId = json?.data?.user?.id;
                posts = extractPostsFromObject(json);
            } catch (e) { /* sem posts no profile */ }
        }

        if (userId && (!posts || posts.length === 0)) {
            const feedUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=9`;
            const feedRes = await requestRaw(feedUrl, igHeaders);
            console.log(`[DEBUG] Direct Feed Status: ${feedRes.statusCode} | Body: ${feedRes.body.slice(0, 200)}`);
            if (feedRes.statusCode === 200) {
                try {
                    const json = JSON.parse(feedRes.body);
                    posts = extractPostsFromObject(json);
                    if (posts?.length > 0) console.log(`[STRATEGY 2] Sucesso! ${posts.length} posts.`);
                } catch (e) { /* falhou */ }
            } else if (feedRes.statusCode === 401 || feedRes.statusCode === 403) {
                console.log('[STRATEGY 2] Sessao invalida ou expirada.');
            }
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
