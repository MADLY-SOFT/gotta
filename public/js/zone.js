// js/zone.js — рейтинг и задания
let zoneData=null, questData=null, questTab='daily', questModalRequest=0, questAchievementData=null;
let questTimerInterval=null, questBoundaryRefresh=false;
const rankTypes={rating:{title:'РЕЙТИНГ',unit:'ОЧКОВ',desc:'Общий рейтинг за игровые действия'},cases:{title:'ОТКРЫТЫЕ КЕЙСЫ',unit:'КЕЙСОВ',desc:'Кто открыл больше всего кейсов'},level:{title:'УРОВЕНЬ',unit:'УРОВЕНЬ',desc:'Самые опытные игроки'},coins:{title:'ЗАРАБОТАННЫЕ МОНЕТЫ',unit:'МОНЕТ',desc:'Монеты, заработанные за всё время'}};
let rankType=null,rankRequest=0;
async function loadZoneData(type='rating'){const d=await apiRequest('/api/leaderboard?limit=20&type='+encodeURIComponent(type));zoneData=d;return d;}
function openZoneCenter(){const m=document.getElementById('zone-center-modal');if(!m)return;m.classList.add('show');rankType=null;renderRankPicker();}
function closeZoneCenter(){rankRequest++;document.getElementById('zone-center-modal')?.classList.remove('show');}
function renderRankPicker(){const b=document.getElementById('zone-center-body');if(!b)return;rankType=null;document.getElementById('zone-rating-subtitle').textContent='ВЫБЕРИ, В ЧЁМ БУДЕШЬ ПЕРВЫМ';b.innerHTML=`<div class="rank-intro"><span>АРХИВ ВЫЖИВШИХ / ТАБЛИЦЫ ЛИДЕРОВ</span><b>ЗАЛ СЛАВЫ</b><p>Четыре пути к вершине. Все результаты берутся из сохранённых сервером достижений игроков.</p></div><div class="rank-menu">${Object.entries(rankTypes).map(([id,t],i)=>`<button class="rank-menu-card rank-kind-${id}" onclick="playClick();selectRankType('${id}')"><span class="rank-menu-index">0${i+1}</span><span class="rank-menu-copy"><b>${t.title}</b><small>${t.desc}</small></span><span class="rank-menu-arrow">›</span></button>`).join('')}</div>`;}
async function selectRankType(type){if(!rankTypes[type])return;rankType=type;const n=++rankRequest;const b=document.getElementById('zone-center-body');document.getElementById('zone-rating-subtitle').textContent=rankTypes[type].desc;b.innerHTML='<div class="zone-loading">ЗАГРУЖАЕМ ТАБЛИЦУ...</div>';try{const d=await loadZoneData(type);if(n!==rankRequest||rankType!==type)return;renderZoneRank(d);}catch(e){if(n===rankRequest)b.innerHTML=`<div class="zone-loading">${escapeHtml(e.message||'Ошибка загрузки')}</div><button class="rank-retry" onclick="playClick();selectRankType('${type}')">ПОВТОРИТЬ</button>`;}}
async function loadQuestData(){const d=await gameAction('questInfo');questData=d.result;startQuestResetTimer();updateRewardIndicators();return questData;}
function openQuestsModal(initialTab='daily'){const m=document.getElementById('quests-modal');if(!m)return;if(['achievements','daily','weekly'].includes(initialTab))questTab=initialTab;syncQuestTabButtons();const requestId=++questModalRequest;m.classList.add('show');const body=document.getElementById('quests-body');if(body)body.innerHTML='<div class="quest-loading" role="status">ЗАГРУЖАЕМ ПРОГРЕСС…</div>';loadQuestData().then(()=>{if(requestId===questModalRequest&&m.classList.contains('show'))renderQuestModal();}).catch(e=>{if(requestId===questModalRequest&&m.classList.contains('show')&&body)body.innerHTML=`<div class="quest-loading quest-error" role="alert">${escapeHtml(e.message||'Не удалось загрузить задания')}<button type="button" onclick="playClick();openQuestsModal('${questTab}')">ПОВТОРИТЬ</button></div>`;});}
function closeQuestsModal(){questModalRequest++;document.getElementById('quests-modal')?.classList.remove('show');}
function formatQuestCountdown(ms){let sec=Math.max(0,Math.floor(ms/1000));const d=Math.floor(sec/86400);sec%=86400;const h=Math.floor(sec/3600);sec%=3600;const m=Math.floor(sec/60);const s=sec%60;return d>0?`${d}д ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
function questResetLabel(){if(!questData?.periods)return '';const key=questTab==='weekly'?'weeklyResetAt':'dailyResetAt';const left=Number(questData.periods[key]||0)-Date.now();return left<=0?'00:00:00':formatQuestCountdown(left);}
function startQuestResetTimer(){if(questTimerInterval)clearInterval(questTimerInterval);questTimerInterval=setInterval(async()=>{if(!questData?.periods)return;const key=questTab==='weekly'?'weeklyResetAt':'dailyResetAt';const left=Number(questData.periods[key]||0)-Date.now();const el=document.getElementById('quest-reset-timer');if(el)el.textContent=left<=0?'00:00:00':formatQuestCountdown(left);if(left<=0&&!questBoundaryRefresh){questBoundaryRefresh=true;try{await loadQuestData();renderQuestModal();}catch(e){}finally{questBoundaryRefresh=false;}}},1000);}
function questRewardHTML(q){
 const r=q.reward||{};const parts=[];
 if(Number(q.rating)>0)parts.push(`<span class="quest-reward-rating">+${Number(q.rating).toLocaleString('ru-RU')} <small>РЕЙТ.</small></span>`);
 if(Number(r.coins)>0)parts.push(`<span class="quest-reward-resource"><img src="${PATHS.coin}" alt="">+${Number(r.coins).toLocaleString('ru-RU')}</span>`);
 if(Number(r.gems)>0)parts.push(`<span class="quest-reward-resource"><img src="${PATHS.gem}" alt="">+${Number(r.gems).toLocaleString('ru-RU')}</span>`);
 if(Number(r.shards)>0)parts.push(`<span class="quest-reward-resource"><img src="png/ui/shards.png" alt="">+${Number(r.shards).toLocaleString('ru-RU')}</span>`);
 return parts.join('');
}
function questCard(q,period,progress,claimed){
 const value=Math.max(0,Number(progress[q.key]||0)),target=Math.max(1,Number(q.target)||1),done=value>=target,got=claimed.includes(q.id),pct=Math.max(0,Math.min(100,value/target*100));
 const shown=Math.floor(Math.min(value,target)).toLocaleString('ru-RU'),targetText=target.toLocaleString('ru-RU');
 const stateClass=got?'claimed':done?'claimable':'in-progress';
 const id=String(q.id).replace(/[^a-zA-Z0-9_]/g,'');
 return `<article class="progress-achievement quest-achievement-card ${stateClass} quest-${period}">
   <div class="achievement-card-heading"><div><b>${escapeHtml(q.label||'Задание')}</b></div></div>
   <div class="progress-achievement-bar quest-progress-bar" role="progressbar" aria-label="Прогресс задания" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(value,target)}"><i style="width:${pct}%"></i><span>${shown} / ${targetText}</span></div>
   <div class="progress-achievement-reward quest-card-rewards">${questRewardHTML(q)}</div>
   <button type="button" class="progress-achievement-claim quest-claim-button" ${!done||got?'disabled':''} onclick="playClick();claimZoneQuest('${period}','${id}',this)">${got?'ПОЛУЧЕНО':done?'ЗАБРАТЬ':'В ПРОЦЕССЕ'}</button>
 </article>`;
}
function syncQuestTabButtons(){
 const tabs={achievements:'quest-tab-achievements',daily:'quest-tab-daily',weekly:'quest-tab-weekly'};
 Object.entries(tabs).forEach(([key,id])=>{const button=document.getElementById(id);if(!button)return;const active=key===questTab;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
}
function switchQuestTab(tab){if(!['achievements','daily','weekly'].includes(tab))return;questTab=tab;syncQuestTabButtons();renderQuestModal();
}
function renderQuestList(){
 const b=document.getElementById('quests-body');if(!b||!questData)return;
 const weekly=questTab==='weekly',period=weekly?'weekly':'daily',defs=questData.quests?.[period]||[],progress=weekly?questData.weeklyProgress:questData.dailyProgress,claimed=weekly?questData.weeklyClaimed:questData.dailyClaimed;
 const safeClaimed=Array.isArray(claimed)?claimed:[];
 const completed=defs.filter(q=>Number(progress?.[q.key]||0)>=Number(q.target)).length;
 const ordered=defs.map((q,index)=>({q,index,claimed:safeClaimed.includes(q.id),done:Number(progress?.[q.key]||0)>=Number(q.target)}))
   .sort((a,b)=>Number(a.claimed)-Number(b.claimed)||Number(b.done)-Number(a.done)||a.index-b.index)
   .map(x=>x.q);
 b.innerHTML=`<div class="quest-period-head"><span class="quest-period-count">ВЫПОЛНЕНО ${completed}/${defs.length}</span><b id="quest-reset-timer">${questResetLabel()}</b></div><div class="quest-cards-grid">${ordered.map(q=>questCard(q,period,progress||{},safeClaimed)).join('')||'<div class="quest-loading">СЕЙЧАС НЕТ ДОСТУПНЫХ ЗАДАНИЙ</div>'}</div>`;
}
async function renderQuestAchievements(){
 const b=document.getElementById('quests-body');if(!b)return;const requestId=questModalRequest;
 b.innerHTML='<div class="quest-loading" role="status">ЗАГРУЖАЕМ ДОСТИЖЕНИЯ…</div>';
 try{const data=await apiRequest('/api/progression',{timeoutMs:15000});if(requestId!==questModalRequest||!document.getElementById('quests-modal')?.classList.contains('show')||questTab!=='achievements')return;questAchievementData=data;b.innerHTML=typeof renderProgressionCards==='function'?renderProgressionCards(data):'<div class="quest-loading">НЕ УДАЛОСЬ ОТОБРАЗИТЬ ДОСТИЖЕНИЯ</div>';}
 catch(e){if(requestId===questModalRequest)b.innerHTML=`<div class="quest-loading quest-error" role="alert">${escapeHtml(e.message||'Не удалось загрузить достижения')}<button type="button" onclick="playClick();renderQuestModal()">ПОВТОРИТЬ</button></div>`;}
}
function renderQuestModal(){if(!questData)return;
 const subtitle=document.getElementById('quests-subtitle');
 if(questTab==='achievements'){if(subtitle)subtitle.textContent='ДОЛГОСРОЧНЫЕ ЦЕЛИ И НАГРАДЫ';renderQuestAchievements();return;}
 if(subtitle)subtitle.textContent='ВЫПОЛНЯЙ ЗАДАНИЯ И СОБИРАЙ ОСКОЛКИ';renderQuestList();
}
async function claimZoneQuest(period,id,button=null){if(button?.disabled)return;if(button){button.disabled=true;button.textContent='ПОЛУЧАЕМ…';}try{const d=await gameAction('claimQuest',{period,id});const rr=d.result?.reward||{};const extras=[];if(rr.coins)extras.push(`+${Number(rr.coins).toLocaleString('ru-RU')} МОН.`);if(rr.gems)extras.push(`+${Number(rr.gems)} ГЕМ.`);if(rr.shards)extras.push(`+${Number(rr.shards)} ОСК.`);showNotification(`+${d.result.rating} РЕЙТ. ${extras.join(' · ')}`);await loadQuestData();renderQuestModal();renderProfile();updateRewardIndicators();}catch(e){showNotification(e.message||'НЕ УДАЛОСЬ ПОЛУЧИТЬ НАГРАДУ');if(button){button.disabled=false;button.textContent='ЗАБРАТЬ';}}}
function renderZoneRank(data=zoneData){const b=document.getElementById('zone-center-body');if(!b||!data)return;const t=rankTypes[rankType]||rankTypes.rating,players=data.players||[],me=data.me;const avatar=id=>getAvatarById(Number(id))?.image||'png/avatars/avatar_1.png';const n=x=>formatNumberFull(Number(x?.score)||0);const av=(x,cls)=>`<button type="button" class="rank-preview-trigger" aria-label="Профиль игрока" onclick="playClick();openRankPreview(${Number(x.id)})">${avatarMarkup(avatar(x.avatar),'rank-avatar '+cls)}</button>`;const name=x=>escapeHtml(x.username||'Игрок');const top=players.slice(0,3);let html=`<button class="rank-back" onclick="playClick();renderRankPicker()">← ВСЕ РЕЙТИНГИ</button><div class="rank-podium">`;[1,0,2].forEach(i=>{const x=top[i];if(!x){html+='<div class="rank-podium-slot empty"></div>';return;}html+=`<div class="rank-podium-slot rank-place-${i+1}"><div class="rank-medallion">${i===0?'Ⅰ':i===1?'Ⅱ':'Ⅲ'}</div>${av(x,'rank-podium-avatar')}<b title="${name(x)}">${name(x)}</b><strong>${n(x)}</strong><small>${t.unit}</small><div class="rank-plinth">${x.rank}</div></div>`;});html+='</div><div class="rank-list-caption">ТОП УЧАСТНИКОВ <span>ПОКАЗАНО '+players.length+'</span></div><div class="rank-rows">';html+=players.slice(3).map(x=>`<div class="rank-row ${me&&x.rank===me.rank?'is-me':''}"><span class="rank-number">${String(x.rank).padStart(2,'0')}</span>${av(x,'rank-row-avatar')}<div class="rank-person"><b>${name(x)}${me&&x.rank===me.rank?' <i>ВЫ</i>':''}</b><small>ID: ${escapeHtml(String(x.id))}</small></div><div class="rank-value"><strong>${n(x)}</strong><small>${t.unit}</small></div></div>`).join('');html+='</div>';if(me)html+=`<div class="rank-me"><span class="rank-me-title">ВАШ РЕЗУЛЬТАТ</span><div class="rank-me-inner"><strong>#${me.rank}</strong>${av(me,'rank-me-avatar')}<div><b>${name(me)}</b><small>ИЗ ${data.total||0} ИГРОКОВ</small></div><em>${n(me)}<small>${t.unit}</small></em></div></div>`;b.innerHTML=html;}

// Indicators depend on actual claimable server progress, never on unclaimed guesses.
let rewardIndicatorLastCheck=0;
function updateRewardIndicators(){
 const daily=document.getElementById('daily-rewards-btn');
 const quest=document.getElementById('quests-other-btn');
 const dailyReady=typeof GameState!=='undefined' && typeof getDailyRewardsList==='function' && getDailyRewardsList().length>0 && !dailyRewardClaimedToday();
 if(daily){daily.classList.toggle('has-reward',!!dailyReady);daily.setAttribute('aria-label','Ежедневные награды'+(dailyReady?' — доступна награда':''));}
 let available=false;
 if(questData?.quests){for(const period of ['daily','weekly']){
  const progress=questData[period+'Progress']||{}, claimed=questData[period+'Claimed']||[];
  if((questData.quests[period]||[]).some(q=>Number(progress[q.key]||0)>=Number(q.target)&&!claimed.includes(q.id)))available=true;
 }}
 if(quest){quest.classList.toggle('has-reward',available);quest.setAttribute('aria-label','Задания'+(available?' — есть награда':''));}
}
async function refreshRewardIndicators(){
 updateRewardIndicators();
 if(Date.now()-rewardIndicatorLastCheck<15000)return;
 rewardIndicatorLastCheck=Date.now();
 try{await loadQuestData();}catch(e){/* Keep last verified status on transient network errors. */}
}

// Public read-only mini profile; close on backdrop tap, not when interacting with card.
async function openRankPreview(id){
 const overlay=document.getElementById('rank-preview-modal');if(!overlay)return;
 overlay.classList.add('show');overlay.setAttribute('aria-hidden','false');
 document.getElementById('rank-preview-body').innerHTML='<p class="rank-preview-loading">ЗАГРУЗКА...</p>';
 try{
  const result=await apiRequest('/api/player/preview?id='+encodeURIComponent(id));
  if(!overlay.classList.contains('show'))return;
  const x=result.player,source=getAvatarById(Number(x.avatar))?.image||'png/avatars/avatar_1.png';
  document.getElementById('rank-preview-body').innerHTML=`<div class="rank-preview-cover"><span>ДОСЬЕ ВЫЖИВШЕГО</span><small>ZOMBIX / PLAYER</small></div><div class="rank-preview-person">${avatarMarkup(source,'rank-preview-avatar')}<div><b>${escapeHtml(x.username)}</b><span>УРОВЕНЬ ${Number(x.level)||1}</span></div></div><div class="rank-preview-facts"><div><small>ID ИГРОКА</small><b>#${x.id}</b></div><div><small>В ИГРЕ</small><b>${x.days} ДН.</b></div></div>${x.isMe?'<p class="rank-preview-note">ЭТО ТВОЙ ПРОФИЛЬ</p>':x.allowMessages===false?'<p class="rank-preview-note rank-preview-blocked">ЭТОМУ ИГРОКУ НЕЛЬЗЯ НАПИСАТЬ</p>':`<button type="button" class="rank-preview-write" onclick="openRankMessage(${x.id})">НАПИСАТЬ · <img src="png/ui/gem.png" alt=""> 1</button>`}`;
 }catch(e){document.getElementById('rank-preview-body').innerHTML=`<p class="rank-preview-loading">${escapeHtml(e.message||'Ошибка загрузки')}</p>`;}
}
function closeRankPreview(){const el=document.getElementById('rank-preview-modal');el?.classList.remove('show');el?.setAttribute('aria-hidden','true');}
function openRankMessage(id){const body=document.getElementById('rank-preview-body');if(!body)return;body.innerHTML=`<div class="rank-compose"><b>ЛИЧНОЕ СООБЩЕНИЕ · #${id}</b><small>1 ГЕМ ЗА ОТПРАВКУ · ДО 300 СИМВОЛОВ</small><textarea id="rank-dm-text" maxlength="300" rows="5" placeholder="ТЕКСТ СООБЩЕНИЯ" oninput="this.value=this.value.replace(/[^A-Za-zА-Яа-яЁё., ]/g,'');document.getElementById('rank-dm-length').textContent=this.value.length+'/300'"></textarea><small id="rank-dm-length">0/300</small><button type="button" id="rank-dm-send" onclick="sendRankMessage(${id})">ОТПРАВИТЬ · 1 <img src="png/ui/gem.png" alt="гем"></button><button type="button" onclick="openRankPreview(${id})">← НАЗАД</button></div>`;body.querySelector('textarea')?.focus();}
async function sendRankMessage(id){const input=document.getElementById('rank-dm-text'),btn=document.getElementById('rank-dm-send');if(!input||!btn||btn.disabled)return;const message=input.value.trim();if(!message||message.length>300||!/^[A-Za-zА-Яа-яЁё., ]+$/u.test(message)){showNotification('РАЗРЕШЕНЫ ТОЛЬКО БУКВЫ, ПРОБЕЛЫ, ЗАПЯТЫЕ И ТОЧКИ');return;}btn.disabled=true;try{const d=await idempotentApiAction('mail_send','/api/mail/send',{playerId:id,message});applyServerState(d.state);updateBalance();showNotification('СООБЩЕНИЕ ОТПРАВЛЕНО · −1 ГЕМ');closeRankPreview();}catch(e){showNotification(e.message||'ОШИБКА ОТПРАВКИ');btn.disabled=false;}}
