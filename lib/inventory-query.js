'use strict';

/** Build a compact, server-filtered inventory page from legacy instance records.
 * The stable legacy array index is returned temporarily for existing mutation
 * endpoints; it is never accepted as authority without server-side validation.
 */
function queryInventory(inventory, itemById, options = {}) {
  const pageSize = Math.max(1, Math.min(48, Math.floor(Number(options.pageSize) || 24)));
  const page = Math.max(0, Math.floor(Number(options.page) || 0));
  const tier = options.tier === 'all' || options.tier == null ? null : Number(options.tier);
  const query = String(options.query || '').trim().toLocaleLowerCase('ru-RU').slice(0, 48);
  const sort = ['date', 'rarityDown', 'rarityUp'].includes(options.sort) ? options.sort : 'date';
  const stacks = new Map();
  for (let index = 0; index < inventory.length; index++) {
    const item = inventory[index];
    if (!item) continue;
    const id = Number(item.id), itemTier = Number(item.tier);
    const definition = itemById.get(id);
    if (!definition || (tier && itemTier !== tier)) continue;
    if (query && !String(definition.name || '').toLocaleLowerCase('ru-RU').includes(query) && !String(id).includes(query)) continue;
    const key = `${id}:${itemTier}`;
    let stack = stacks.get(key);
    if (!stack) {
      stack = { id, tier: itemTier, count: 0, indices: [], lastIndex: index, name: String(definition.name || '') };
      stacks.set(key, stack);
    }
    stack.count++;
    stack.indices.push(index);
    stack.lastIndex = index;
  }
  const rows = [...stacks.values()];
  rows.sort((a, b) => {
    if (sort === 'rarityDown') return b.tier - a.tier || a.name.localeCompare(b.name, 'ru');
    if (sort === 'rarityUp') return a.tier - b.tier || a.name.localeCompare(b.name, 'ru');
    return b.lastIndex - a.lastIndex;
  });
  const totalStacks = rows.length;
  const totalItems = rows.reduce((sum, row) => sum + row.count, 0);
  const totalPages = Math.max(1, Math.ceil(totalStacks / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const items = rows.slice(safePage * pageSize, (safePage + 1) * pageSize).map(({name, ...row}) => row);
  return { items, page: safePage, pageSize, totalPages, totalStacks, totalItems };
}

module.exports = { queryInventory };
