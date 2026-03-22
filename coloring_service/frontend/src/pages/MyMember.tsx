import React, { useEffect, useMemo, useState } from "react";
import "./MyMember.css";

const API_BASE = 
  window.location.hostname === "localhost"
    ? "http://localhost:8000"
    : `${window.location.protocol}//${window.location.hostname}:8000`;

function toApiUrl(url?: string | null) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url}`;
}

type Member = {
  id: number;
  number: string;
  name: string;
  birth_date?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  memo?: string | null;
}

type ResultItem = {
  id: number;
  selected_date?: string | null; // "YYYY-MM-DD"
  created_at: string;
  url: string; // "/uploads/...png"
  note?: string | null;
};

type ApiResponse = {
  member: Member;
  items: ResultItem[];
}

type MemberItem = {
  id: string;
  createdAt: string;          // ISO string
  originalId?: string | null;
  thumbUrl: string;           // e.g. "/api/images/<thumbId>" or "/uploads/..."
  url?: string;               // optional full image view url
  downloadUrl?: string;       // optional explicit download url
  filename?: string;          // optional (for nicer download name)
};

type ResultsResponse = {
  items: MemberItem[];
  nextCursor: string | null;
};

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Download helper:
 * - fetches the image as blob (so cookies/auth are included)
 * - triggers browser download
 */
async function downloadByFetch(url: string, filename: string) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(blobUrl);
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function groupByDate(items: ResultItem[]) {
  const map = new Map<string, ResultItem[]>();
  for (const it of items) {
    const key = it.selected_date ?? "No Date";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  // 날짜 내림차순 정렬 ("No Date"는 마지막)
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === "No Date") return 1;
    if (b === "No Date") return -1;
    return b.localeCompare(a);
  });
  return keys.map((k) => ({ date: k, items: map.get(k)! }));
}

export default function MyMember() {
  const [name, setName] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");

  const [items, setItems] = useState<MemberItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const q = name.trim();
    if (!q) {
      setMsg("Member name을 입력하세요.");
      return;
    }
    setLoading(true);
    setMsg("");

    try {
      const res = await fetch(`/api/members/by-name/${encodeURIComponent(q)}/results`);

      if (!res.ok) {
        setMsg(res.status === 404 ? "Member not found" : "불러오기 실패");
        setData(null);
        return;
      }
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch {
      setMsg("네트워크 오류");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers() {
    setMembersLoading(true);
    setMembersError("");

    try {
      const res = await fetch("/api/members");
      if (!res.ok) {
        setMembersError("회원 목록을 불러오지 못했습니다.");
        setMembers([]);
        return;
      }

      const json = (await res.json()) as Member[];
      setMembers(json);
    } catch {
      setMembersError("네트워크 오류");
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }

  const grouped = useMemo(() => (data ? groupByDate(data.items) : []), [data]);

  // Modal (member results)
  const [selectedResult, setSelectedResult] = useState<ResultItem | null>(null);


  // UI state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => items.find((x) => x.id === selectedId) || null,
    [items, selectedId]
  );

  const PAGE_LIMIT = 24;

  async function loadFirstPage() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<ResultsResponse>(`/api/results?limit=${PAGE_LIMIT}`);
      setItems(data.items || []);
      setNextCursor(data.nextCursor ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load member.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchJson<ResultsResponse>(
        `/api/results?limit=${PAGE_LIMIT}&cursor=${encodeURIComponent(nextCursor)}`
      );
      setItems((prev) => [...prev, ...(data.items || [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function deleteItem(id: string) {
    // Optimistic UI
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);

    try {
      const res = await fetch(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Delete failed: ${res.status}`);
      }
    } catch (e: any) {
      // rollback
      setItems(prev);
      setError(e?.message || "Delete failed.");
    }
  }

  async function downloadItem(item: MemberItem) {
    const url = item.downloadUrl || (item.url ?? `/api/images/${encodeURIComponent(item.id)}`);
    const safeName =
      item.filename ||
      `colored_${item.id.slice(0, 8)}.png`;

    try {
      await downloadByFetch(url, safeName);
    } catch (e: any) {
      setError(e?.message || "Download failed.");
    }
  }

  useEffect(() => {
    loadMembers();
    // 필요 없으면 loadFirstPage()는 제거해도 됩니다.
    // loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="myMemberPage">
            <div className="myMemberLayout">
        {/* LEFT */}
        <aside className="panelCard" style={{ overflow: "auto" }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>My Member</div>

          <label className="fieldLabel" style={{ marginTop: 12 }}>
            Name
            <input
              className="textInput"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 김종학"
            />
          </label>

          <button className="btn" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Load"}
          </button>

          {msg ? <div style={{ marginTop: 10, color: "rgba(0,0,0,0.6)" }}>{msg}</div> : null}

          {data ? (
            <div className="memberInfoCard">
              <div>
                <b>{data.member.name}</b> (#{data.member.number})
              </div>
              <div style={{ marginTop: 6, color: "rgba(0,0,0,0.6)" }}>
                Height: {data.member.height_cm ?? "-"} cm / Weight: {data.member.weight_kg ?? "-"} kg
              </div>
              {data.member.memo ? <div style={{ marginTop: 6 }}>{data.member.memo}</div> : null}
            </div>
          ) : null}
        </aside>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>전체 회원</div>

          {membersLoading ? (
            <div style={{ color: "rgba(0,0,0,0.6)" }}>불러오는 중...</div>
          ) : membersError ? (
            <div style={{ color: "rgba(0,0,0,0.6)" }}>{membersError}</div>
          ) : members.length === 0 ? (
            <div style={{ color: "rgba(0,0,0,0.6)" }}>등록된 회원이 없습니다.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="memberTable">
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>이름</th>
                    <th>생년월일</th>
                    <th>키</th>
                    <th>몸무게</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr
                      key={m.id}
                      onClick={async () => {
                        setName(m.name);

                        setLoading(true);
                        setMsg("");
                        try {
                          const res = await fetch(`/api/members/by-name/${encodeURIComponent(m.name)}/results`);
                          if (!res.ok) {
                            setMsg(res.status === 404 ? "Member not found" : "불러오기 실패");
                            setData(null);
                            return;
                          }
                          const json = (await res.json()) as ApiResponse;
                          setData(json);
                        } catch {
                          setMsg("네트워크 오류");
                          setData(null);
                        } finally {
                          setLoading(false);
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{m.number}</td>
                      <td>{m.name}</td>
                      <td>{m.birth_date ?? "-"}</td>
                      <td>{m.height_cm ?? "-"}</td>
                      <td>{m.weight_kg ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <section className="panelCard" style={{ overflow: "auto" }}>
          <div className="resultsHeader">
            <div style={{ fontWeight: 900 }}>Results</div>
          </div>

          {!data ? (
            <div style={{ color: "rgba(0,0,0,0.6)" }}>왼쪽에서 이름을 검색하세요.</div>
          ) : grouped.length === 0 ? (
            <div style={{ color: "rgba(0,0,0,0.6)" }}>저장된 색칠 결과가 없습니다.</div>
          ) : (
            grouped.map((g) => (
              <div key={g.date} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 900, margin: "10px 0" }}>{g.date}</div>
                <div className="resultsGrid">
                  {g.items.map((it) => (
                    <a
                      key={it.id}
                      href={toApiUrl(it.url)}
                      className="resultCard"
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedResult(it);
                      }}
                      title={`Result #${it.id}`}
                    >
                      <img
                        className="resultThumb"
                        src={toApiUrl(it.url)}
                        alt={`result-${it.id}`}
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <div className="resultMeta">#{it.id}</div>
                    </a>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      {/* Result detail modal (image  note) */}
      {selectedResult && (
        <div className="modalOverlay" onClick={() => setSelectedResult(null)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="mmModalHeader">
              <div style={{ fontWeight: 800 }}>
                {selectedResult.selected_date ?? "No Date"} · Result #{selectedResult.id}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a
                  className="btn"
                  href={toApiUrl(selectedResult.url)}
                  download
                  onClick={(e) => e.stopPropagation()}
                >
                  Download
                </a>
                <button className="btn" type="button" onClick={() => setSelectedResult(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="mmModalGrid">
              <div className="mmPreviewWrap">
                <img
                  className="mmPreviewImg"
                  src={toApiUrl(selectedResult.url)}
                  alt="selected"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).alt = "이미지를 찾을 수 없습니다.";
                  }}
                />
              </div>
              <div className="mmNoteBox">
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Note</div>
                <div className="mmNoteContent">
                  {selectedResult.note?.trim() ? selectedResult.note : "No note saved."}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
