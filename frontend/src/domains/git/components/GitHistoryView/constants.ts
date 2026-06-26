// Fetch the next page once the scroll position is within this many pixels of the
// bottom, so more commits arrive before the user hits the very end.
const LOAD_MORE_THRESHOLD = 120;

const ROW_HEIGHT = 28;
const LANE_WIDTH = 16;
const DOT_RADIUS = 4;

// Commit detail panel width: default plus drag-resize clamp bounds.
const DETAIL_DEFAULT_WIDTH = 460;
const DETAIL_MIN_WIDTH = 320;
const DETAIL_MAX_WIDTH = 760;

export {
  LOAD_MORE_THRESHOLD,
  ROW_HEIGHT,
  LANE_WIDTH,
  DOT_RADIUS,
  DETAIL_DEFAULT_WIDTH,
  DETAIL_MIN_WIDTH,
  DETAIL_MAX_WIDTH,
};
