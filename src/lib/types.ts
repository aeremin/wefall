export interface JumpInput {
  jumpNumber: number;
  /** ISO date, YYYY-MM-DD */
  date: string;
  /** HH:MM:SS (24h), or empty when unknown */
  time: string;
  dropzone: string;
  aircraft: string;
  jumpType: string;
  /** meters */
  exitAltitude: number | null;
  /** meters */
  deploymentAltitude: number | null;
  /** seconds */
  freefallTime: number | null;
  canopy: string;
  notes: string;
}

export interface Jump extends JumpInput {
  id: string;
  /** Lowercased emails of people who may view this jump via its direct link. */
  participants: string[];
}

export interface JumpSharing {
  participants: string[];
  /** Owner's display name, shown to participants. */
  ownerName: string;
}

/** A jump as seen through a share link, possibly owned by someone else. */
export interface SharedJump extends Jump {
  ownerUid: string;
  ownerName: string;
}

export const JUMP_TYPES = [
  'Belly',
  'Freefly',
  'Tracking',
  'Angle',
  'Wingsuit',
  'Hop & Pop',
  'CRW',
  'Canopy piloting',
  'Hybrid',
  'AFF',
  'Tandem',
  'Coaching',
  'Demo',
  'Other',
];
