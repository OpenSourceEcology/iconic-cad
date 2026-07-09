import { getModuleBBox } from './geometry.js';

export function entityPlanRect(entity) {
  const bb = getModuleBBox(entity.mod, entity.dir);
  return {
    x_mm: entity.x_mm,
    y_mm: entity.y_mm,
    w_mm: bb.w,
    h_mm: bb.h,
    x0: entity.x_mm,
    y0: entity.y_mm,
    x1: entity.x_mm + bb.w,
    y1: entity.y_mm + bb.h,
  };
}

export function planBounds(entities) {
  if (!entities.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width_mm: 0, depth_mm: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const entity of entities) {
    const r = entityPlanRect(entity);
    minX = Math.min(minX, r.x0);
    minY = Math.min(minY, r.y0);
    maxX = Math.max(maxX, r.x1);
    maxY = Math.max(maxY, r.y1);
  }
  return { minX, minY, maxX, maxY, width_mm: maxX - minX, depth_mm: maxY - minY };
}
