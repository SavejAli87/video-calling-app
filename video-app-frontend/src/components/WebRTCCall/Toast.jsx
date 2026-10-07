import React from "react";

const Toast = ({ message }) => {
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 max-w-[90vw] rounded-lg bg-[#323232] px-5 py-3 text-sm text-white shadow-lg"
    >
      {message}
    </div>
  );
};

export default Toast;
