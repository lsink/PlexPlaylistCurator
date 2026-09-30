/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/client/index.html",
    "./src/client/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        plex: {
          gold: '#e5a00d',
          goldHover: '#cc8e0b',
          dark: '#1f2326',
          darker: '#131517',
          card: '#282c30',
          border: '#3b4045',
          muted: '#8e969d',
        }
      }
    },
  },
  plugins: [],
}
