function centerPanelDefaultSize(leftVisible: boolean, rightVisible: boolean): number {
  if (leftVisible && rightVisible) return 71;
  if (leftVisible || rightVisible) return 85;
  return 100;
}

export {
  centerPanelDefaultSize,
};
