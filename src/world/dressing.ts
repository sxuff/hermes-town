import type { PropKind } from './map';

/** Placement anchors retained from the map, independent of rendered sprite size.
 * Props absent from this catalog are removed before building collision data. */
export const PROP_ANCHORS: Partial<Record<PropKind, readonly [number, number]>> = {
  tree: [32, 40], lamp: [10, 30], bench: [20, 12], porchBench: [16, 10],
  crate: [12, 12], barrel: [10, 13], anvil: [16, 12], workbench: [22, 14],
  lectern: [14, 16], telescope: [16, 20], postbox: [10, 16], desk: [20, 12], stall: [20, 12],
  bush: [18, 12], rock: [14, 10], signpost: [14, 20], cart: [28, 18],
  grave0: [12, 14], grave1: [12, 14], grave2: [12, 14], noticeBoard: [22, 24],
  banner: [12, 30], flowerBox: [18, 10], planter: [14, 16],
  fountain: [36, 30], chapel: [40, 46], marketStall0: [30, 28], marketStall1: [30, 28],
  hedge: [16, 12], dock: [20, 14],
};

export const hasWorldSprite = (kind: PropKind): boolean => kind in PROP_ANCHORS;

export const TREE_ANCHORS: readonly (readonly [number, number])[] = [[32, 40], [32, 40], [48, 52], [24, 52], [16, 22], [32, 40]];
