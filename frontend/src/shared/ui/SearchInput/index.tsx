import type { Ref } from "react";
import { Icon } from "../Icon";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  size?: "sm" | "md";
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  ariaLabel?: string;
  testId?: string;
  rowTestId?: string;
};

function SearchInput({
  value,
  onChange,
  placeholder,
  size = "md",
  autoFocus,
  inputRef,
  ariaLabel,
  testId,
  rowTestId,
}: SearchInputProps) {
  return (
    <div className={`mdbc-search ${size}`} data-testid={rowTestId}>
      <span className="mdbc-search-icon">
        <Icon name="search" size={11} />
      </span>
      <input
        className="mdbc-search-input"
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      />
    </div>
  );
}

export { SearchInput };
export type { SearchInputProps };
