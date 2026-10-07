import React from "react";
import { initialsOf, colorOf } from "./utils";

const Avatar = ({ name, size = 40, className = "" }) => (
  <div
    className={`flex items-center justify-center rounded-full font-medium text-white select-none shrink-0 ${className}`}
    style={{ width: size, height: size, background: colorOf(name), fontSize: size * 0.4 }}
  >
    {initialsOf(name)}
  </div>
);

export default Avatar;
