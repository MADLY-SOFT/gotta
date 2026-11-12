// js/audio.js — надёжное воспроизведение звуков с учётом ограничений мобильных браузеров.
let soundEnabled = true;
let audioInitialized = false;
const SOUND_FILES = {
    click: PATHS.audio + 'click.ogg',
    roulette: PATHS.audio + 'roulette.ogg',
    win: PATHS.audio + 'win.ogg',
    error: PATHS.audio + 'error.ogg',
    contractComplete: PATHS.audio + 'win.ogg',
    houseCollect: PATHS.audio + 'click.ogg',
    levelUp: PATHS.audio + 'win.ogg'
};
const sounds = Object.create(null);
const soundLoading = Object.create(null);
const lastSoundAt = Object.create(null);

function initSounds() { audioInitialized = true; }

// play() is invoked synchronously in the trusted input event. The former
// preload-then-play chain often lost Android's transient user activation.
function playSound(soundKey, volume = 0.7) {
    if (!soundEnabled || !SOUND_FILES[soundKey]) return;
    const now = performance.now();
    const minGap = soundKey === 'roulette' ? 55 : soundKey === 'click' ? 35 : 0;
    if (minGap && now - (lastSoundAt[soundKey] || 0) < minGap) return;
    lastSoundAt[soundKey] = now;
    try {
        let base = sounds[soundKey];
        if (!base) {
            base = new Audio(SOUND_FILES[soundKey]);
            base.preload = 'auto';
            sounds[soundKey] = base;
        }
        // Roulette ticks deliberately reuse one voice. Restarting the same short
        // sample keeps one tick per card without stacking audio copies on mobile.
        const audio = soundKey === 'roulette' ? base : (base.paused || base.ended ? base : base.cloneNode(true));
        audio.volume = Math.max(0, Math.min(1, Number(volume) || 0));
        audio.currentTime = 0;
        const result = audio.play();
        if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {}
}
function playClick() { playSound('click', 0.5); }
function playRouletteTick() { playSound('roulette', 0.14); }
function playWinSound() { playSound('win', 0.8); }
function playError() { playSound('error', 0.5); }
function playContractComplete() { playSound('contractComplete', 0.8); }
function playHouseCollect() { playSound('houseCollect', 0.6); }
function playLevelUp() { playSound('levelUp', 0.9); }
function toggleSound(enabled) {
    soundEnabled = !!enabled;
    settings.sound = soundEnabled;
    document.getElementById('sound-on')?.classList.toggle('active', soundEnabled);
    document.getElementById('sound-off')?.classList.toggle('active', !soundEnabled);
    if (!soundEnabled) stopAllSounds();
    saveSettings();
}
function stopAllSounds() {
    Object.values(sounds).forEach(sound => { try { sound.pause(); sound.currentTime = 0; } catch (_) {} });
}
document.addEventListener('DOMContentLoaded', initSounds, { once: true });
window.debugAudio = { sounds, initialized: () => audioInitialized, play: playSound, stopAllSounds };
console.log('[AUDIO] Модуль звуков загружен');
