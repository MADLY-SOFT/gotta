// js/config.js — ФУНДАМЕНТ ИГРЫ «ZOMBIX SIMULATOR»

// ==================== ПУТИ К РЕСУРСАМ ====================
const GEM_COIN_VALUE = 15000;

const PATHS = {
    data: 'data/',
    audio: 'audio/',
    // Compatibility alias: item art is packed into one shared atlas.
    loot: 'png/items-atlas.png',
    itemAtlas: 'png/items-atlas.png',
    cases: 'png/cases/',
    avatars: 'png/avatars/',
    houses: 'png/houses/',
    money: 'png/ui/',
    coin: 'png/ui/coin.png',
    gem: 'png/ui/gem.png',
    shards: 'png/ui/shards.png',
    artifacts: 'png/artifacts/',
};

// ==================== РЕДКОСТИ ПРЕДМЕТОВ ====================
const tierNames = {
    1: 'ОБЫЧНЫЙ',
    2: 'НЕОБЫЧНЫЙ',
    3: 'РЕДКИЙ',
    4: 'ЭПИЧЕСКИЙ',
    5: 'ЛЕГЕНДАРНЫЙ',
    6: 'ЭЛИТНЫЙ'
};

const tierColors = {
    1: '#ffffff',
    2: '#4CAF50',
    3: '#2196F3',
    4: '#9C27B0',
    5: '#FF6D00',
    6: '#FC1024'
};

const tierGlow = {
    1: 'rgba(255,255,255,0.15)',
    2: 'rgba(76,175,80,0.25)',
    3: 'rgba(33,150,243,0.35)',
    4: 'rgba(156,39,176,0.45)',
    5: 'rgba(255,109,0,0.6)',
    6: 'rgba(252,16,36,0.64)'
};

// ==================== БАЗЫ ДАННЫХ ====================
let ITEMS_DATABASE = { items: [] };
let CASES_DATABASE = { cases: [] };
let AVATARS_DATABASE = { avatars: [] };
let HOUSE_DATABASE = { maxLevel: 30, maxCollectHours: 4, levels: [], backgrounds: [] };
let DAILY_REWARDS_DATABASE = { cycleDays: 30, rewards: [] };
let ARTIFACTS_DATABASE = { version: 1, artifacts: [] };
let PROMO_CODES_DATABASE = { version: 1, codes: [] };

// ==================== СОСТОЯНИЕ ИГРОКА ====================
const GameState = {
    nickname: '',
    nicknameChangeCount: 0,
    promoUsed: [],
    // Экономика
    coins: 1000,
    gems: 10,
    shards: 0,
    
    // Прогресс
    level: 1,
    experience: 0,
    expToNext: 75,
    totalCasesOpened: 0,
    totalCoinsEarned: 0,
    
    
    // Инвентарь
    inventory: [],
    artifacts: [],
    collectionFound: [],
    
    // Аватары
    ownedAvatars: [1],
    selectedAvatar: 1,
    lastAvatarChangeTime: 0,
    
    // Дом
    houseLevel: 1,
    lastHouseCollectTime: Date.now(),
    houseIncomeEarned: 0,
    ownedHouseBackgrounds: ['day'],
    selectedHouseBackground: 'day',
    
    // Выжившие
    rating: 0,
    dailyQuestKey: '',
    dailyQuestProgress: { cases:0, coins:0, sell:0, contracts:0, house:0,  rare:0, levels:0, houseCollect:0, spend:0, gems:0, xp:0 },
    dailyQuestClaimed: [],
    weeklyQuestKey: '',
    weeklyQuestProgress: { cases:0, coins:0, sell:0, contracts:0, house:0,  rare:0, levels:0, houseCollect:0, spend:0, gems:0, xp:0 },
    weeklyQuestClaimed: [],
    
    // Настройки
    settings: { sound: true, skin: 'gold', corners: 'rounded', allowMessages: true },
    
    // Служебное
    gameDataLoaded: false,
    lastAdCoinsTime: 0,
    adCoinsDayKey: '',
    adCoinsDailyCount: 0,
    houseCycle: 1,
    dailyRewardDay: 1,
    dailyRewardLastClaim: '',
};

// ==================== ГЛОБАЛЬНЫЕ ССЫЛКИ ====================
let coins = GameState.coins;
let gems = GameState.gems;
let inventory = GameState.inventory;
let artifacts = GameState.artifacts;
let collectionFound = GameState.collectionFound;
let ownedAvatars = GameState.ownedAvatars;
let selectedAvatar = GameState.selectedAvatar;
let lastAvatarChangeTime = GameState.lastAvatarChangeTime;
let level = GameState.level;
let experience = GameState.experience;
let expToNext = GameState.expToNext;
let totalCasesOpened = GameState.totalCasesOpened;
let totalCoinsEarned = GameState.totalCoinsEarned;
let houseLevel = GameState.houseLevel;
let lastHouseCollectTime = GameState.lastHouseCollectTime;
let houseIncomeEarned = GameState.houseIncomeEarned;
let ownedHouseBackgrounds = GameState.ownedHouseBackgrounds;
let selectedHouseBackground = GameState.selectedHouseBackground;
let rating = GameState.rating;
let settings = GameState.settings;
let lastAdCoinsTime = GameState.lastAdCoinsTime;
let dailyRewardDay = GameState.dailyRewardDay;
let dailyRewardLastClaim = GameState.dailyRewardLastClaim;
let gameDataLoaded = GameState.gameDataLoaded;

// ==================== ВРЕМЕННЫЕ СОСТОЯНИЯ ====================
let currentRouletteCase = null;
let currentRouletteResult = null;
let isSpinning = false;
let currentModalItem = null;
let currentModalItemIsFromInventory = false;
let currentModalItemIndex = null;
let pendingConfirmAction = null;
let leaderboardName = 'TopRating';
let saveTimeout = null;
let currentCaseFilter = 'all';

// ==================== КОНСТАНТЫ ====================
const CONTRACT_MIN_ITEMS = 3;
const CONTRACT_MAX_ITEMS = 9;


const INCOME_INTERVAL_MS = 60 * 1000;
const MAX_COLLECT_MINUTES = 4 * 60;

// ==================== ФУНКЦИИ-ПОМОЩНИКИ ====================
function getItemById(id) { 
    return ITEMS_DATABASE.items.find(i => i.id === id); 
}

function getCaseById(id) { 
    return CASES_DATABASE.cases.find(c => c.id === id); 
}

function getAvatarById(id) { 
    return AVATARS_DATABASE.avatars.find(a => a.id === id); 
}

function getHouseLevelData(level) { 
    return HOUSE_DATABASE.levels.find(l => l.level === level) || HOUSE_DATABASE.levels[0]; 
}

function getDropTable(caseId) { 
    const c = getCaseById(caseId); 
    return c ? c.dropTable : []; 
}

function getRandomDrop(caseId) { 
    const table = getDropTable(caseId); 
    if (table.length === 0) return null;
    
    const total = table.reduce((s, d) => s + d.chance, 0); 
    let r = Math.random() * total; 
    
    for (const d of table) { 
        r -= d.chance; 
        if (r <= 0) return { item: getItemById(d.itemId), tier: d.tier }; 
    } 
    
    const first = table[0]; 
    return { item: getItemById(first.itemId), tier: first.tier }; 
}

function getRandomExp(caseData) { 
    if (caseData?.exp && Array.isArray(caseData.exp) && caseData.exp.length === 2) {
        return Math.floor(Math.random() * (caseData.exp[1] - caseData.exp[0] + 1)) + caseData.exp[0]; 
    }
    return 20; 
}

function getRandomMultiplier() {
    const r = Math.random();
    if (r < 0.35) return 0.5 + Math.random() * 0.5;
    else if (r < 0.75) return 1.0 + Math.random() * 0.8;
    else return 1.8 + Math.random() * 0.7;
}

function calculateExpToNext(lvl) {
    return lvl * 75;
}

// ==================== УТИЛИТЫ ====================
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatNumber(value) {
    if (value < 1000) return value.toString();
    if (value < 1000000) {
        const k = value / 1000;
        return (k >= 100 ? k.toFixed(0) : k.toFixed(1)) + 'k';
    }
    const m = value / 1000000;
    return (m >= 100 ? m.toFixed(0) : m.toFixed(1)) + 'M';
}

function formatNumberFull(value) {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ==================== СИНХРОНИЗАЦИЯ ====================
function syncGlobalsFromState() {
    coins = GameState.coins;
    gems = GameState.gems;
    inventory = GameState.inventory;
    artifacts = GameState.artifacts;
    collectionFound = GameState.collectionFound;
    ownedAvatars = GameState.ownedAvatars;
    selectedAvatar = GameState.selectedAvatar;
    lastAvatarChangeTime = GameState.lastAvatarChangeTime;
    level = GameState.level;
    experience = GameState.experience;
    expToNext = GameState.expToNext;
    totalCasesOpened = GameState.totalCasesOpened;
    totalCoinsEarned = GameState.totalCoinsEarned;
    houseLevel = GameState.houseLevel;
    lastHouseCollectTime = GameState.lastHouseCollectTime;
    houseIncomeEarned = GameState.houseIncomeEarned;
    ownedHouseBackgrounds = GameState.ownedHouseBackgrounds;
    selectedHouseBackground = GameState.selectedHouseBackground;
    rating = GameState.rating || 0;
    settings = GameState.settings;
    lastAdCoinsTime = GameState.lastAdCoinsTime;
    dailyRewardDay = GameState.dailyRewardDay;
    dailyRewardLastClaim = GameState.dailyRewardLastClaim;
    gameDataLoaded = GameState.gameDataLoaded;
}

// ==================== ОТЛАДКА ====================
window.debugGame = {
    state: GameState,
    syncGlobals: syncGlobalsFromState,
    paths: PATHS,
    databases: {
        items: ITEMS_DATABASE,
        cases: CASES_DATABASE,
        avatars: AVATARS_DATABASE,
        house: HOUSE_DATABASE,
        artifacts: ARTIFACTS_DATABASE,
    }
};

console.log('[CONFIG] Модуль конфигурации загружен');
// Shared visual: original artifact identifiers map to lossless PNG atlas cells.
function artifactSprite(id, extraClass='') {
  const index = Number(id)-1;
  if (!Number.isInteger(index) || index<0 || index>=41) return '<span class="artifact-sprite artifact-sprite-missing"></span>';
  const column=index%7, row=Math.floor(index/7);
  return `<span aria-hidden="true" class="artifact-sprite ${extraClass}" style="--artifact-x:${column*100/6}%;--artifact-y:${row*100/5}%"></span>`;
}
