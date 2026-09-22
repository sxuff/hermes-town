import {
  idleFrame, poseFrameAt, reactionFrame, sitFrame, walkFrame, workFrame, WALK_FRAME_COUNT,
} from '../art/characters';
import type { Resident } from '../sim/town';

/** One complete left/right stride in world pixels. Smaller runners take shorter steps. */
export const WALK_CYCLE_DISTANCE = 24;

export interface ResidentPose {
  frame: number;
  flipX: boolean;
  /** A hammer strike may create a spark exactly once on entering this pose. */
  striking: boolean;
}

/** Pure frame selection. Animation never supplies a lifecycle fact. */
export function residentPose(r: Resident, now: number): ResidentPose {
  if (r.reaction && now < r.reactionUntil) {
    return {
      frame: reactionFrame(r.reaction, r.facing, poseFrameAt('reaction', now - r.reactionAt, r.reaction)),
      flipX: false, striking: false,
    };
  }
  if (r.anim === 'walk') {
    const cycle = WALK_CYCLE_DISTANCE * (r.kind === 'runner' ? 0.8 : 1);
    const phase = Math.floor(r.walkDistance / cycle * WALK_FRAME_COUNT) % WALK_FRAME_COUNT;
    return { frame: walkFrame(r.facing, phase), flipX: false, striking: false };
  }
  if (r.anim === 'work') {
    const phase = poseFrameAt('work', Math.max(0, now - r.workStartedAt), r.style);
    return {
      frame: workFrame(r.style, r.facing, phase), flipX: r.facing === 'right',
      striking: r.style === 'hammer' && phase === 2,
    };
  }
  if (r.anim === 'sit') {
    const phase = poseFrameAt('work', r.clock, 'sit');
    return { frame: sitFrame(r.facing, phase), flipX: r.facing === 'right', striking: false };
  }
  return { frame: idleFrame(r.facing, poseFrameAt('idle', r.clock)), flipX: false, striking: false };
}
