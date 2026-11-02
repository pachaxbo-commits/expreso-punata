/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        punata: {
          dark: '#064e3b',
          emerald: '#065f46',
          yellow: '#facc15',
          gold: '#ca8a04',
          slate: '#0f172a',
        },
      },
    },
  },
  plugins: [],
}
