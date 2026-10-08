import React from "react";
import Icon from "./Icon";

/**
 * active=false  -> red (mic/camera off)
 * pressed=true  -> highlighted (e.g. chat panel open)
 * badge         -> unread count bubble
 */
const ControlButton = ({ onClick, active = true, pressed = false, badge = 0, label, icon, disabled }) => {
  let tone = "bg-[#3c4043] hover:bg-[#4a4e51] text-[#e8eaed]";
  if (!active) tone = "bg-[#ea4335] hover:bg-[#d93025] text-white";
  else if (pressed) tone = "bg-[#a8c7fa] hover:bg-[#8ab4f8] text-[#041e49]";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ab4f8] disabled:opacity-40 ${tone}`}
    >
      <Icon name={icon} />
      {badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ea4335] text-white text-[11px] leading-[18px] font-medium text-center">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
};

export default ControlButton;
