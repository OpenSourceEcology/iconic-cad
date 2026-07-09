export function placedWallEntity({
  mod,
  dir,
  x_mm,
  y_mm,
  id = null,
  system = mod?.system,
  level = 'L1',
  layer = 'structural',
  connections = [],
  props = {},
}) {
  return {
    kind: mod?.interior ? 'iwall' : 'wall',
    mod,
    system,
    dir,
    x_mm,
    y_mm,
    level,
    layer,
    ...(id ? { id } : {}),
    connections,
    props,
  };
}
