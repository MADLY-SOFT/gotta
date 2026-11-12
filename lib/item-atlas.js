'use strict';
const fs = require('node:fs');
const path = require('node:path');

function itemIdFromLegacySource(source) {
  const raw = String(source ?? '').trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = /(?:^|\/)(?:items_|item[_-]?)(\d+)(?:\.png)?(?:[?#].*)?$/.exec(raw);
  return match ? Number(match[1]) : 0;
}

function readPngDimensions(filePath) {
  const header = Buffer.alloc(24);
  const fd = fs.openSync(filePath, 'r');
  try {
    const bytes = fs.readSync(fd, header, 0, 24, 0);
    if (bytes !== 24 || !header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || header.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('файл атласа не является корректным PNG');
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

function validateItemAtlas(projectRoot, items, suppliedMetadata = null) {
  const publicDir = path.join(projectRoot, 'public');
  const metadata = suppliedMetadata || JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'items-atlas.json'), 'utf8'));
  const relativeFile = String(metadata?.file || '');
  if (!relativeFile || path.isAbsolute(relativeFile)) throw new Error('не указан относительный путь к атласу предметов');
  const atlasPath = path.resolve(publicDir, relativeFile);
  if (atlasPath !== publicDir && !atlasPath.startsWith(publicDir + path.sep)) throw new Error('путь атласа выходит за пределы public');
  if (!fs.existsSync(atlasPath) || !fs.statSync(atlasPath).isFile()) throw new Error(`не найден атлас предметов: ${relativeFile}`);

  const [cellWidth, cellHeight] = Array.isArray(metadata.cell) ? metadata.cell.map(Number) : [];
  const columns = Number(metadata.columns), rows = Number(metadata.rows), count = Number(metadata.items);
  if (![cellWidth, cellHeight, columns, rows, count].every(Number.isInteger) || cellWidth < 1 || cellHeight < 1 || columns < 1 || rows < 1 || count < 1 || count > columns * rows) {
    throw new Error('некорректные размеры или количество ячеек в items-atlas.json');
  }
  if (!Array.isArray(items) || items.length !== count) throw new Error(`в items.json ${items?.length ?? 0} предметов, а атлас рассчитан на ${count}`);

  const seen = new Set();
  for (const item of items) {
    const id = Number(item?.id);
    const imageId = itemIdFromLegacySource(item?.image);
    if (!Number.isInteger(id) || id < 1 || id > count || seen.has(id)) throw new Error(`некорректный или повторный ID предмета: ${item?.id}`);
    if (imageId !== id) throw new Error(`предмет ${id}: путь image должен указывать на ячейку ${id}, получено «${item?.image ?? ''}»`);
    seen.add(id);
  }
  if (seen.size !== count) throw new Error('в items.json отсутствуют ID предметов для атласа');

  const dimensions = readPngDimensions(atlasPath);
  const expectedWidth = cellWidth * columns, expectedHeight = cellHeight * rows;
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    throw new Error(`размер атласа ${dimensions.width}×${dimensions.height}, ожидался ${expectedWidth}×${expectedHeight}`);
  }
  return { metadata, atlasPath, ...dimensions };
}

module.exports = { itemIdFromLegacySource, readPngDimensions, validateItemAtlas };
