import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)", hover: "var(--primary-hover)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)", hover: "var(--secondary-hover)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        sidebar: { DEFAULT: "var(--sidebar)", foreground: "var(--sidebar-foreground)", border: "var(--sidebar-border)", accent: "var(--sidebar-accent)", accentForeground: "var(--sidebar-accent-foreground)" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "slide-in-up": { "0%": { transform: "translateY(8px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        "pulse-subtle": { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.4" } },
        "breathe": { "0%, 100%": { transform: "scale(1) translateY(0)" }, "50%": { transform: "scale(1.03) translateY(-2px)" } },
        "gesture": { "0%, 100%": { transform: "rotate(0deg) scale(1.1)" }, "25%": { transform: "rotate(-8deg) scale(1.1) translateX(-3px)" }, "75%": { transform: "rotate(8deg) scale(1.1) translateX(3px)" } }
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-in-up": "slide-in-up 0.2s ease-out",
        "pulse-subtle": "pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "breathe": "breathe 3s ease-in-out infinite",
        "gesture": "gesture 2.5s ease-in-out infinite",
        "spin-slow": "spin 3s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
