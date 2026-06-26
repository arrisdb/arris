import type { CSSProperties, ReactNode } from "react";

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="mdbc-card" style={style}>
      {children}
    </div>
  );
}

export {
  Card,
};
