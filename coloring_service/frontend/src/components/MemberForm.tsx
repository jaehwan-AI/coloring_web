import React from "react";

type MemberInfo = {
  number: number;
  name: string;
  memo?: string;
  height_cm?: number;
  weight_kg?: number;
};

type Props = {
  member: MemberInfo;
  onChange: (m: MemberInfo) => void;
  onClose: () => void;
};

export default function MemberForm({ member, onChange, onClose }: Props) {
  return (
    <div className="modalOverlay">
      <div className="modalCard">
        <div className="modalHeader">
          <strong>Member Information</strong>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <label>
            Number
            <input
              type="email"
              value={member.number}
              onChange={(e) => onChange({ ...member, number: e.target.value })}
            />
          </label>
          <label>
            Name
            <input
              type="text"
              value={member.name}
              onChange={(e) => onChange({ ...member, name: e.target.value })}
            />
          </label>

          <label>
            Memo
            <textarea
              rows={3}
              value={member.memo}
              onChange={(e) => onChange({ ...member, memo: e.target.value })}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
