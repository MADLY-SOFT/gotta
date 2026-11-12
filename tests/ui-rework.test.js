const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('main menu shows only live online count and removes static catalog counters', () => {
  const html = read('public/index.html');
  assert.match(html, /id="menu-online-count"/);
  assert.doesNotMatch(html, /menu-total-players|menu-playing-count|menu-peak-count/);
  assert.doesNotMatch(html, /<b>44<\/b>|<b>171<\/b>/);
});

test('main menu contains accessible interactive relic scene and real case artwork', () => {
  const html = read('public/index.html');
  assert.match(html, /id="menu-relic-stage"/);
  assert.match(html, /class="floating-relic/);
  assert.match(html, /id="play-btn"/);
  assert.match(html, /id="howto-btn"/);
  assert.doesNotMatch(html, /relic-stage-caption|ТВОЯ СЛЕДУЮЩАЯ НАХОДКА|Мир редких находок|menu-intel-card/);
  assert.match(read('public/js/main.js'), /function initMenuRelics\(/);
  assert.match(read('public/js/main.js'), /relic-particle/);
  assert.match(read('public/js/main.js'), /data\/items\.json/);
  assert.match(read('public/js/ui.js'), /howto-guide-grid/);
});

test('case opening UI has no skip-animation control or technical trust note', () => {
  const html = read('public/index.html');
  assert.doesNotMatch(html, /skip-roulette-btn|ПРОПУСТИТЬ АНИМАЦИЮ|РЕЗУЛЬТАТ ЗАФИКСИРОВАН СЕРВЕРОМ/);
});

test('case reels are generated as horizontal lanes and use server response rewards', () => {
  const js = read('public/js/cases.js');
  const css = read('public/css/app.css');
  assert.match(js, /const rewards = Array\.isArray\(data\.result\?\.items\)/);
  assert.match(js, /horizontal-reel/);
  assert.match(js, /ROULETTE_TARGET_INDEX = 42/);
  assert.match(css, /\.reel-track\{[^}]*flex-direction:row/s);
  assert.match(css, /\.horizontal-reel/);
});

test('roulette has reduced-motion handling and responsive 25/75 action layout', () => {
  const js = read('public/js/cases.js');
  const css = read('public/css/app.css');
  assert.match(js, /prefers-reduced-motion/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(0,3fr\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});


test('profile removes wallet-history and collections navigation while retaining achievements', () => {
  const js = read('public/js/profile.js');
  assert.match(js, /ДОСТИЖЕНИЯ/);
  assert.doesNotMatch(js, /openWalletHistory\(|КОЛЛЕКЦИИ И ДОСТИЖЕНИЯ|progress-album-tabs/);
  assert.match(js, /item\.claimed/);
  assert.match(js, /achievement-completed-section/);
  assert.match(js, /idempotentApiAction\('achievement_claim'/);
  assert.match(js, /png\/ui\/coin\.png/);
  assert.match(js, /png\/ui\/gem\.png/);
});

test('inventory renders from the loaded authoritative snapshot without a stuck spinner or pagination', () => {
  const js = read('public/js/profile.js');
  assert.match(js, /const source = Array\.isArray\(GameState\.inventory\)/);
  assert.match(js, /row\.indices\.push\(index\)/);
  assert.match(js, /grid\.replaceChildren\(fragment\)/);
  assert.match(js, /ИНВЕНТАРЬ ПУСТ/);
  assert.doesNotMatch(js, /ЗАГРУЗКА ИНВЕНТАРЯ|inventoryPage|changeInventoryPage|apiRequest\(`\/api\/inventory/);
  assert.doesNotMatch(js.slice(js.indexOf('function renderProfile()'), js.indexOf('function closeSimpleGameModal')), /inventory-pagination/);
});

test('case history is a ten-session display without pagination or financial detail UI', () => {
  const js = read('public/js/cases.js');
  const server = read('server.js');
  assert.match(js, /api\/case-history\?limit=10/);
  assert.match(js, /slice\(0, 10\)/);
  assert.match(js, /case-history-case-title/);
  assert.match(read('public/css/app.css'), /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  const historyView = js.slice(js.indexOf('// ==================== ИСТОРИЯ ОТКРЫТИЙ ===================='));
  assert.doesNotMatch(historyView, /case-history-more|ЗАГРУЗИТЬ ЕЩЁ|NPC|T1–T5/);
  assert.match(server, /Math\.min\(10,/);
  assert.match(server, /ORDER BY id DESC LIMIT \?/);
});

test('quests show only server-backed daily and weekly categories and claim via server action', () => {
  const js = read('public/js/zone.js');
  assert.match(js, /\['achievements','daily','weekly'\]/);
  assert.match(js, /gameAction\('claimQuest'/);
  assert.match(js, /ЗАГРУЖАЕМ ПРОГРЕСС/);
  assert.match(js, /Не удалось загрузить задания/i);
  assert.match(js, /ЗАБРАТЬ/);
  assert.match(js, /В ПРОЦЕССЕ/);
});

test('promo validation supports expiry while preserving server-side duplicate checks', () => {
  const js = read('public/js/promo.js');
  const server = read('server.js');
  assert.match(js, /if\(promoSubmitting\)return/);
  assert.match(server, /getPromoExpiryError\(promo,now\(\)\)/);
  assert.match(server, /state\.promoUsed\.includes\(code\)/);
});

test('roulette centers the server reward, staggers horizontal lanes and cleans animation frames', () => {
  const js = read('public/js/cases.js');
  const html = read('public/index.html');
  const css = read('public/css/app.css');
  assert.match(js, /viewport\.clientWidth \/ 2/);
  assert.match(js, /requestAnimationFrame\(tickLoop\)/);
  assert.match(js, /cancelAnimationFrame\(frame\)/);
  assert.match(html, /id="spin-main-note"/);
  assert.match(html, /id="fast-spin-note"/);
  assert.match(css, /\.spin-main-wrap/);
});

test('special achievements use persisted server-side counters', () => {
  const source = read('server.js');
  for (const token of ['rare_streak_3', 'big_opening_10', 'active_days_7', 'case_variety_5', 'rareStreak', 'bigOpening', 'activeDays', 'caseTypes']) assert.ok(source.includes(token), `Missing progression metric: ${token}`);
});

test('promo dialogs keep their actions outside independently scrolling content', () => {
  const html = read('public/index.html');
  const css = read('public/css/app.css');
  assert.match(html, /class="promo-modal-body"/);
  assert.match(html, /class="promo-reward-body"/);
  assert.match(css, /#promo-content \.promo-modal-body[^{]*\{[^}]*overflow-y:auto/s);
  assert.match(css, /#promo-reward-content \.promo-close-btn[^{]*\{[^}]*position:sticky/s);
});

test('case opening quantity selector exposes 1, 3, 5 and 10', () => {
  const html = read('public/index.html');
  const cases = read('public/js/cases.js');
  for (const n of [1, 3, 5, 10]) assert.match(html, new RegExp(`data-quantity=\"${n}\"`));
  assert.match(cases, /const allowed = \[1, 3, 5, 10\]/);
});

test('promo reward presentation and editor support coin, gem, shard and item rewards', () => {
  const promo = read('public/js/promo.js');
  const config = read('public/js/config.js');
  const server = read('server.js');
  const editor = read('public/editor.html');
  assert.match(promo, /reward\.shards/);
  assert.match(config, /shards: 'png\/ui\/shards\.png'/);
  assert.match(server, /shards:shardsReward/);
  assert.match(editor, /id=\"pShards\"/);
  assert.match(editor, /id=\"pExpires\"/);
});

test('quest panel reuses achievement cards, places claim action at card bottom and uses two columns', () => {
  const js = read('public/js/zone.js');
  const css = read('public/css/app.css');
  assert.doesNotMatch(js, /function questDescription\(q\)/);
  assert.match(js, /progress-achievement quest-achievement-card/);
  assert.match(js, /quest-progress-bar/);
  assert.match(js, /quest-claim-button/);
  assert.match(css, /\.quest-cards-grid[\s\S]*?repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.quest-claim-button[\s\S]*?width:100%/);
});

test('detached promo and case-history overlays inherit the selected skin and corner settings', () => {
  const promo = read('public/js/promo.js');
  const cases = read('public/js/cases.js');
  assert.match(promo, /function syncOverlayTheme\(modal\)/);
  assert.match(promo, /syncOverlayTheme\(modal\)/);
  assert.match(cases, /themeRoot\?\.getAttribute\('data-'\+key\)/);
});

test('case history includes a server timestamp rendered at the right of the case title', () => {
  const js = read('public/js/cases.js');
  const server = read('server.js');
  const css = read('public/css/app.css');
  assert.match(server, /createdAt:Number\(row\.created_at\)/);
  assert.match(js, /case-history-date/);
  assert.match(css, /\.case-history-date\{[^}]*margin-left:auto/s);
});

test('sound playback starts synchronously on the click gesture rather than after an async preload', () => {
  const audio = read('public/js/audio.js');
  assert.match(audio, /new Audio\(SOUND_FILES\[soundKey\]\)/);
  assert.match(audio, /const result = audio\.play\(\)/);
  assert.doesNotMatch(audio, /soundLoading\[soundKey\]\.then\(play\)/);
});

test('detached overlay and promo fields use theme variables and responsive main menu flow', () => {
  const css = read('public/css/app.css');
  assert.match(css, /#promo-input\{[^}]*background:var\(--bg-tertiary\)/s);
  assert.match(css, /#main-menu #play-btn\{[^}]*var\(--border-color\)/s);
  assert.match(css, /#main-menu\{justify-content:flex-start/);
});

test('main menu guide is a full illustrated modal and relics rotate to random catalog items', () => {
  const html = read('public/index.html');
  const ui = read('public/js/ui.js');
  const main = read('public/js/main.js');
  const css = read('public/css/app.css');
  assert.match(html, /id="howto-btn"/);
  assert.match(ui, /howto-guide-card/);
  assert.match(ui, /howto-guide-modal/);
  assert.match(ui, /png\/cases\/case_3\.png/);
  assert.match(main, /chooseMenuRelic/);
  assert.match(main, /relic-changing/);
  assert.match(css, /#main-menu #play-btn\s*,\s*#main-menu #howto-btn/);
});

test('case history is moved inside the fullscreen root and constrained to its panel', () => {
  const js = read('public/js/cases.js');
  const css = read('public/css/app.css');
  assert.match(js, /document\.fullscreenElement \|\| document\.getElementById\('app'\)/);
  assert.match(js, /overlay\.parentElement !== fullscreenRoot/);
  assert.match(css, /#app:fullscreen #case-history-overlay/);
  assert.match(css, /#case-history-entries\{[^}]*overflow:auto/s);
});

test('promo modal uses readable non-pixel typography', () => {
  const css = read('public/css/app.css');
  assert.match(css, /#promo-modal,#promo-reward-modal\{[^}]*font-family:var\(--z-font-game\)/s);
  assert.match(css, /--z-font-game:var\(--z-font-ui\)/, 'the game font token resolves to the readable UI font');
  assert.match(css, /#promo-input\{font:600 16px/);
});


test('case history keeps accessible item metadata while visual tiles stay image-only', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/cases.js'), 'utf8');
  assert.match(source, /case-history-drop-art/);
  assert.match(source, /case-history-case-copy/);
  assert.match(source, /aria-label=\"\$\{escapeHtml\(itemName\)\}\"/);
  assert.doesNotMatch(source, /<small>\$\{escapeHtml\(rarityName\)\}<\/small>/);
  assert.match(source, /toLocaleString\('ru-RU'/);
});

test('UI quality layer styles quest cards and achievement typography with the UI font', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
  assert.match(css, /\.quest-cards-grid\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.achievement-card-heading b\{[^}]*var\(--z-font-ui\)/);
  assert.match(css, /\.case-history-drop>b/);
});

test('main menu actions have distinct visual treatments and reduced-motion support', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
  assert.match(css, /#main-menu #play-btn\s*\{[^}]*linear-gradient/s);
  assert.match(css, /#main-menu #howto-btn\s*\{[^}]*linear-gradient/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:reduce\)/);
});


test('menu relics support pointer drag physics while preserving each relic tilt', () => {
  const main = read('public/js/main.js');
  const css = read('public/css/app.css');
  assert.match(main, /addEventListener\('pointerdown'/);
  assert.match(main, /addEventListener\('pointermove'/);
  assert.match(main, /setPointerCapture/);
  assert.match(main, /function throwMenuRelic/);
  assert.match(main, /vy \+= \.00024 \* dt/);
  assert.match(main, /chooseMenuRelic\(oldSrc\)/);
  assert.match(css, /\.relic-a\s*\{\s*--relic-tilt:\s*-11deg/);
  assert.match(css, /\.relic-b\s*\{\s*--relic-tilt:\s*10deg/);
  assert.match(css, /\.floating-relic\.relic-thrown/);
});

test('history uses compact date-only entries with independently scrolling content', () => {
  const js = read('public/js/cases.js');
  const css = read('public/css/app.css');
  assert.doesNotMatch(js, /СЕССИЯ \$\{String\(sessionIndex \+ 1\)/);
  assert.doesNotMatch(js, /ДАТА ОТКРЫТИЯ/);
  assert.doesNotMatch(js, /ВРЕМЯ НЕИЗВЕСТНО/);
  assert.match(js, /<time class="case-history-date"/);
  assert.match(js, /createdAt < 1e12 \? createdAt \* 1000/);
  assert.match(css, /#case-history-overlay \.case-history-panel\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /#case-history-entries\s*\{[^}]*overflow:\s*auto/s);
});

test('quest modal has a bounded shell with an independently scrolling body', () => {
  const css = read('public/css/app.css');
  assert.match(css, /#quests-content\{[^}]*height:min\(86dvh,780px\)/);
  assert.match(css, /#quests-body\{[^}]*overflow-y:auto/);
  assert.match(css, /\.quest-claim-button\{[^}]*width:100%/);
});

test('achievement cards use the UI font token and a full-width claim action', () => {
  const css = read('public/css/app.css');
  assert.match(css, /\.progress-achievement-claim\{[^}]*var\(--z-font-ui\)/);
  assert.match(css, /simple-game-card\.achievement-modal/);
});


test('generated CSS bundle is loaded once and included in offline shell', () => {
  const html = read('public/index.html');
  const sw = read('public/sw.js');
  assert.match(html, /href="css\/app\.css"/);
  assert.doesNotMatch(html, /href="(?:game|ui-v100)\.css"/);
  assert.match(sw, /\.\/css\/app\.css/);
});

test('v1.05 relic interactions use a stronger controlled throw and smooth fade replacement', () => {
  const main = read('public/js/main.js');
  const css = read('public/css/modules/menu/menu.css');
  assert.match(main, /Math\.max\(-96, Math\.min\(96, Number\(gesture\.dx\)/);
  assert.match(main, /Math\.max\(-1\.05, Math\.min\(1\.05/);
  assert.match(main, /vy \+= \.00024 \* dt/);
  assert.match(main, /elapsed \/ 820/);
  assert.match(css, /\.floating-relic\.relic-changing\s*\{[^}]*opacity:\s*0/s);
  assert.match(css, /\.floating-relic\.relic-arriving\s*\{[^}]*opacity:\s*1/s);
});

test('v1.13 roulette uses compact suspense timing and rarity-framed result cards', () => {
  const js = read('public/js/cases.js');
  const css = read('public/css/modules/cases/roulette.css');
  assert.match(js, /ROULETTE_TARGET_INDEX = 42/);
  assert.match(js, /4650 \+ index \* 55/);
  assert.match(js, /ROULETTE_TRAILING_CARDS = 2/);
  assert.match(js, /Math\.floor\(Math\.random\(\) \* variants\.length\)/);
  assert.match(js, /data-server-result=/);
  assert.doesNotMatch(js, /<small>\$\{escapeHtml\(rarity\)\}<\/small>/);
  assert.match(js, /mainNote\.hidden = !mainNote\.textContent/);
  assert.match(css, /\.multi-lane \.horizontal-reel/);
  assert.match(css, /\[data-stage="reveal"\] \.reel-card-winner/);
  assert.match(js, /setRouletteStage\('charging'\)/);
  assert.match(js, /function rouletteLanding/);
  assert.match(css, /\.reel-card-winner/);
});

test('v1.13 progression hub retains history, achievement, guide and promo visual layers', () => {
  const cases = read('public/js/cases.js');
  const profile = read('public/js/profile.js');
  const historyCss = read('public/css/modules/cases/history.css');
  const achievementCss = read('public/css/modules/profile/achievements.css');
  const guideCss = read('public/css/modules/features/guide.css');
  const promoCss = read('public/css/modules/economy/promos.css');
  assert.match(cases, /case-history-rewards-head/);
  assert.match(profile, /function renderProgressionCards\(data\)/);
  assert.match(profile, /openQuestsModal\('achievements'\)/);
  assert.match(historyCss, /case-history-rewards-head/);
  assert.match(achievementCss, /simple-game-card\.achievement-modal/);
  assert.match(guideCss, /howto-guide-modal \.howto-guide-copy b/);
  assert.match(promoCss, /promo-title::before/);
});

test('v1.03 multi-open reel grid remains scrollable on short mobile screens and removes sufficient-balance copy', () => {
  const js = read('public/js/cases.js');
  const css = read('public/css/modules/cases/roulette.css');
  assert.match(js, /multi-lane-container/);
  assert.match(css, /#roulette-container\.multi-lane-container\s*\{[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(js, /Монет достаточно\./);
});

test('private promo codes are removed from the public data directory and editor imports them manually', () => {
  assert.equal(fs.existsSync(path.join(root, 'public/data/promo_codes.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'private-data/promo_codes.json')), true);
  const editor = read('public/editor.html');
  assert.match(editor, /Промокоды импортируй отдельно из приватного файла/);
  assert.doesNotMatch(editor, /fetch\('data\/promo_codes\.json'/);
});

test('v1.05 main-menu relic taps cross-fade and deliberate throws travel farther', () => {
  const js = read('public/js/main.js');
  const css = read('public/css/app.css');
  assert.match(js, /setTimeout\(resolve, 230\)/);
  assert.match(js, /Math\.min\(1\.05/);
  assert.match(js, /Math\.pow\(\.972/);
  assert.match(js, /elapsed \/ 820/);
  assert.match(css, /\.floating-relic\.relic-changing\{[^}]*opacity:0/);
  assert.match(css, /relic-arriving \.item-atlas\{[^}]*menu-relic-arrive/);
  assert.match(css, /#main-menu #play-btn span\{[^}]*var\(--fs-xl\)/);
});

test('v2.0 design system: one token source, skins swap the accent and no override layer remains', () => {
  const tokens = read('public/css/modules/base/tokens.css');
  for (const skin of ['gold', 'ice', 'fire', 'toxic', 'violet', 'ocean', 'sand', 'neon', 'cyber']) assert.match(tokens, new RegExp(`\\[data-skin="${skin}"\\]\\{--accent:`));
  assert.match(tokens, /:root,\[data-skin\],\[data-corners\]\{/, 'derived tokens follow the active skin');
  assert.match(tokens, /--border-color:var\(--accent\)/, 'legacy aliases used by JS templates stay mapped');
  assert.match(tokens, /--z-font-pixel:"Press Start 2P"/);
  assert.equal(fs.existsSync(path.join(root, 'public/css/modules/zz/progression-theme.css')), false);
  const css = read('public/css/app.css');
  assert.ok(Buffer.byteLength(css) < 260_000, `bundle should stay compact, got ${Buffer.byteLength(css)} bytes`);
  assert.doesNotMatch(css, /@z-order/);
});

test('modal polish keeps typography readable and dialogs bounded inside the game frame', () => {
  const css = read('public/css/app.css');
  assert.match(css, /\.simple-game-card\{[^}]*max-height:min\(86dvh,760px\)/);
  assert.match(css, /\.simple-game-modal-body\{[^}]*overflow-y:auto/);
  assert.match(css, /\.howto-guide-copy p\{[^}]*var\(--fs-sm\)/);
  assert.match(css, /\.case-history-date\{[^}]*var\(--fs-2xs\)/);
  assert.match(css, /--fs-2xs:10px/, 'smallest type step stays readable');
  assert.doesNotMatch(css, /font(?:-size)?:[^;}]*\b[0-8](?:\.\d+)?px/, 'no sub-9px text');
});

test('v1.06 case history resolves item names/images and formats dates as dd.mm.yyyy', () => {
  const cases = read('public/js/cases.js');
  assert.match(cases, /getItemById\(Number\(drop\.id\)\)/);
  assert.match(cases, /drop\.name \|\| localItem\?\.name/);
  assert.match(cases, /String\(dateObject\.getDate\(\)\)\.padStart\(2,'0'\).*getMonth\(\)\+1.*getFullYear\(\)/s);
  assert.match(cases, /class=\"case-history-date\"/);
  assert.doesNotMatch(cases, /<em>\$\{escapeHtml\(time\)\}<\/em>/);
  assert.match(cases, /rewards\.slice\(0, 10\)/);
  assert.match(cases, /case-history-drop-art/);
  assert.match(cases, /case-history-image-fallback/);
});
