// Rows per page in a table object's result grid. The table pages through the
// source cell's FULL cached result (fetched a page at a time from the backend),
// so this bounds only what is rendered/shipped at once, not the total.
const TABLE_PAGE_ROWS = 200;

export { TABLE_PAGE_ROWS };
