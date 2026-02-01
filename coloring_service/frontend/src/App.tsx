import React, { useEffect, useMemo, useRef, useState } from "react";
import { COLORS, estimateBackground, floodFillNoBackground, type RGB } from "./coloring";
import AppShell from "./layout/AppShell";
import MyGallery from "./pages/MyGallery";

type Color = "red" | "blue";

type MemberInfo = {
  number: number;
  name: string;
  memo?: string;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selected, setSelected] = useState<Color>("red");
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  const [bg, setBg] = useState<RGB>([255,255,255]);
  const [bgTol, setBgTol] = useState<number>(40);

  const originalRef = useRef<ImageData | null>(null);
  const undoRef = useRef<ImageData[]>([]);

  const [page, setPage] = useState<"color" | "gallery">("color");

  // 회원 정보 state
  const [member, setMember] = useState<MemberInfo>({
    number: 0,
    name: "",
    memo: "",
  });

  // ✅ member form 표시 여부
  const [showMemberForm, setShowMemberForm] = useState(false);

  // iPad에서 toolbar 높이 변화에 대응
  useEffect(() => {
    const syncToolbar = () => {
      const header = document.querySelector(".header") as HTMLElement | null;
      if (!header) return;
      const h = Math.ceil(header.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--toolbarH", `${h}px`);
    };
    syncToolbar();

    const vv = window.visualViewport;
    const onResize = () => syncToolbar();
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onResize);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", () => setTimeout(onResize, 200));

    return () => {
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // 업로드 API
  async function onPickFile(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      alert("업로드 실패");
      return;
    }
    const data = await res.json();
    setImgUrl(data.url);
  }

  // 이미지 로드 → canvas에 원본 해상도로 세팅/그리기
  useEffect(() => {
    if (!imgUrl) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img, 0, 0);

      originalRef.current = ctx.getImageData(0,0,canvas.width,canvas.height);
      undoRef.current = [];

      const est = estimateBackground(ctx, canvas.width, canvas.height);
      setBg(est.bg);
      setBgTol(est.tol);
    };
    // 캐시 문제 방지
    img.src = imgUrl + `?v=${Date.now()}`;
  }, [imgUrl]);

  function pushUndo(ctx: CanvasRenderingContext2D) {
    const stack = undoRef.current;
    stack.push(ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height));
    if (stack.length > 20) stack.shift();
  }

  function undo() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const stack = undoRef.current;
    const prev = stack.pop();
    if (prev) ctx.putImageData(prev, 0, 0);
  }

  function reset() {
    const canvas = canvasRef.current;
    const original = originalRef.current;
    if (!canvas || !original) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    undoRef.current = [];
    ctx.putImageData(original, 0, 0);
  }

  function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = "colored.png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  function getCanvasXY(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const pt = "touches" in e ? e.touches[0] : (e as React.MouseEvent);
    const cx = pt.clientX - rect.left;
    const cy = pt.clientY - rect.top;
    const x = Math.floor(cx * (canvas.width / rect.width));
    const y = Math.floor(cy * (canvas.height / rect.height));
    return { x, y };
  }

  function paintAt(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    if (!originalRef.current) return;

    pushUndo(ctx);
    floodFillNoBackground(ctx, x, y, COLORS[selected], bg, bgTol);
  }

  const hasImage = !!imgUrl;

  return (
    <AppShell
      page={page}
      setPage={setPage}
      colorToolbar={
        <>
          <label className="btn">
            📷 이미지 업로드
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) onPickFile(f);
              }}
            />
          </label>

          <button className="btn" aria-pressed={selected === "red"} onClick={() => setSelected("red")}>
            <span className="sw" style={{ background: "#e53935" }} /> Red
          </button>
          <button className="btn" aria-pressed={selected === "blue"} onClick={() => setSelected("blue")}>
            <span className="sw" style={{ background: "#1e88e5" }} /> Blue
          </button>

          <button className="btn" onClick={undo} disabled={!hasImage}>↩️ Undo</button>
          <button className="btn" onClick={reset} disabled={!hasImage}>🧼 Reset</button>
          <button className="btn" onClick={savePng} disabled={!hasImage}>💾 Save</button>
        </>
      }>
      {page === "gallery" ? (
        <MyGallery />
      ) : (
        <>
          <div className="main">
            {/* === 기존 Coloring Canvas === */}
            <canvas
              ref={canvasRef}
              className="canvas"
              onClick={(e) => {
                if (!hasImage) return;
                const { x, y } = getCanvasXY(e);
                paintAt(x, y);
              }}
              onTouchStart={(e) => {
                if (!hasImage) return;
                e.preventDefault();
                const { x, y } = getCanvasXY(e);
                paintAt(x, y);
              }}
            />

            {/* === Member Info Modal === */}
            {showMemberForm && (
              <MemberForm
                member={member}
                onChange={setMember}
                onClose={() => setShowMemberForm(false)}
              />
            )}
          </div>

          <div className="hint">
            {hasImage ? "영역을 터치/클릭하면 채워집니다. 배경(종이 바탕)은 채색되지 않습니다." : "상단에서 스케치 이미지를 업로드하세요."}
          </div>
        </>
      )}
    </AppShell>
  );
}
