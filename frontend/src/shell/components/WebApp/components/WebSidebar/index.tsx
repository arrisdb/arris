import type { MouseEvent } from "react";
import { navigate } from "../../../../utils";
import { SIDEBAR_TEST_ID } from "./constants";
import type { WebSidebarProps } from "./types";
import { isActive, sidebarLinks } from "./utils";
import "./index.css";

function WebSidebar({ route, switcher, tools }: WebSidebarProps) {
  const go = (event: MouseEvent, path: string) => {
    event.preventDefault();
    navigate(path);
  };

  return (
    <nav className="mdbc-web-sidebar" data-testid={SIDEBAR_TEST_ID}>
      <div className="mdbc-web-sidebar-switcher">{switcher}</div>
      {sidebarLinks(tools).map((link) => (
        <a
          key={link.path}
          href={link.path}
          className="mdbc-web-sidebar-link"
          aria-current={isActive(link, route) ? "page" : undefined}
          onClick={(event) => go(event, link.path)}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export { WebSidebar };
