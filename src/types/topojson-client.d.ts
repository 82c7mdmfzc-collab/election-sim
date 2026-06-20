// Minimal ambient typing for topojson-client (no @types package installed).
// We only use feature() to expand the us-atlas Topology into GeoJSON features.
declare module 'topojson-client' {
  export function feature(
    topology: unknown,
    object: unknown,
  ): {
    type: 'FeatureCollection';
    features: Array<{ id?: string | number } & Record<string, unknown>>;
  };
}
