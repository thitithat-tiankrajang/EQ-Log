import { Children, type MouseEventHandler, type ReactNode } from "react";
import { CheckboxControl } from "../../ui/CheckboxControl";
import { EmptyState } from "../../ui/EmptyState";

export function GameTable({
  label,
  children,
  emptyMessage,
  emptyAction,
  selectable = false,
  allSelected = false,
  someSelected = false,
  onSelectAll,
  primaryHeading = "Game",
  selectAllLabel,
  className,
  toolbar,
}: {
  label: string;
  children: ReactNode;
  emptyMessage: string;
  emptyAction?: ReactNode;
  selectable?: boolean;
  allSelected?: boolean;
  someSelected?: boolean;
  onSelectAll?: (selected: boolean) => void;
  primaryHeading?: string;
  selectAllLabel?: string;
  className?: string;
  toolbar?: ReactNode;
}) {
  const rowCount = Children.count(children);

  // A header row over a single "nothing here" cell reads as a broken table to
  // both eyes and screen readers, so an empty list drops the table entirely.
  if (rowCount === 0) {
    return (
      <div className="eq-game-table-wrap">
        {toolbar && <div className="eq-game-table-toolbar">{toolbar}</div>}
        <EmptyState description={emptyMessage} action={emptyAction} compact />
      </div>
    );
  }

  return (
    <div className="eq-game-table-wrap">
      {toolbar && <div className="eq-game-table-toolbar">{toolbar}</div>}
      <table className={`eq-game-table${className ? ` ${className}` : ""}`} aria-label={label}>
        <thead>
          <tr>
            {selectable && (
              <th className="eq-game-table-select" scope="col">
                <SelectAllCheckbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  label={selectAllLabel ?? `Select all games in ${label}`}
                  onChange={(selected) => onSelectAll?.(selected)}
                />
              </th>
            )}
            <th scope="col">{primaryHeading}</th>
            <th className="eq-game-table-creator-heading" scope="col">
              Created by
            </th>
            <th className="eq-game-table-actions-heading" scope="col">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function GameTableRow({
  primary,
  secondary,
  creator,
  actions,
  selected,
  selectionLabel,
  onSelectedChange,
  contentHref,
  contentLabel,
  onContentClick,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  creator: ReactNode;
  actions: ReactNode;
  selected?: boolean;
  selectionLabel?: string;
  onSelectedChange?: (selected: boolean) => void;
  contentHref?: string;
  contentLabel?: string;
  onContentClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const content = (
    <>
      <span className="eq-game-table-line eq-game-table-primary">{primary}</span>
      <span className="eq-game-table-line eq-game-table-secondary">{secondary}</span>
    </>
  );
  const rowClassName = [onSelectedChange ? "is-selectable" : "", selected ? "is-selected" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <tr className={rowClassName || undefined}>
      {onSelectedChange && (
        <td className="eq-game-table-select">
          <CheckboxControl
            checked={Boolean(selected)}
            ariaLabel={selectionLabel ?? "Select row"}
            onChange={onSelectedChange}
          />
        </td>
      )}
      <th className="eq-game-table-game" scope="row">
        {contentHref ? (
          <a
            className="eq-game-table-content-link"
            href={contentHref}
            aria-label={contentLabel}
            onClick={onContentClick}
          >
            {content}
          </a>
        ) : (
          content
        )}
      </th>
      <td className="eq-game-table-creator">
        <span className="eq-game-table-creator-label">Created by</span>
        <strong>{creator}</strong>
      </td>
      <td className="eq-game-table-actions">{actions}</td>
    </tr>
  );
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onChange: (selected: boolean) => void;
}) {
  return (
    <CheckboxControl
      checked={checked}
      mixed={indeterminate}
      ariaLabel={label}
      onChange={onChange}
    />
  );
}
