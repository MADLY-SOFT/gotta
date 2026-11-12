(function(){
  function updateFullscreenButton(){
    const b=document.getElementById('fullscreen-btn');
    if(!b)return;
    const active=!!document.fullscreenElement;
    b.textContent=active?'⛶':'⛶';
    b.setAttribute('aria-label', active ? 'Выйти из полноэкранного режима' : 'Полный экран');
    b.title=b.getAttribute('aria-label');
  }
  async function toggleFullscreen(){
    try{
      if(document.fullscreenElement){ await document.exitFullscreen(); }
      else {
        const app=document.getElementById('app');
        if(app?.requestFullscreen) await app.requestFullscreen();
        else if(document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else throw new Error('Fullscreen API unavailable');
        try { if (screen.orientation?.lock) await screen.orientation.lock('portrait-primary'); } catch (_) { /* Browser or platform does not permit orientation locking. */ }
      }
    }catch(e){
      if(typeof showNotification==='function') showNotification('ПОЛНЫЙ ЭКРАН НЕДОСТУПЕН');
      console.warn('[FULLSCREEN]',e);
    }finally{ updateFullscreenButton(); }
  }
  function init(){
    const b=document.getElementById('fullscreen-btn');
    if(!b || b.dataset.bound)return;
    b.dataset.bound='1';
    b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();toggleFullscreen();});
    document.addEventListener('fullscreenchange',updateFullscreenButton);
    updateFullscreenButton();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
