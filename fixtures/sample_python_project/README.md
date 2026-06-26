# Sample Python project

A tiny, dependency-free project for testing Arris's Jupyter notebook support.

## Files

| File              | What it is                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `analysis.ipynb`  | Notebook with markdown, `stdout`, `execute_result`, error and raw cells (saved outputs included). |
| `sales.py`        | Small stdlib-only module (`summary`, `best_day`).                 |
| `main.py`         | CLI entry point that prints the same analysis.                    |
| `requirements.txt`| Only `ipykernel` is needed; everything else is the standard library. |

## Testing the notebook in Arris

1. Open this folder in Arris (File tree).
2. Double-click `analysis.ipynb` — it opens in the notebook editor with all
   cells and their **saved outputs** already rendered (no kernel needed yet).
3. Pick a Python 3 interpreter from the toolbar dropdown (or **Create venv**).
   Arris installs `ipykernel` automatically for a created venv.
4. **Run all**, or run a single cell with its ▶ button / `⌘↵`.
   - Cell 2 streams `stdout`.
   - Cells 4 and 6 return `execute_result` values.
   - Cell 8 raises `IndexError` to show traceback rendering.
5. Edit a cell, add/delete/reorder cells, toggle the markdown cell between
   rendered and edit (double-click the rendered text). The toolbar **Save**
   button (• marks unsaved edits) writes back to valid `.ipynb`.

## Running from the CLI

```
python main.py
```

Expected output:

```
Days recorded: 7
Total units:   953
Summary:       {'mean': 136.14, 'median': 130, 'stdev': 39.21}
Best day:      #6 with 210 units
```
