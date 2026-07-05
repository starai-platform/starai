import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: "#12D6A3",
        secondary: "#4F7CFF",
        accent: "#FFB020",
        danger: "#FF4D4F",
        dark: "#080D16",
        surface: "#F6F8FC",
      },
    },
  },
  plugins: [],
};
export default config;
