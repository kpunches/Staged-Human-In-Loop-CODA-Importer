/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        wgu: {
          navy: "#002855",
          gold: "#f5a800",
        },
      },
    },
  },
  plugins: [],
}
