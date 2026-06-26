import type { ReactNode } from "react";

function FormRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mdbc-form-row">
      <div className="mdbc-form-row-label">{label}</div>
      <div className="mdbc-form-row-control">{children}</div>
    </div>
  );
}

export {
  FormRow,
};
