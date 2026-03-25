import React from "react";
import "./appShell.css";
import { useViewportVars } from "./useViewportVars";

export type PageType = "color" | "member" | "register" | "schedule" | "admin";

type Props = {
  page: PageType;
  setPage: (p: PageType) => void;
  currentUser: {
    id: number;
    username: string;
    display_name: string;
    role: "admin" | "teacher";
  };
  colorToolbar?: React.ReactNode;
  children: React.ReactNode;
};

function NavIcon({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="railBtn"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      type="button"
    >
      <span className="railIcon">{children}</span>
    </button>
  );
}

export default function AppShell({
  page,
  setPage,
  currentUser,
  colorToolbar,
  children,
 }: Props) {
  // ✅ 상단바 기준으로 visualViewport 대응
  useViewportVars(".topBar");

  const isSchedule = page === "schedule";

  return (
    <div className="appBg">
      <div className="appFrame">
        {/* 1) Icon Rail */}
        <aside className="rail">
          <div className="railTop">
            <div className="brandDot" />
          </div>

          <div className="railGroup">
            <NavIcon active={page === "color"} label="Color" onClick={() => setPage("color")}>
              🎨
            </NavIcon>
            <NavIcon active={page === "register"} label="Member Register" onClick={() => setPage("register")}>
              📝
            </NavIcon>
            <NavIcon active={page === "member"} label="My Member" onClick={() => setPage("member")}>
              👤
            </NavIcon>
            <NavIcon active={page === "schedule"} label="Schedule" onClick={() => setPage("schedule")}>
              📅
            </NavIcon>
          </div>

          <div className="railBottom">
            {currentUser.role === "admin" ? (
              <NavIcon active={page === "admin"} label="Admin" onClick={() => setPage("admin")}>
                ⚙️
              </NavIcon>
            ) : null}
          </div>
        </aside>

        {/* Main */}
        <section className="main">
          <header className="topBar">
            <div className="topBarLeft">
              <div className="topTitle">
                {page === "color"
                  ? "Color"
                  : page === "register"
                  ? "Member Register"
                  : page === "member"
                  ? "My Member"
                  : page === "schedule"
                  ? "Schedule"
                  : "Admin"}
              </div>
              <div className="topHint">Member Management</div>
            </div>

            {/* Color 페이지 툴바는 업로드 UI처럼 상단 우측에 “pill 버튼”으로 */}
            <div className="topBarRight">
              {page === "color" && colorToolbar ? <div className="toolbarPills">{colorToolbar}</div> : null}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginLeft: 12,
                }}
              >
                <span style={{ fontSize: 13, color: "#555" }}>
                  {currentUser.display_name}
                </span>

                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 6,
                    background:
                      currentUser.role === "admin" ? "#ffe0e0" : "#e0f0ff",
                    color:
                      currentUser.role === "admin" ? "#b71c1c" : "#0d47a1",
                    fontWeight: 600,
                  }}
                >
                  {currentUser.role}
                </span>

                <button
                  className="btn"
                  onClick={() => {
                    localStorage.removeItem("admin_token");
                    window.location.reload();
                  }}
                >
                  로그아웃
                </button>
              </div>
            </div>
          </header>

          <main className="content">
            <div className="contentCard">{children}</div>
          </main>
        </section>
      </div>
    </div>
  );
}