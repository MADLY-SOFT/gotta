function syncOverlayTheme(modal){const app=document.getElementById('app');if(!modal||!app)return;for(const key of ['skin','corners']){const value=app.getAttribute('data-'+key);if(value)modal.setAttribute('data-'+key,value);else modal.removeAttribute('data-'+key);}}
function openPromoModal(){
    const modal=document.getElementById('promo-modal');
    if(!modal)return;
    // Keep the input outside transformed/scrolling app layers; Android IME can otherwise lose its input connection.
    if(modal.parentElement!==document.body)document.body.appendChild(modal);
    syncOverlayTheme(modal);
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
    const input=document.getElementById('promo-input');
    const result=document.getElementById('promo-result');
    if(input){
        input.disabled=false;
        input.readOnly=false;
        input.value='';
        input.removeAttribute('readonly');
        input.removeAttribute('disabled');
    }
    if(result)result.textContent='';
    // Do not force-focus on open: on Android WebViews the virtual keyboard can
    // appear while the editable field loses its trusted user focus. Let the
    // player's tap establish focus and the keyboard gesture naturally.
}
function closePromoModal(){
    const modal=document.getElementById('promo-modal');
    if(modal){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');}
    const result=document.getElementById('promo-result');
    if(result)result.textContent='';
    const input=document.getElementById('promo-input');
    if(input){input.value=''; if(document.activeElement===input)input.blur();}
}
function closePromoRewardModal(){const modal=document.getElementById('promo-reward-modal');if(modal){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');}}
function openPromoRewardModal(reward){
    const modal=document.getElementById('promo-reward-modal');
    const list=document.getElementById('promo-reward-list');
    const code=document.getElementById('promo-reward-code');
    if(!modal||!list)return;
    syncOverlayTheme(modal);
    if(code)code.textContent=reward.code||'';
    const rows=[];
    if(reward.coins)rows.push(`<div class="promo-reward-row"><img src="${PATHS.coin}" alt=""><b>+${formatNumber(reward.coins)}</b><span>МОНЕТ</span></div>`);
    if(reward.gems)rows.push(`<div class="promo-reward-row"><img src="${PATHS.gem}" alt=""><b>+${reward.gems}</b><span>ГЕМОВ</span></div>`);
    if(reward.shards)rows.push(`<div class="promo-reward-row"><img src="${PATHS.shards}" alt=""><b>+${formatNumber(reward.shards)}</b><span>ОСКОЛКОВ</span></div>`);
    (reward.items||[]).forEach(item=>{const data=getItemById(item.itemId),color=tierColors[item.tier]||'#fff';if(data)rows.push(`<button class="promo-reward-item" style="border-color:${color}" onclick="playClick();showItemInfo(${item.itemId},false)">${itemSprite(data.image, 'promo-item-atlas')}<span><b>${escapeHtml(data.name)}</b><small style="color:${color}">${tierNames[item.tier]}</small></span></button>`);});
    (reward.artifacts||[]).forEach(entry=>{const a=(ARTIFACTS_DATABASE.artifacts||[]).find(x=>Number(x.id)===Number(entry.artifactId));if(a)rows.push(`<div class="promo-reward-item promo-reward-artifact"><span class="promo-reward-artifact-image">${artifactSprite(a.id)}</span><span><b>${escapeHtml(a.name)}</b><small>АРТЕФАКТ ×${Number(entry.count)||0}</small></span></div>`);});
    list.innerHTML=rows.join('')||'<div class="promo-reward-empty">НАГРАДА ПОЛУЧЕНА</div>';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
}
let promoSubmitting = false;
async function activatePromo(){
    if(promoSubmitting)return;
    const input=document.getElementById('promo-input');
    const result=document.getElementById('promo-result');
    const code=String(input?.value||'').trim().toUpperCase();
    if(!code){showNotification('ВВЕДИТЕ ПРОМОКОД');return;}
    promoSubmitting=true;
    try{
        const data=await gameAction('promo',{code});
        const reward=data.result||{};
        if(result)result.innerHTML='<div class="promo-success">ПРОМОКОД АКТИВИРОВАН</div>';
        updateBalance();playWinSound();closePromoModal();
        setTimeout(()=>openPromoRewardModal(reward),120);
    }catch(error){if(result)result.innerHTML=`<div class="promo-error">${escapeHtml(error.message||'Ошибка')}</div>`;if(input){input.disabled=false;input.readOnly=false;}playError();}finally{promoSubmitting=false;}
}
