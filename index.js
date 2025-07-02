import jsdom from 'jsdom';
import fetch from 'node-fetch';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';

const { JSDOM } = jsdom;

// Simple similarity check (case-insensitive, ignore punctuation)
function similarTitle(a, b) {
    const removeWords = s =>
        s
            .toLowerCase()
            .replace(/[^a-z0-9 ]+/g, ' ')
            .replace(/\b(race|full|replay|formula|grand prix|watch|video|stream|round|gp|qualifying|practice|show|post|pre|202[0-9])\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    const na = removeWords(a);
    const nb = removeWords(b);
    // Check if at least 60% of the words in one are in the other
    const wa = na.split(' ').filter(Boolean);
    const wb = nb.split(' ').filter(Boolean);
    const matchAinB = wa.filter(word => wb.includes(word)).length / wa.length;
    const matchBinA = wb.filter(word => wa.includes(word)).length / wb.length;
    return matchAinB > 0.6 || matchBinA > 0.6;
}

// Load existing races and slugs
let existingRaces = [];
let existingSlugs = new Set();
if (existsSync('races.json')) {
    try {
        existingRaces = JSON.parse(readFileSync('races.json', 'utf-8'));
        existingSlugs = new Set(existingRaces.map(r => r.slug));
    } catch (e) {
        console.error('Failed to read races.json:', e.message);
    }
}

async function scrapeRaces() {
    let page = 1;
    const races = [...existingRaces];
    let hasMore = true;

    while (hasMore) {
        const url = page === 1 ? 'https://fullraces.com/' : `https://fullraces.com/?page${page}`;
        console.log(`Scraping: ${url}`);
        let response, html, dom, document;
        try {
            response = await fetch(url);
            html = await response.text();
            dom = new JSDOM(html);
            document = dom.window.document;
        } catch (e) {
            console.error(`Failed to fetch page ${page}:`, e.message);
            break;
        }

        const raceBlocks = document.querySelectorAll('#allEntries .short_item');
        if (raceBlocks.length === 0) {
            hasMore = false;
            break;
        }

        for (const block of raceBlocks) {
            const titleLink = block.querySelector('h3 a');
            if (titleLink) {
                let link = titleLink.getAttribute('href');
                if (link && !link.startsWith('http')) {
                    link = 'https://fullraces.com' + link;
                }
                const slug = link.split('/').pop().replace('.html', '');

                // Skip if slug already exists
                if (existingSlugs.has(slug)) {
                    console.log(`Skipping already scraped: ${slug}`);
                    continue;
                }

                const id = randomUUID();
                const title = titleLink.textContent.trim();
                let thumbnail = block.querySelector('.poster img')?.getAttribute('src') || '';
                if (thumbnail && !thumbnail.startsWith('http')) {
                    thumbnail = 'https://fullraces.com' + thumbnail;
                }
                const thumbnailslug = `/${thumbnail.split('/').slice(-3).join('/')}`;

                // Fetch the race page and extract stream links
                let server1 = '';
                let server2 = '';
                let customserver = '';
                try {
                    const racePageRes = await fetch(`https://fullraces.com/${slug}`);
                    const racePageHtml = await racePageRes.text();
                    const raceDom = new JSDOM(racePageHtml);
                    const raceDoc = raceDom.window.document;

                    // Find Filemoon link (supports filemoon.to and filemoon.sx)
                    const filemoonLink = Array.from(raceDoc.querySelectorAll('a, iframe'))
                        .map(el => el.getAttribute('href') || el.getAttribute('src'))
                        .find(url => url && /filemoon\.(to|sx)\/e\//.test(url));
                    if (filemoonLink) server1 = filemoonLink.startsWith('http') ? filemoonLink : 'https:' + filemoonLink;

                    // Find Lulu link (supports luluvdoo.com and luluvdo.com)
                    const luluLink = Array.from(raceDoc.querySelectorAll('a, iframe'))
                        .map(el => el.getAttribute('href') || el.getAttribute('src'))
                        .find(url => url && /luluvdo(o)?\.com\/e\//.test(url));
                    if (luluLink) server2 = luluLink.startsWith('http') ? luluLink : 'https:' + luluLink;

                    // Filemoon remote upload
                    if (server1) {
                        try {
                            const apiUrl = `https://filemoonapi.com/api/remote/add`;
                            const params = new URLSearchParams();
                            params.append('key', process.env.FILEMOON_API_KEY);
                            params.append('url', server1);

                            const uploadRes = await fetch(apiUrl, {
                                method: 'POST',
                                body: params
                            });
                            const uploadData = await uploadRes.json();
                            // Map filecode to embed link
                            if (uploadData.result?.filecode) {
                                customserver = `https://filemoon.sx/e/${uploadData.result.filecode}`;
                            } else {
                                customserver = uploadData.result?.url || uploadData.result || '';
                            }
                        } catch (e) {
                            console.error(`Filemoon upload failed for ${title}:`, e.message);
                        }
                    }
                } catch (e) {
                    console.error(`Failed to fetch streams for ${title}:`, e.message);
                }

                // WatchF1Full.com search and streamlinks
                let extraStreams = {};
                try {
                    const searchUrl = `https://watchf1full.com/search.php?keywords=${encodeURIComponent(title)}`;
                    const searchRes = await fetch(searchUrl);
                    const searchHtml = await searchRes.text();
                    const searchDom = new JSDOM(searchHtml);
                    const searchDoc = searchDom.window.document;

                    // Find all results and pick the first similar one
                    const lis = Array.from(searchDoc.querySelectorAll('li.col-xs-6.col-sm-4.col-md-3'));
                    let found = false;
                    for (const li of lis) {
                        const h3a = li.querySelector('h3 a');
                        if (h3a) {
                            const foundTitle = h3a.textContent.trim();
                            //   console.log(similarTitle(foundTitle, title));
                            if (similarTitle(foundTitle, title)) {
                                const detailUrl = h3a.getAttribute('href');
                                // console.log(`Found similar title: ${foundTitle}, ${detailUrl}`);
                                if (detailUrl) {
                                    const detailRes = await fetch(detailUrl);
                                    const detailHtml = await detailRes.text();
                                    const detailDom = new JSDOM(detailHtml);
                                    const detailDoc = detailDom.window.document;
                                    const playerHolder = detailDoc.querySelector('#Playerholder');
                                    let iframeSrcs = [];
                                    if (playerHolder) {
                                        iframeSrcs = Array.from(playerHolder.querySelectorAll('iframe'))
                                            .map(iframe => iframe.getAttribute('src'))
                                            .filter(Boolean);
                                    }
                                    iframeSrcs.forEach((src, idx) => {
                                        extraStreams[`stream${idx + 3}`] = src; // stream3, stream4, ...
                                    });
                                    found = true;
                                    break;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Failed to fetch watchf1full.com streams for ${title}:`, e.message);
                }

                // Build streamlinks object
                const streamlinks = {};
                if (server1) streamlinks.server1 = server1;
                if (server2) streamlinks.server2 = server2;
                if (customserver) streamlinks.customserver = customserver;
                Object.assign(streamlinks, extraStreams);

                // Merge with existing race if present
                const existingRace = existingRaces.find(r => r.slug === slug);
                if (existingRace && existingRace.streamlinks) {
                    // For server1/server2/customserver, prefer new if present, else old
                    ['server1', 'server2', 'customserver'].forEach(key => {
                        if (!streamlinks[key] && existingRace.streamlinks[key]) {
                            streamlinks[key] = existingRace.streamlinks[key];
                        }
                    });
                    // For numbered streams, add new first, then any old not present
                    const newStreamKeys = Object.keys(extraStreams);
                    const oldStreamKeys = Object.keys(existingRace.streamlinks).filter(k => /^stream\d+$/.test(k));
                    let idx = newStreamKeys.length + 3; // stream3, stream4, ...
                    for (const k of oldStreamKeys) {
                        if (!streamlinks[k]) {
                            streamlinks[`stream${idx}`] = existingRace.streamlinks[k];
                            idx++;
                        }
                    }
                }

                races.push({
                    id: existingRace ? existingRace.id : id,
                    title,
                    link,
                    thumbnail,
                    slug,
                    thumbnailslug,
                    streamlinks
                });
                existingSlugs.add(slug);
                // Write after every race
                writeFileSync('races.json', JSON.stringify(races, null, 2), 'utf-8');
                console.log(`Saved ${title}`);
            }
        }
        page++;
    }

    console.log(`Saved ${races.length} races to races.json`);
}

scrapeRaces().catch(console.error);