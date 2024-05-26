import { useEffect, useState } from "preact/hooks";
import { Sun, Moon } from "lucide-preact";

declare global {
  interface Window {
    updateDarkMode: () => void;
    isDarkMode: () => boolean;
  }
}

type Preference = "system" | "light" | "dark";

const useRerender = () => {
  const [, setDate] = useState(() => new Date());
  return function rerender() {
    return setDate(new Date());
  };
};

export default function DarkModeSwitch() {
  const [preference, setPreference] = useState(
    () => localStorage.getItem("color_scheme") ?? "system"
  );

  const rerender = useRerender();

  useEffect(() => {
    const systemDarkMode = window.matchMedia("(prefers-color-scheme: dark)");
    systemDarkMode.addEventListener("change", () => {
      rerender();
    });
  }, []);

  const updatePreference = (preference: Preference) => {
    setPreference(preference);
    localStorage.setItem("color_scheme", preference);
    window.updateDarkMode();
  };

  return (
    <div class="flex gap-1 relative has-[:focus]:outline p-1 rounded cursor-pointer [&>*]:cursor-pointer">
      <label for="color-scheme-select">
        {window.isDarkMode() ? <Moon /> : <Sun />}
        <span class="sr-only">Color scheme:</span>
      </label>
      <select
        value={preference}
        id="color-scheme-select"
        class="bg-transparent outline-0"
        onChange={(e) => updatePreference((e.target as any).value)}
      >
        <option value="system">Auto</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}
