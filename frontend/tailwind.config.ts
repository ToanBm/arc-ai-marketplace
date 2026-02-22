import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#1a1d27",
          dark: "#0f1117",
          light: "#242836",
        },
        accent: {
          DEFAULT: "#6c5ce7",
          light: "#a29bfe",
        },
      },
    },
  },
  plugins: [],
};

export default config;
