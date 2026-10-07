import React from "react";
import Icon from "./Icon";

const ControlButton = ({ onClick, active = true, label, icon, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ab4f8] disabled:opacity-40 ${
      active
        ? "bg-[#3c4043] hover:bg-[#4a4e51] text-[#e8eaed]"
        : "bg-[#ea4335] hover:bg-[#d93025] text-white"
    }`}
  >
    <Icon name={icon} />
  </button>
);

export default ControlButton;
