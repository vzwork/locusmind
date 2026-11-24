import { useLayoutEffect, useRef, useState } from "react";

type Props = {
  name: string;
  label: string;
  selectBaseName: boolean;
  // Returns an error message, or null once the rename has been applied.
  onCommit: (value: string, viaKeyboard: boolean) => string | null;
  onCancel: (viaKeyboard: boolean) => void;
};

// Inline rename field shown in place of a row label, like in VS Code:
// Enter applies, Escape cancels, and losing focus applies a valid name.
export function RenameInput({ name, label, selectBaseName, onCommit, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const extensionStart = name.lastIndexOf(".");
    input.setSelectionRange(0, selectBaseName && extensionStart > 0 ? extensionStart : name.length);
    // The selection is only set when the field first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(viaKeyboard: boolean) {
    if (settled.current) return;
    if (value.trim() === name) {
      settled.current = true;
      onCancel(viaKeyboard);
      return;
    }
    const message = onCommit(value, viaKeyboard);
    if (message === null) {
      settled.current = true;
    } else if (viaKeyboard) {
      setError(message);
    } else {
      settled.current = true;
      onCancel(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      settled.current = true;
      onCancel(true);
    }
  }

  return (
    <span className="explorer-rename">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
        }}
        onBlur={() => commit(false)}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
        aria-label={label}
        aria-invalid={Boolean(error)}
        autoComplete="off"
        spellCheck={false}
      />
      {error && (
        <span className="explorer-rename-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
