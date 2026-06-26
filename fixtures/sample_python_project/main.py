"""Run the sample analysis from the command line.

    python main.py
"""

from sales import DAILY_SALES, best_day, summary


def main() -> None:
    print(f"Days recorded: {len(DAILY_SALES)}")
    print(f"Total units:   {sum(DAILY_SALES)}")
    print(f"Summary:       {summary(DAILY_SALES)}")
    day, units = best_day(DAILY_SALES)
    print(f"Best day:      #{day} with {units} units")


if __name__ == "__main__":
    main()
