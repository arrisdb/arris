// A ref segment found in free text, with the range it occupies.
interface FederationSegment {
  value: string;
  from: number;
  to: number;
}

export type {
  FederationSegment,
};
