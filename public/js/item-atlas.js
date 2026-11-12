// Единый lossless-атлас предметов: исходные клетки 30×30 без масштабирования.
// Поддерживает как ID, так и старые пути png/items/items_N.png из JSON/ответов API.
function itemSprite(source, className = '', attributes = '') {
    const id = itemAtlasId(source);
    if (!Number.isInteger(id) || id < 1 || id > 171) return `<span class="item-atlas item-atlas-missing ${className}" aria-hidden="true" ${attributes}></span>`;
    const index = id - 1, col = index % 16, row = Math.floor(index / 16);
    return `<span class="item-atlas ${className}" aria-hidden="true" ${attributes} style="--item-x:${col * 100 / 15}%;--item-y:${row * 100 / 10}%"></span>`;
}
function itemAtlasId(source) {
    const raw = String(source ?? '').trim();
    const match = /(?:items_|item[_-]?)(\d+)(?:\.png)?(?:$|[?#])/.exec(raw) || (/^\d+$/.test(raw) ? [raw, raw] : null);
    const id = match ? Number(match[1]) : 0;
    return Number.isInteger(id) && id >= 1 && id <= 171 ? id : 0;
}
function itemAtlasPosition(source) {
    const id = itemAtlasId(source);
    if (!Number.isInteger(id) || id < 1 || id > 171) return { x: '0%', y: '0%' };
    const index = id - 1;
    return { x: `${(index % 16) * 100 / 15}%`, y: `${Math.floor(index / 16) * 100 / 10}%` };
}

function setItemAtlasElement(element, source) {
    if (!element) return false;
    const id = itemAtlasId(source);
    element.classList.add('item-atlas');
    element.classList.toggle('item-atlas-missing', !id);
    if (!id) { element.style.removeProperty('--item-x'); element.style.removeProperty('--item-y'); return false; }
    const pos = itemAtlasPosition(id);
    element.style.setProperty('--item-x', pos.x);
    element.style.setProperty('--item-y', pos.y);
    element.dataset.itemImage = String(source ?? '');
    return true;
}


// Load the one shared texture once. It also lets roulette wait for decoding
// without trying to decode each individual sprite (there are no individual PNGs).
let itemAtlasLoadPromise = null;
function preloadItemAtlas() {
    if (itemAtlasLoadPromise) return itemAtlasLoadPromise;
    if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
    itemAtlasLoadPromise = new Promise(resolve => {
        const image = new Image();
        image.onload = async () => {
            try { if (typeof image.decode === 'function') await image.decode(); } catch (_) {}
            resolve(true);
        };
        image.onerror = () => { itemAtlasLoadPromise = null; resolve(false); };
        image.src = new URL('png/items-atlas.png', document.baseURI).href;
    });
    return itemAtlasLoadPromise;
}
