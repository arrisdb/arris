import type { ReactNode } from "react";

function SectionHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mdbc-section-header">
      <span>{children}</span>
      {action}
    </div>
  );
}

export {
  SectionHeader,
};
