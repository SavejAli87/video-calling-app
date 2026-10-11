import React, { useState } from "react";
import Avatar from "./Avatar";
import { normalizeName } from "./utils";
import { MAX_NAME_LENGTH } from "./constants";

/**
 * "What's your name?" screen.
 * required=true  -> pehli visit (cancel nahi kar sakte)
 * required=false -> naam edit karte waqt (Cancel dikhta hai)
 */
const NameScreen = ({ initialName = "", required, onSave, onCancel }) => {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");

  const preview = normalizeName(name, MAX_NAME_LENGTH);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!preview) {
      setError("Please enter your name.");
      return;
    }
    onSave(preview);
  };

  return (
    <div
      className="fixed inset-0 z-[45] overflow-y-auto bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="min-h-full flex items-center justify-center px-4 py-8">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md rounded-3xl border border-[#dadce0] px-6 sm:px-10 py-8 sm:py-10 text-center"
        >
          <div className="mx-auto mb-5 flex justify-center">
            <Avatar name={preview || "?"} size={72} />
          </div>

          <h1 className="text-2xl sm:text-[28px] font-normal text-[#202124]">
            {required ? "What's your name?" : "Change your name"}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-[#5f6368]">
            Others will see this name when you call or message them. It's saved on this
            device, so you won't be asked again.
          </p>

          <div className="mt-6 text-left">
            <label htmlFor="display-name" className="sr-only">
              Your name
            </label>
            <input
              id="display-name"
              type="text"
              value={name}
              autoFocus
              autoComplete="name"
              maxLength={MAX_NAME_LENGTH}
              placeholder="Your name"
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
              className={`w-full rounded-lg border px-4 py-3.5 text-base text-[#202124] outline-none placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8] ${
                error ? "border-[#d93025]" : "border-[#80868b]"
              }`}
            />
            <div className="mt-1.5 flex justify-between text-xs">
              <span className="text-[#d93025]">{error}</span>
              <span className="text-[#5f6368]">
                {name.length}/{MAX_NAME_LENGTH}
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            {!required && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-full px-5 h-10 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1a73e8]"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={!preview}
              className="rounded-full bg-[#1a73e8] hover:bg-[#1765cc] disabled:bg-[#e8eaed] disabled:text-[#9aa0a6] disabled:cursor-not-allowed text-white text-sm font-medium h-10 px-6 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]"
            >
              {required ? "Continue" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NameScreen;
