import React from "react";
import "./appShell.css";
import { useViewportVars } from "./useViewportVars";

type Page = "color" | "gallery";

export type PageType = "color" | "gallery";

type Props = {
  page: PageType;
  setPage: (p: PageType) => void;

  colorToolbar?: React.ReactNode;

  children: React.ReactNode;
};

export default function AppShell({
  page,
  setPage,
  colorToolbar,
  children,
}: Props) {
  
  // iPad / 모바일 visualViewport 대응
  useViewportVars(".appHeader");

  return (
    <div className="appShell">
      <header className="appHeader">
        <div className="appHeaderInner">
          <div style={{ fontWeight: 900 }}>Coloring Service</div>

          <nav className="navGroup">
            <button className="btn" aria-pressed={page === "color"} onClick={() => setPage("color")}>
              Color
            </button>
            <button className="btn" aria-pressed={page === "gallery"} onClick={() => setPage("gallery")}>
              My Gallery
            </button>
          </nav>
        </div>

        {page === "color" && colorToolbar && (
          <div className="toolBar">
            {colorToolbar}
          </div>
        )}
      </header>

      <main className="appMain">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
