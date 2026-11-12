// js/cache.js — СИСТЕМА КЭШИРОВАНИЯ

// ==================== КЭШИ ====================
const imageCache = new Map();
const failedImages = new Set();
const jsonCache = new Map();
const audioCache = new Map();
let cacheInitialized = false;

// ==================== ИЗОБРАЖЕНИЯ ====================

function preloadImage(src) {
    return new Promise((resolve) => {
        if (!src) { 
            resolve(null); 
            return; 
        }
        
        const cleanSrc = src.split('?')[0];
        
        if (imageCache.has(cleanSrc)) {
            resolve(imageCache.get(cleanSrc));
            return;
        }
        
        if (failedImages.has(cleanSrc)) {
            resolve(null);
            return;
        }
        
        const img = new Image();
        
        img.onload = () => {
            imageCache.set(cleanSrc, img);
            resolve(img);
        };
        
        img.onerror = () => {
            failedImages.add(cleanSrc);
            console.warn(`[CACHE] Не удалось загрузить: ${cleanSrc}`);
            resolve(null);
        };
        
        img.src = cleanSrc;
    });
}

function getCachedImage(src) {
    if (!src) return null;
    const cleanSrc = src.split('?')[0];
    return imageCache.get(cleanSrc) || null;
}

function isImageCached(src) {
    if (!src) return false;
    const cleanSrc = src.split('?')[0];
    return imageCache.has(cleanSrc);
}

function handleImageError(imgElement, fallbackSrc) {
    if (!imgElement) return;
    
    imgElement.onerror = function() {
        const cleanSrc = (imgElement.src || '').split('?')[0];
        
        if (!cleanSrc) {
            applyFallback();
            return;
        }
        
        // Пробуем из кэша
        const cached = getCachedImage(cleanSrc);
        if (cached && cached.src !== imgElement.src) {
            imgElement.src = cached.src;
            imgElement.onerror = null;
            return;
        }
        
        // Пробуем перезагрузить
        if (!failedImages.has(cleanSrc)) {
            const retryImg = new Image();
            retryImg.onload = () => {
                imageCache.set(cleanSrc, retryImg);
                imgElement.src = retryImg.src;
                imgElement.onerror = null;
            };
            retryImg.onerror = () => {
                failedImages.add(cleanSrc);
                applyFallback();
            };
            retryImg.src = cleanSrc;
            return;
        }
        
        applyFallback();
        
        function applyFallback() {
            if (fallbackSrc) {
                imgElement.src = fallbackSrc;
            } else {
                imgElement.style.display = 'none';
            }
            imgElement.onerror = null;
        }
    };
}

// ==================== JSON ====================
// JSON кэш держим только в памяти. Offline-доставка статических JSON выполняется
// Service Worker, поэтому второй persistent-cache слой не создаёт рассинхронизаций.
const JSON_CACHE_VERSION = 'content';

async function fetchJSONWithCache(url) {
    const cleanUrl = url.split('?')[0];
    if (jsonCache.has(cleanUrl)) return jsonCache.get(cleanUrl);
    const response = await fetch(cleanUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${cleanUrl}`);
    const data = await response.json();
    jsonCache.set(cleanUrl, data);
    return data;
}

function saveJSONToLocalStorage() {}
function getJSONFromLocalStorage() { return null; }
function clearJSONCache() {
    jsonCache.clear();
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('json_cache_')) localStorage.removeItem(key);
    });
}

// ==================== АУДИО ====================

function preloadAudio(src) {
    return new Promise((resolve) => {
        if (!src) { 
            resolve(null); 
            return; 
        }
        
        const cleanSrc = src.split('?')[0];
        
        if (audioCache.has(cleanSrc)) {
            resolve(audioCache.get(cleanSrc));
            return;
        }
        
        const audio = new Audio();
        
        audio.oncanplaythrough = () => {
            audioCache.set(cleanSrc, audio);
            resolve(audio);
        };
        
        audio.onerror = () => {
            console.warn(`[CACHE] Не удалось загрузить звук: ${cleanSrc}`);
            resolve(null);
        };
        
        audio.src = cleanSrc;
        audio.load();
        
        setTimeout(() => {
            if (!audioCache.has(cleanSrc)) {
                audioCache.set(cleanSrc, audio);
                resolve(audio);
            }
        }, 3000);
    });
}

function getCachedAudio(src) {
    if (!src) return null;
    const cleanSrc = src.split('?')[0];
    return audioCache.get(cleanSrc) || null;
}

// ==================== ПРЕДЗАГРУЗКА ВСЕГО ====================

async function preloadAllJSON() {
    const jsonFiles = [
        PATHS.data + 'items.json',
        PATHS.data + 'cases.json',
        PATHS.data + 'avatars.json',
        PATHS.data + 'house.json',
        PATHS.data + 'daily_rewards.json'
    ];
    
    console.log('[CACHE] Предзагрузка JSON...');
    
    const results = {};
    
    for (const url of jsonFiles) {
        try {
            results[url] = await fetchJSONWithCache(url);
        } catch(e) {
            console.warn(`[CACHE] Не удалось загрузить ${url}:`, e);
            results[url] = null;
        }
    }
    
    return results;
}

async function preloadAllImages() {
    // Critical-first loading: currencies, brand art and a few visible starter cases.
    // Remaining case/item/house/avatar assets load naturally when their screen is opened.
    const urls = new Set([PATHS.coin, PATHS.gem, 'png/PNG Zombix (2).png']);
    if (CASES_DATABASE?.cases) {
        CASES_DATABASE.cases.slice(0, 6).forEach(c => { if (c.image) urls.add(c.image); });
    }
    const list = Array.from(urls);
    const results = await Promise.allSettled(list.map(url => preloadImage(url)));
    return results.filter(r => r.status === 'fulfilled' && r.value).length;
}

async function preloadAllAudioFiles() {
    // Audio is loaded on first use to avoid blocking first paint on mobile devices.
    return 0;
}

// ==================== ВОССТАНОВЛЕНИЕ ИЗОБРАЖЕНИЙ ====================

let restoreTimeout = null;

function restoreAllImages() {
    if (restoreTimeout) clearTimeout(restoreTimeout);
    
    restoreTimeout = setTimeout(() => {
        const images = document.querySelectorAll('img');
        let restored = 0;
        
        images.forEach(img => {
            if (img.complete && img.naturalWidth === 0 && img.src) {
                const cleanSrc = img.src.split('?')[0];
                const cached = getCachedImage(cleanSrc);
                
                if (cached) {
                    img.src = cached.src;
                    restored++;
                } else if (!failedImages.has(cleanSrc)) {
                    const retryImg = new Image();
                    retryImg.onload = () => {
                        imageCache.set(cleanSrc, retryImg);
                        img.src = retryImg.src;
                    };
                    retryImg.onerror = () => {
                        failedImages.add(cleanSrc);
                    };
                    retryImg.src = cleanSrc;
                }
            }
        });
        
        if (restored > 0) {
            console.log(`[CACHE] Восстановлено изображений: ${restored}`);
        }
    }, 500);
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

async function initializeCache() {
    if (cacheInitialized) return;
    
    console.log('[CACHE] Инициализация...');
    
    try {
        await preloadAllJSON();
        await preloadAllImages();
        await preloadAllAudioFiles();
        
        cacheInitialized = true;
        console.log('[CACHE] Готово');
    } catch(e) {
        console.error('[CACHE] Ошибка инициализации:', e);
    }
}

function clearAllCache() {
    imageCache.clear();
    failedImages.clear();
    jsonCache.clear();
    audioCache.clear();
    cacheInitialized = false;
    
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
        if (key.startsWith('json_cache_')) {
            localStorage.removeItem(key);
        }
    });
    
    console.log('[CACHE] Кэш очищен');
}

// ==================== СОБЫТИЯ ====================

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) restoreAllImages();
});

window.addEventListener('focus', () => {
    restoreAllImages();
});

window.addEventListener('online', () => {
    restoreAllImages();
});

// ==================== ЭКСПОРТ ====================

window.debugCache = {
    images: imageCache,
    json: jsonCache,
    audio: audioCache,
    clearAll: clearAllCache,
    restoreImages: restoreAllImages,
    stats: () => ({
        images: imageCache.size,
        json: jsonCache.size,
        audio: audioCache.size,
        failedImages: failedImages.size
    })
};

console.log('[CACHE] Модуль кэширования загружен');