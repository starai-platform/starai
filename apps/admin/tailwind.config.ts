import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: "#12D6A3",
        dark: "#080D16",
        surface: "#F6F8FC",
      },
    },
  },
  plugins: [],
};
export default config;
