"use client";

import { Check, Droplet, Palette, Sun, Waves } from "lucide-react";
import { useId } from "react";

export type ThemeName = "violet" | "mineral" | "sand";

type ThemeSwitcherProps = {
  value: ThemeName;
  onChange: (theme: ThemeName) => void;
};

const themeOptions = [
  {
    value: "violet",
    label: "Violet Ink",
    Icon: Droplet,
  },
  {
    value: "mineral",
    label: "Mineral Blue",
    Icon: Waves,
  },
  {
    value: "sand",
    label: "Warm Sand",
    Icon: Sun,
  },
] as const satisfies ReadonlyArray<{
  value: ThemeName;
  label: string;
  Icon: typeof Droplet;
}>;

export default function ThemeSwitcher({ value, onChange }: ThemeSwitcherProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div
      className="themeSwitcher"
      role="group"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
    >
      <div className="themeLabel" id={labelId}>
        <Palette aria-hidden="true" size={16} strokeWidth={1.8} />
        <span className="themeLabelText">Atmosphere</span>
      </div>

      <div className="themeOptions">
        {themeOptions.map(({ value: optionValue, label, Icon }) => {
          const isActive = value === optionValue;

          return (
            <button
              key={optionValue}
              className={isActive ? "themeOption themeOptionActive" : "themeOption"}
              type="button"
              aria-label={`Use ${label} atmosphere`}
              aria-pressed={isActive}
              title={label}
              onClick={() => onChange(optionValue)}
            >
              <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
              <span className="themeOptionLabel">{label}</span>
              {isActive ? (
                <span className="themeActiveMark" aria-hidden="true">
                  <Check size={13} strokeWidth={2.2} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <span className="themeVisuallyHidden" id={descriptionId}>
        Atmosphere changes workspace surfaces only. Success, warning, and error colors stay consistent.
      </span>
    </div>
  );
}
