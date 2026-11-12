// Single lossless atlas. Legacy avatar IDs outside the new collection display avatar 1.
function avatarMarkup(source, className = '', attributes = '') {
    const match = /^png\/avatars\/avatar_(\d+)\.png$/.exec(String(source || ''));
    const requested = match ? Number(match[1]) : 1;
    const id = requested >= 1 && requested <= 106 ? requested : 1;
    const col = (id - 1) % 16;
    const row = Math.floor((id - 1) / 16);
    return `<span class="avatar-atlas ${className}" role="img" aria-label="Аватар" ${attributes} style="background-position:${col * 100 / 15}% ${row * 100 / 6}%"></span>`;
}
