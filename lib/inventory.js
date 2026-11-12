'use strict';

/**
 * Canonical inventory sanitizer. Existing v85/v86 items are instance records
 * `{id,tier}`; keep their order and duplicates so old index-based actions remain
 * compatible. Never silently slice a player's inventory.
 */
function sanitizeInventory(list, itemById, maxItems = 100000) {
  if (!Array.isArray(list)) return [];
  if (list.length > maxItems) {
    const error = new Error(`Инвентарь содержит ${list.length} предметов; превышен безопасный предел ${maxItems}. Данные не обрезаны — требуется отдельная миграция.`);
    error.code = 'INVENTORY_LIMIT_EXCEEDED';
    throw error;
  }
  const result = [];
  for (const value of list) {
    const id = Math.floor(Number(value?.id));
    const item = itemById.get(id);
    const tier = Math.max(1, Math.min(6, Math.floor(Number(value?.tier) || 1)));
    if (!item || !item.tiers?.[String(tier)]) continue;
    result.push({ id: item.id, tier });
  }
  return result;
}

module.exports = { sanitizeInventory };
