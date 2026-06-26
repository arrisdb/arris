// jsdom lacks Range geometry, which CodeMirror calls when it measures the editor
// (clientRectsFor → textRange(...).getClientRects). Stub them so EditorPane tests
// don't emit an unhandled "getClientRects is not a function" error.
const emptyRectList = {
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
} as unknown as DOMRectList;

const emptyRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
} as DOMRect;

Range.prototype.getClientRects = () => emptyRectList;
Range.prototype.getBoundingClientRect = () => emptyRect;
