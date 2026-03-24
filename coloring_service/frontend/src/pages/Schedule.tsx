import React, { useEffect, useMemo, useState } from "react";
import { Calendar, dateFnsLocalizer, View, Views } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "./scheduleOverrides.css";
import "./Schedule.css";

import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";

import { getAdminToken } from "../auth/authToken";

type ScheduleItem = {
  id: number;
  title: string;
  start_at: string; // ISO
  end_at?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
};

type CalEvent = {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resource: ScheduleItem; // 원본 payload 보관
};

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }), // 월요일 시작(원하면 0으로)
  getDay,
  locales,
});

function toLocalInputValue(d: Date) {
  // "YYYY-MM-DDTHH:mm"
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function addHours(d: Date, hours: number) {
  const x = new Date(d);
  x.setHours(x.getHours() + hours);
  return x;
}

function addMinutes(d: Date, minutes: number) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() + minutes);
  return x;
}

function setToHour(d: Date) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x;
}

function setDefaultTimeRangeForDay(day: Date) {
    const start = new Date(day);
    start.setHours(9, 0, 0, 0); // 기본 시작 09:00
    const end = new Date(day);
    end.setHours(9, 50, 0, 0); // 기본 종료 09:50
    return { start, end };
}

export default function SchedulePage() {
  const token = useMemo(() => getAdminToken(), []);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 캘린더 상태
  const [view, setView] = useState<View>(Views.MONTH);
  const [date, setDate] = useState<Date>(new Date());

  // 간단한 “등록 모달” 상태 (선택한 슬롯/시간)
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [startAt, setStartAt] = useState<string>(() => toLocalInputValue(new Date()));
  const [endAt, setEndAt] = useState<string>(() => toLocalInputValue(addHours(new Date(), 1)));

  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [editingId, setEditingId] = useState<number | null>(null);

  const [q, setQ] = useState("");
  const [showOnlySelectedDay, setShowOnlySelectedDay] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/schedules", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ScheduleItem[];
      setItems(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const events: CalEvent[] = useMemo(() => {
    return items.map((it) => {
      const start = new Date(it.start_at);
      const end = it.end_at ? new Date(it.end_at) : addHours(start, 1);
      return {
        id: it.id,
        title: it.title,
        start,
        end,
        resource: it,
      };
    });
  }, [items]);

  const dayEvents = useMemo(() => {
    const y = selectedDay.getFullYear();
    const m = selectedDay.getMonth();
    const d = selectedDay.getDate();

    return events
      .filter((ev) => {
        const s = ev.start;
        return s.getFullYear() === y && s.getMonth() === m && s.getDate() === d;
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [events, selectedDay]);

  const leftListEvents = useMemo(() => {
    const base = showOnlySelectedDay ? dayEvents : events;

    const qq = q.trim().toLowerCase();
    if (!qq) return base;

    return base.filter((ev) => {
      const t = (ev.title || "").toLowerCase();
      const n = (ev.resource.note || "").toLowerCase();
      return t.includes(qq) || n.includes(qq);
    });
  }, [showOnlySelectedDay, dayEvents, events, q]);

  async function saveSchedule() {
    if (!title.trim()) {
        alert("제목을 입력하세요.");
        return;
    }

    const payload = {
        title: title.trim(),
        start_at: startAt,
        end_at: endAt || null,
        note: note.trim() ? note.trim() : null,
    };

    const url = editingId
        ? `/api/schedules/${editingId}`
        : "/api/schedules";

    const method = editingId ? "PUT" : "POST";

    const res = await fetch(url, {
        method,
        headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        alert(await res.text());
        return;
    }

    setEditingId(null);
    setOpen(false);
    await load();
    }

  async function remove(id: number) {
    const res = await fetch(`/api/schedules/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    await load();
  }

  function openCreateModal(start: Date) {
    const normalizedStart = setToHour(start);
    const normalizedEnd = addMinutes(normalizedStart, 50);

    setStartAt(toLocalInputValue(normalizedStart));
    setEndAt(toLocalInputValue(normalizedEnd));
    setTitle("");
    setNote("");
    setOpen(true);
  }

  return (
    <div className="schedulePage">
      <div className="scheduleLayout">
        {/* LEFT PANEL */}
        <aside className="panelCard scheduleLeft">
          <div className="scheduleLeftTitle">일정</div>

          {/* 검색 */}
          <input
            className="scheduleSearch"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색(제목/노트)"
          />

          {/* 토글: 선택 날짜만 / 전체 */}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              className="btn"
              aria-pressed={showOnlySelectedDay}
              onClick={() => setShowOnlySelectedDay(true)}
            >
              선택 날짜
            </button>
            <button
              className="btn"
              aria-pressed={!showOnlySelectedDay}
              onClick={() => setShowOnlySelectedDay(false)}
            >
              전체
            </button>
          </div>

          {/* 선택 날짜 표시 */}
          <div style={{ marginTop: 12, fontWeight: 800 }}>
            선택 날짜: {selectedDay.toLocaleDateString()}
          </div>

          {/* 리스트 */}
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {leftListEvents.length === 0 ? (
              <div style={{ color: "#666" }}>표시할 일정이 없습니다.</div>
            ) : (
              leftListEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => {
                    // 리스트 클릭 시: 해당 이벤트 시간대로 캘린더 이동 + 선택 날짜 갱신 + 편집 모달 열기
                    setSelectedDay(new Date(ev.start));
                    setDate(new Date(ev.start));

                    const item = ev.resource;
                    setEditingId(item.id);
                    setTitle(item.title);
                    setStartAt(toLocalInputValue(new Date(item.start_at)));
                    setEndAt(item.end_at ? toLocalInputValue(new Date(item.end_at)) : "");
                    setNote(item.note || "");
                    setOpen(true);
                  }}
                  style={{
                    textAlign: "left",
                    border: "1px solid rgba(0,0,0,0.12)",
                    borderRadius: 12,
                    padding: 12,
                    background: "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{ev.title}</div>
                  <div style={{ fontSize: 13, color: "#444", marginTop: 4 }}>
                    {ev.start.toLocaleTimeString()} ~ {ev.end.toLocaleTimeString()}
                  </div>
                  {ev.resource.note ? (
                    <div style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "#333" }}>
                      {ev.resource.note}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                    <span
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(ev.id);
                      }}
                    >
                      🗑️ 삭제
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>
        
        {/* RIGHT: CALENDAR */}
        <section className="panelCard scheduleRight">
          {/* 기존 상단 버튼은 오른쪽 영역에 둬도 좋음 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 950, fontSize: 18 }}>일정 캘린더</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn" onClick={() => setView(Views.MONTH)} aria-pressed={view === Views.MONTH}>월</button>
              <button className="btn" onClick={() => setView(Views.WEEK)} aria-pressed={view === Views.WEEK}>주</button>
              <button className="btn" onClick={load} disabled={loading}>{loading ? "불러오는 중..." : "새로고침"}</button>
              <button className="btn" onClick={() => {
                setEditingId(null);
                const { start } = setDefaultTimeRangeForDay(selectedDay);
                openCreateModal(start);
                }}
              >
                + 일정
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <Calendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              date={date}
              view={view}
              onView={(v) => setView(v)}
              onNavigate={(d) => setDate(d)}
              selectable
              popup
              dayPropGetter={(day) => {
                const sameDay = 
                  day.getFullYear() === selectedDay.getFullYear() &&
                  day.getMonth() === selectedDay.getMonth() &&
                  day.getDate() === selectedDay.getDate();

                return {
                  className: sameDay ? "schedule-selected-day" : "",
                };
              }}
              
              /* ✅ 달력이 화면 대부분을 차지하도록: 높이는 화면 기준으로 유동 */
              style={{ height: "calc(100vh - 220px)", minHeight: 720, width: "100%" }}
              
              onSelectSlot={(slot) => {
                const s = slot.start as Date;
                // const e = slot.end as Date;
                setSelectedDay(new Date(s));

                // if (view === Views.MONTH) {
                //   const { start, end } = setDefaultTimeRangeForDay(s);
                //   openCreateModal(start, end);
                //   return;
                // }
                // openCreateModal(s, e);
                setDate(new Date(s));
              }}
              onSelectEvent={(ev) => {
                setSelectedDay(new Date(ev.start));
                setDate(new Date(ev.start));
                const item = ev.resource;
                setEditingId(item.id);
                setTitle(item.title);
                setStartAt(toLocalInputValue(new Date(item.start_at)));
                setEndAt(item.end_at ? toLocalInputValue(new Date(item.end_at)) : "");
                setNote(item.note || "");
                setOpen(true);
              }}
              messages={{
              today: "오늘",
              previous: "이전",
              next: "다음",
              month: "월",
              week: "주",
              day: "일",
              agenda: "목록",
              date: "날짜",
              time: "시간",
              event: "일정",
              noEventsInRange: "표시할 일정이 없습니다.",
              showMore: (total) => `+${total}개 더보기`,
            }}
            />
          </div>
        </section>
      </div>

      {/* 아주 단순한 모달 (라이브러리 없이) */}
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 100%)",
              background: "white",
              borderRadius: 14,
              padding: 14,
              border: "1px solid rgba(0,0,0,0.14)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{editingId ? "일정 수정" : "일정 등록"}</h3>
              <button className="btn" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>

            <div className="memberPanel" style={{ marginTop: 10 }}>
              <label>
                제목
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 회원 PT" />
              </label>

              <div className="memberRow">
                <label style={{ flex: 1, marginBottom: 0 }}>
                  시작
                  <input
                    type="datetime-local"
                    step={3600}
                    value={startAt}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (!raw) {
                        setStartAt("");
                        setEndAt("");
                        return;
                      }

                      const start = setToHour(new Date(raw));
                      const end = addMinutes(start, 50);

                      setStartAt(toLocalInputValue(start));
                      setEndAt(toLocalInputValue(end));
                    }}
                  />
                </label>
                <label style={{ flex: 1, marginBottom: 0 }}>
                  종료(자동)
                  <input type="datetime-local" value={endAt} readOnly />
                </label>
              </div>

              <label>
                메모(선택)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="btn" onClick={() => setOpen(false)}>
                  취소
                </button>
                <button className="btn" onClick={saveSchedule}>
                  {editingId ? "수정" : "저장"}
                </button>
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
              * 날짜를 먼저 선택한 뒤 오른쪽 상단의 + 일정 버튼으로 등록 / 기존 일정 클릭 → 수정
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}