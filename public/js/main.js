
// js/main.js — ИНИЦИАЛИЗАЦИЯ ИГРЫ

let gameInitialized = false;

// ==================== ЗАГРУЗКА ====================

async function loadAllAssets() { 
    const loadingScreen = document.getElementById('loading-screen'); 
    const bar = document.getElementById('loading-bar'); 
    const text = document.getElementById('loading-text'); 
    
    if (!loadingScreen || !bar || !text) {
        console.error('[LOAD] Не найдены элементы загрузки');
        return false;
    }
    
    loadingScreen.style.display = 'flex'; 
    bar.style.width = '0%'; 
    text.textContent = 'ЗАГРУЗКА... 0%'; 
    
    let progress = 0; 
    const interval = setInterval(() => { 
        if (progress < 30) { 
            progress += Math.random() * 2; 
            if (progress > 30) progress = 30; 
            bar.style.width = progress + '%'; 
        } 
    }, 100); 
    
    try { 
        // ШАГ 1: Загрузка данных (JSON)
        if (!gameDataLoaded) { 
            text.textContent = 'ЗАГРУЗКА ДАННЫХ...';
            
            const [itemsData, casesData, avatarsData, houseData, dailyData, artifactsData] = await Promise.all([
                fetchJSONWithCache(PATHS.data + 'items.json'),
                fetchJSONWithCache(PATHS.data + 'cases.json'),
                fetchJSONWithCache(PATHS.data + 'avatars.json'),
                fetchJSONWithCache(PATHS.data + 'house.json'),
                fetchJSONWithCache(PATHS.data + 'daily_rewards.json'),
                fetchJSONWithCache(PATHS.data + 'artifacts.json')
            ]);
            
            ITEMS_DATABASE = itemsData; 
            CASES_DATABASE = casesData; 
            AVATARS_DATABASE = avatarsData; 
            HOUSE_DATABASE = houseData;
            DAILY_REWARDS_DATABASE = dailyData;
            ARTIFACTS_DATABASE = artifactsData;
            gameDataLoaded = true; 
        }
        
        // ШАГ 2: Загрузка изображений
        progress = 40;
        bar.style.width = progress + '%';
        text.textContent = 'ЗАГРУЗКА ИЗОБРАЖЕНИЙ...';
        
        await preloadAllImages();
        
        // ШАГ 3: Загрузка звуков
        progress = 60;
        bar.style.width = progress + '%';
        text.textContent = 'ЗАГРУЗКА ЗВУКОВ...';
        
        await preloadAllAudioFiles();
        
        // ШАГ 4: Инициализация звуков
        progress = 70;
        bar.style.width = progress + '%';
        text.textContent = 'ИНИЦИАЛИЗАЦИЯ...';
        
        initSounds();
        
        // ШАГ 5: Инициализация SDK
        progress = 80;
        bar.style.width = progress + '%';
        text.textContent = 'ПОДКЛЮЧЕНИЕ...';
        
        await initLocalPlatform();
        
        // ШАГ 6: Загрузка сохранений
        progress = 90;
        bar.style.width = progress + '%';
        text.textContent = 'ЗАГРУЗКА СОХРАНЕНИЙ...';
        
        await loadCloudProgress();
        if (GameState.nickname) { playerName = GameState.nickname; window.__playerName = playerName; }
        
        // Исправление expToNext
        if (!GameState.expToNext || GameState.expToNext < GameState.level * 75) {
            GameState.expToNext = GameState.level * 75;
        }
        
        // Применяем настройки
        const app = document.getElementById('app');
        if (app) {
            if (GameState.settings?.skin) app.setAttribute('data-skin', GameState.settings.skin);
            if (GameState.settings?.corners) app.setAttribute('data-corners', GameState.settings.corners);
        }
        
        setTimeout(() => { if (typeof recolorOtherIcons === 'function') recolorOtherIcons(); }, 0);

        // Обновляем кнопки скинов
        if (GameState.settings?.skin) {
            document.querySelectorAll('[id^="skin-"]').forEach(btn => {
                btn.classList.toggle('active', btn.id === 'skin-' + GameState.settings.skin);
            });
        }
        
        // Обновляем кнопки углов
        if (GameState.settings?.corners) {
            document.querySelectorAll('[id^="corners-"]').forEach(btn => {
                btn.classList.toggle('active', btn.id === 'corners-' + GameState.settings.corners);
            });
        }
        
        // Обновляем кнопки звука
        if (typeof soundEnabled !== 'undefined') {
            const soundOn = document.getElementById('sound-on');
            const soundOff = document.getElementById('sound-off');
            if (soundOn) soundOn.classList.toggle('active', soundEnabled);
            if (soundOff) soundOff.classList.toggle('active', !soundEnabled);
        }
        
        // Обновляем баланс
        syncGlobalsFromState();
        updateBalance();
        
        // ШАГ 7: Готово
        progress = 100;
        bar.style.width = '100%'; 
        text.textContent = 'ГОТОВО!'; 
        
        await new Promise(r => setTimeout(r, 300)); 
        return true; 
        
    } catch(e) { 
        console.error('Ошибка загрузки:', e);
        
        text.textContent = 'ОШИБКА ЗАГРУЗКИ: ' + e.message;
        await new Promise(r => setTimeout(r, 2000));
        return false; 
    } finally { 
        clearInterval(interval); 
        loadingScreen.style.display = 'none'; 
    } 
}

// ==================== СТАРТ ИГРЫ ====================

async function startGame() {
    if (typeof authReady !== 'undefined' && !authReady) { showAuthScreen(); return; }
    if (gameInitialized) {
        const mainMenu = document.getElementById('main-menu');
        const gameScreen = document.getElementById('game-screen');
        
        if (mainMenu) mainMenu.style.display = 'none'; 
        if (gameScreen) gameScreen.style.display = 'flex'; 
        
        // Всегда возвращаемся в начало игры, а не в старую вкладку/старый scrollTop.
        switchTab('shop');
        updateBalance();
        updateLeaderboard();
        if(typeof checkMailIndicator==='function')checkMailIndicator();
        return;
    }
    
    const ok = await loadAllAssets(); 
    if (!ok) return; 
    
    gameInitialized = true;
    currentTabIndex = 0;
    
    const mainMenu = document.getElementById('main-menu');
    const gameScreen = document.getElementById('game-screen');
    
    if (mainMenu) mainMenu.style.display = 'none'; 
    if (gameScreen) gameScreen.style.display = 'flex'; 
    
    // Открываем главный экран КЕЙСЫ; остальные разделы отрисовываются по мере входа.
    switchTab('shop');
    updateBalance();
    updateLeaderboard();
    if(typeof checkMailIndicator==='function')checkMailIndicator();
    
}

// Интерактивные предметы главного меню: случайные предметы, плавная смена и drag-to-throw физика.
let menuRelicCatalog = [];
let menuRelicCatalogPromise = null;
const menuRelicPointers = new WeakMap();
function loadMenuRelicCatalog() {
    if (menuRelicCatalog.length) return Promise.resolve(menuRelicCatalog);
    if (!menuRelicCatalogPromise) {
        menuRelicCatalogPromise = fetch('data/items.json', { cache: 'force-cache' })
            .then(response => { if (!response.ok) throw new Error('items catalog unavailable'); return response.json(); })
            .then(data => {
                menuRelicCatalog = (Array.isArray(data.items) ? data.items : [])
                    .filter(item => item && item.image && item.tiers && Object.keys(item.tiers).length)
                    .map(item => ({ image: item.image, name: String(item.name || 'Предмет'), tiers: Object.keys(item.tiers).map(Number).filter(n => n >= 1 && n <= 6) }));
                return menuRelicCatalog;
            }).catch(() => { menuRelicCatalogPromise = null; return []; });
    }
    return menuRelicCatalogPromise;
}
function chooseMenuRelic(excludeImage='') {
    const options = menuRelicCatalog.filter(item => item.image !== excludeImage);
    const pool = options.length ? options : menuRelicCatalog;
    const item = pool[Math.floor(Math.random() * Math.max(1, pool.length))];
    if (!item) return null;
    const tiers = item.tiers.length ? item.tiers : [1];
    return { ...item, tier: tiers[Math.floor(Math.random() * tiers.length)] };
}
function menuRelicColors(tier) {
    return ({1:['#ffffff','#e5edf5'],2:['#a9f2b0','#ffffff'],3:['#a8d8ff','#ffffff'],4:['#e4b4ff','#ffffff'],5:['#ffd36a','#fff1c4'],6:['#ff9c9c','#fff2c8']})[tier] || ['#ffffff','#f2c36c'];
}
function emitMenuRelicParticles(stage, x, y, tier, count=16) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const colors = menuRelicColors(tier);
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('i');
        const angle = Math.PI * 2 * i / count + (Math.random() - .5) * .22;
        const distance = 16 + Math.random() * 42;
        particle.className = 'relic-particle';
        particle.style.left = `${x}px`; particle.style.top = `${y}px`;
        particle.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
        particle.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
        particle.style.background = colors[i % colors.length];
        particle.style.color = colors[i % colors.length];
        stage.appendChild(particle);
        setTimeout(() => particle.remove(), 950);
    }
}
async function swapMenuRelic(relic) {
    const img = relic.querySelector('.item-atlas');
    const oldSrc = img?.dataset.itemImage || '';
    relic.classList.add('relic-changing');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Keep the outgoing item visible long enough for the fade to be perceived.
    if (!reduceMotion) await new Promise(resolve => setTimeout(resolve, 230));
    await loadMenuRelicCatalog();
    const next = chooseMenuRelic(oldSrc);
    if (next && img) {
        setItemAtlasElement(img, next.image);
        relic.dataset.tier = String(next.tier);
        relic.setAttribute('aria-label', `Предмет: ${next.name}. Нажми или потяни, чтобы сменить предмет.`);
    }
    relic.style.transform = '';
    relic.style.opacity = '';
    relic.classList.remove('relic-thrown', 'relic-dragging');
    requestAnimationFrame(() => {
        relic.classList.remove('relic-changing');
        relic.classList.add('relic-arriving');
        setTimeout(() => { relic.classList.remove('relic-arriving'); relic.dataset.busy = '0'; }, 780);
    });
}
function activateMenuRelic(relic, stage) {
    if (relic.dataset.busy === '1') return;
    relic.dataset.busy = '1';
    if (typeof playClick === 'function') playClick();
    const rect = relic.getBoundingClientRect(), root = stage.getBoundingClientRect();
    const x = rect.left - root.left + rect.width / 2, y = rect.top - root.top + rect.height / 2;
    emitMenuRelicParticles(stage, x, y, Number(relic.dataset.tier) || 1, 7);
    swapMenuRelic(relic).catch(() => {
        relic.style.transform = ''; relic.style.opacity = '';
        relic.classList.remove('relic-changing', 'relic-thrown', 'relic-dragging');
        relic.dataset.busy = '0';
    });
}
function throwMenuRelic(relic, stage, gesture) {
    if (relic.dataset.busy === '1') return;
    relic.dataset.busy = '1';
    relic.classList.remove('relic-dragging');
    relic.classList.add('relic-thrown');
    if (typeof playClick === 'function') playClick();
    const rect = relic.getBoundingClientRect(), root = stage.getBoundingClientRect();
    const centerX = rect.left - root.left + rect.width / 2;
    const centerY = rect.top - root.top + rect.height / 2;
    // The item follows the finger only a short distance; release adds a soft,
    // damped drift rather than launching it across the screen.
    let x = Math.max(-96, Math.min(96, Number(gesture.dx) || 0));
    let y = Math.max(-78, Math.min(78, Number(gesture.dy) || 0));
    const distance = Math.max(1, Math.hypot(gesture.dx, gesture.dy));
    // Preserve a noticeable release impulse; the previous low cap and strong
    // damping made a deliberate throw feel almost identical to a tap.
    let vx = Math.max(-1.05, Math.min(1.05, (Number(gesture.vx) || 0) * .9));
    let vy = Math.max(-1.05, Math.min(1.05, (Number(gesture.vy) || 0) * .9));
    const minimumImpulse = Math.min(.62, .28 + distance / 260);
    if (Math.hypot(vx, vy) < minimumImpulse) { vx = gesture.dx / distance * minimumImpulse; vy = gesture.dy / distance * minimumImpulse; }
    let spin = 0, last = performance.now(), elapsed = 0;
    const tier = Number(relic.dataset.tier) || 1;
    const tick = now => {
        const dt = Math.min(32, Math.max(0, now - last)); last = now; elapsed += dt;
        x += vx * dt; y += vy * dt;
        vy += .00024 * dt;
        vx *= Math.pow(.972, dt / 16);
        vy *= Math.pow(.972, dt / 16);
        spin += vx * dt * .025;
        const progress = Math.min(1, elapsed / 820);
        relic.style.transform = `translate3d(${x}px,${y}px,0) rotate(${spin}deg) scale(${1 - progress * .12})`;
        relic.style.opacity = String(Math.max(0, 1 - Math.max(0, (progress - .42) / .58)));
        if (elapsed < 820) {
            requestAnimationFrame(tick);
        } else {
            emitMenuRelicParticles(stage, centerX + x, centerY + y, tier, 8);
            swapMenuRelic(relic, stage, centerX, centerY).catch(() => {
                relic.style.transform = ''; relic.style.opacity = '';
                relic.classList.remove('relic-changing', 'relic-thrown'); relic.dataset.busy = '0';
            });
        }
    };
    requestAnimationFrame(tick);
}
function initMenuRelics() {
    const stage = document.getElementById('menu-relic-stage');
    if (!stage || stage.dataset.ready === '1') return;
    stage.dataset.ready = '1';
    loadMenuRelicCatalog().then(() => {
        stage.querySelectorAll('.floating-relic').forEach(relic => {
            const current = relic.querySelector('.item-atlas')?.dataset.itemImage || '';
            const next = chooseMenuRelic(current);
            if (next) {
                const img = relic.querySelector('.item-atlas'); if (img) setItemAtlasElement(img, next.image);
                relic.dataset.tier = String(next.tier);
                relic.setAttribute('aria-label', `Предмет: ${next.name}. Нажми или потяни, чтобы сменить предмет.`);
            }
        });
    });
    stage.querySelectorAll('.floating-relic').forEach(relic => {
        relic.addEventListener('pointerdown', event => {
            if (relic.dataset.busy === '1' || event.button > 0) return;
            const state = { id:event.pointerId, startX:event.clientX, startY:event.clientY, lastX:event.clientX, lastY:event.clientY, lastAt:performance.now(), dx:0, dy:0, vx:0, vy:0, moved:false };
            menuRelicPointers.set(relic, state);
            relic.classList.add('relic-dragging');
            try { relic.setPointerCapture(event.pointerId); } catch (_) {}
        });
        relic.addEventListener('pointermove', event => {
            const state = menuRelicPointers.get(relic);
            if (!state || state.id !== event.pointerId) return;
            const now = performance.now(), dt = Math.max(1, now - state.lastAt);
            state.dx = event.clientX - state.startX; state.dy = event.clientY - state.startY;
            state.vx = (event.clientX - state.lastX) / dt; state.vy = (event.clientY - state.lastY) / dt;
            state.lastX = event.clientX; state.lastY = event.clientY; state.lastAt = now;
            if (Math.hypot(state.dx, state.dy) > 7) state.moved = true;
            if (state.moved) { const dragX = Math.max(-96, Math.min(96, state.dx)); const dragY = Math.max(-78, Math.min(78, state.dy)); relic.style.transform = `translate3d(${dragX}px,${dragY}px,0) rotate(${dragX * .025}deg) scale(1.025)`; }
        });
        const finishPointer = event => {
            const state = menuRelicPointers.get(relic);
            if (!state || state.id !== event.pointerId) return;
            menuRelicPointers.delete(relic);
            if (state.moved && Math.hypot(state.dx, state.dy) > 12) throwMenuRelic(relic, stage, state);
            else { relic.style.transform = ''; relic.classList.remove('relic-dragging'); activateMenuRelic(relic, stage); }
        };
        relic.addEventListener('pointerup', finishPointer);
        relic.addEventListener('pointercancel', event => {
            const state = menuRelicPointers.get(relic);
            if (state?.id === event.pointerId) { menuRelicPointers.delete(relic); relic.style.transform=''; relic.classList.remove('relic-dragging'); }
        });
        // Preserve keyboard accessibility; pointer interactions are handled above.
        relic.addEventListener('click', event => {
            if (event.detail === 0) activateMenuRelic(relic, stage);
        });
    });
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

document.addEventListener('DOMContentLoaded', () => { 
    createBackgroundParticles();
    initMenuRelics();
    
    const mainMenu = document.getElementById('main-menu');
    if (mainMenu) mainMenu.style.display = 'flex'; 
    
    // Ничего не загружаем до нажатия "ИГРАТЬ"
});

console.log('[MAIN] Модуль инициализации загружен');